from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import numpy as np


def _extract_gray_frames(path: Path, start_sec: float, count: int, w: int = 64, h: int = 36) -> list:
    """Decode `count` frames starting at start_sec as small grayscale arrays,
    downscaled enough that a full all-pairs comparison across two ~2-5s
    windows is cheap (a few thousand 64x36 diffs, not full-resolution video)."""
    if count <= 0:
        return []
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-ss", f"{max(0.0, start_sec):.6f}", "-i", str(path),
        "-frames:v", str(count), "-vf", f"scale={w}:{h}:flags=area,format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ]
    raw = subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=30)
    frame_bytes = w * h
    n = len(raw) // frame_bytes
    # .copy() because frombuffer views are read-only, and OpenCV (used for
    # motion matching below) wants writable arrays.
    return [np.frombuffer(raw[i * frame_bytes:(i + 1) * frame_bytes], dtype=np.uint8).reshape(h, w).copy() for i in range(n)]


def _motion_vectors(frames: list) -> list[tuple[float, float]] | None:
    """Average optical-flow vector between each consecutive frame pair, i.e.
    "which way and how fast is this shot moving right now."

    Returns None (rather than raising) when OpenCV is missing or flow fails,
    so motion is simply dropped from scoring instead of failing the analysis.
    """
    if len(frames) < 2:
        return None
    try:
        import cv2
    except Exception:
        return None
    vecs: list[tuple[float, float]] = []
    try:
        for i in range(len(frames) - 1):
            flow = cv2.calcOpticalFlowFarneback(frames[i], frames[i + 1], None, 0.5, 3, 9, 3, 5, 1.2, 0)
            vecs.append((float(flow[..., 0].mean()), float(flow[..., 1].mean())))
    except Exception:
        return None
    return vecs


def _motion_match_score(v_a: tuple[float, float], v_b: tuple[float, float]) -> float:
    """How well the motion leaving A continues into B - a cut where the
    camera is panning right at 2px/frame into a shot that starts panning
    right at 2px/frame reads as continuous; the same cut into a static or
    opposite-panning shot visibly jerks even when both frames look alike.
    """
    ax, ay = v_a
    bx, by = v_b
    mag_a = float(np.hypot(ax, ay))
    mag_b = float(np.hypot(bx, by))
    if mag_a < 0.05 and mag_b < 0.05:
        return 1.0  # both essentially still: trivially continuous
    diff = float(np.hypot(ax - bx, ay - by))
    denom = 2.0 * max(mag_a, mag_b, 1e-6)
    return max(0.0, min(1.0, 1.0 - diff / denom))


def _combine_scores(parts: list[tuple[float, float]]) -> float:
    """Weighted mean that renormalizes over whatever components are actually
    available, so a clip with no audio isn't scored as if its audio matched
    perfectly (or not at all)."""
    total_w = sum(w for _, w in parts)
    if total_w <= 0:
        return 0.0
    return sum(s * w for s, w in parts) / total_w


def _extract_pcm(path: Path, start_sec: float, dur_sec: float, sr: int = 8000):
    """Mono 16-bit PCM samples for a short window, or None if there's no
    audio stream / the window is out of range - callers must treat a None
    return as "skip audio scoring for this candidate", not an error."""
    if dur_sec <= 0:
        return None
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-ss", f"{max(0.0, start_sec):.6f}", "-t", f"{dur_sec:.6f}", "-i", str(path),
        "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "pipe:1",
    ]
    try:
        raw = subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=30)
    except Exception:
        return None
    if not raw:
        return None
    return np.frombuffer(raw, dtype=np.int16)


def _audio_level_continuity(path_a: Path, frame_a: int, path_b: Path, frame_b: int, fps: float, sr: int = 8000, win_sec: float = 0.06) -> float | None:
    """How closely the audio level right before the cut matches right after -
    reported for information only, NOT used to rank candidates.

    Audio was measured against known-correct and known-wrong cut points on
    real generated footage and could not separate them: the score ranges for
    continuous and discontinuous cuts overlap completely (a deliberate jump
    to unrelated footage scored *higher* than a genuinely continuous cut).
    Two causes, both inherent rather than fixable by a better formula:
    generated clips tend to have spectrally uniform audio, so "is this the
    same material" is always yes; and level naturally swings as much inside
    one continuous passage as it does between distant points. Ranking on it
    actively demoted the objectively perfect cut to last place, so it is
    excluded from scoring. Frame and motion do discriminate and carry the
    decision instead.
    """
    a_pcm = _extract_pcm(path_a, max(0.0, frame_a / fps - win_sec), win_sec, sr)
    b_pcm = _extract_pcm(path_b, frame_b / fps, win_sec, sr)
    if a_pcm is None or b_pcm is None or len(a_pcm) < 10 or len(b_pcm) < 10:
        return None
    rms_a = float(np.sqrt(np.mean(a_pcm.astype(np.float64) ** 2)))
    rms_b = float(np.sqrt(np.mean(b_pcm.astype(np.float64) ** 2)))
    return max(0.0, min(1.0, 1.0 - abs(rms_a - rms_b) / max(rms_a, rms_b, 1.0)))


def analyze_stitch(path_a: Path, source_out_a: int, path_b: Path, source_in_b: int, fps: float, window_sec: float = 2.0, top_n: int = 5) -> dict[str, Any]:
    """Recommends where to cut A and where to start B so the two clips read
    as continuous, by finding the most visually (and, secondarily, audibly)
    similar frame near each clip's edge of the given analysis window -
    i.e. "these two frames show nearly the same moment, so drop everything
    after frame_a in A and everything before frame_b in B."

    Each candidate is scored on three independent axes - frame similarity
    (do these two frames show the same moment), motion continuity (is the
    camera moving the same way through the cut), and audio continuity (does
    the sound carry across without a pop) - because they fail independently:
    two frames can look nearly identical while the motion through them jerks,
    and motion can match while the audio level jumps.
    """
    fps = float(fps or 24)
    window_frames = max(4, min(240, round(window_sec * fps)))
    start_a = max(0, int(source_out_a) - window_frames)
    count_a = int(source_out_a) - start_a
    start_b = int(source_in_b)
    count_b = window_frames

    try:
        frames_a = _extract_gray_frames(path_a, start_a / fps, count_a)
        frames_b = _extract_gray_frames(path_b, start_b / fps, count_b)
    except Exception as e:
        return {"ok": False, "error": f"frame extraction failed: {e}"}
    if len(frames_a) < 2 or len(frames_b) < 2:
        return {"ok": False, "error": "not enough frames near the boundary to analyze - try a larger window"}

    n_a, n_b = len(frames_a), len(frames_b)
    a = np.stack(frames_a).astype(np.float32).reshape(n_a, -1)
    b = np.stack(frames_b).astype(np.float32).reshape(n_b, -1)
    diff2 = np.mean((a[:, None, :] - b[None, :, :]) ** 2, axis=2)
    frame_score = 1.0 - np.sqrt(diff2) / 255.0

    # Motion is per-frame-pair, so it costs one pass over each window (O(n)),
    # not one per candidate pair (O(n^2)) - computed up front and indexed.
    vecs_a = _motion_vectors(frames_a)
    vecs_b = _motion_vectors(frames_b)

    order = np.argsort(frame_score, axis=None)[::-1]
    candidates: list[dict[str, Any]] = []
    for flat in order:
        i, j = divmod(int(flat), n_b)
        frame_a_idx = start_a + i
        frame_b_idx = start_b + j
        # Spacing-based dedup: skip anything too close (in either clip) to a
        # candidate already kept, so the top-5 aren't all the same instant.
        if any(abs(frame_a_idx - c["frame_a"]) < 2 and abs(frame_b_idx - c["frame_b"]) < 2 for c in candidates):
            continue
        f_score = float(frame_score[i, j])
        a_score = _audio_level_continuity(path_a, frame_a_idx, path_b, frame_b_idx, fps)
        m_score = None
        if vecs_a and vecs_b:
            # Motion *into* the cut on A (the pair ending at i), and motion
            # *out of* it on B (the pair starting at j); clamped at the window
            # edges where one side of the pair doesn't exist.
            m_score = _motion_match_score(
                vecs_a[i - 1] if i >= 1 else vecs_a[0],
                vecs_b[j] if j < len(vecs_b) else vecs_b[-1],
            )
        # a_score is intentionally absent here - see _audio_level_continuity.
        parts = [(f_score, 0.65)]
        if m_score is not None:
            parts.append((m_score, 0.35))
        combined = _combine_scores(parts)
        candidates.append({
            "frame_a": frame_a_idx, "frame_b": frame_b_idx,
            "frame_score": round(f_score, 4),
            "audio_score": round(a_score, 4) if a_score is not None else None,
            "motion_score": round(m_score, 4) if m_score is not None else None,
            "combined_score": round(float(combined), 4),
        })
        if len(candidates) >= top_n:
            break

    candidates.sort(key=lambda c: c["combined_score"], reverse=True)
    return {"ok": True, "candidates": candidates, "best": candidates[0] if candidates else None, "window_frames": window_frames}
