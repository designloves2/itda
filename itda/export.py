from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path
from typing import Any

from .paths import is_contained, itda_media_roots, itda_root, output_dir, safe_name


def _flatten_clips(clips: list[dict]) -> list[dict]:
    """Stitched clips carry their pieces in .children with rel_start (relative
    to the stitched parent's own start), not absolute timeline positions - so
    for export we replace each stitched clip with its children at their real
    absolute start."""
    out: list[dict] = []
    for c in clips:
        if c.get("kind") == "stitched" or c.get("children"):
            parent_start = float(c.get("start", 0) or 0)
            for ch in c.get("children") or []:
                merged = dict(ch)
                merged["start"] = parent_start + float(ch.get("rel_start", 0) or 0)
                if "lane" not in merged:
                    merged["lane"] = c.get("lane", 0)
                out.append(merged)
        else:
            out.append(c)
    return out


def _pick_canvas_size(visual_clips: list[dict]) -> tuple[int, int]:
    for c in visual_clips:
        w, h = c.get("width"), c.get("height")
        if w and h:
            return int(w), int(h)
    return 1920, 1080


_HEX_COLOR_RE = re.compile(r"^[0-9a-fA-F]{6}$")


def _safe_color(value: Any, default: str) -> str:
    """Colors reach ffmpeg by string interpolation into the filter graph, so
    an unvalidated one is an option-injection hole, not just a cosmetic bug:
    a color of "ffffff:textfile=C\\:/secret.txt" closes the fontcolor value
    and appends a real drawtext option, and textfile= renders that file's
    contents into the exported video. The editor only ever sends #rrggbb,
    but a hand-edited or API-posted project can send anything, so anything
    that isn't exactly six hex digits is refused rather than sanitized.
    """
    hex_part = str(value or "").lstrip("#").strip()
    return hex_part if _HEX_COLOR_RE.match(hex_part) else default


def _escape_drawtext(text: str) -> str:
    return (
        str(text)
        .replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "’")
        .replace("\n", " ")
    )


_DRAWTEXT_FONT_CANDIDATES = [
    "C:/Windows/Fonts/malgun.ttf",  # Malgun Gothic - covers Hangul on Windows
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def _drawtext_fontfile() -> str | None:
    # ffmpeg's drawtext (libfreetype) defaults to a font with no Hangul/CJK
    # glyphs, so burned-in Korean text silently rendered as empty tofu boxes.
    # Point it at a real Unicode-covering font when one is available.
    for candidate in _DRAWTEXT_FONT_CANDIDATES:
        if Path(candidate).exists():
            return candidate.replace("\\", "/").replace(":", "\\:")
    return None


def _fonts_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "Fonts"


def _woff2_to_ttf(woff2_path: Path) -> Path | None:
    """The editor's bundled fonts are .woff2 (web font, brotli-compressed),
    which ffmpeg's drawtext (libfreetype) cannot read directly. Convert once
    to a real .ttf and cache it next to the source font."""
    cache_dir = woff2_path.parent / "_ttf_cache"
    out = cache_dir / f"{woff2_path.stem}.ttf"
    if out.exists() and out.stat().st_mtime >= woff2_path.stat().st_mtime:
        return out
    try:
        from fontTools.ttLib import TTFont
        cache_dir.mkdir(exist_ok=True)
        font = TTFont(woff2_path)
        font.flavor = None
        font.save(str(out))
        return out if out.exists() else None
    except Exception:
        return None


def _custom_fontfile(font_family: str | None) -> str | None:
    """Maps a clip's font_family (the display name shown in the editor's
    Font dropdown, e.g. "Pretendard Regular.subset") back to its bundled
    .woff2 file - using the exact same name transform the editor's own font
    listing route (itda/server.py fonts_root listing) uses - then converts
    it to a ttf ffmpeg can actually load."""
    if not font_family or font_family == "system":
        return None
    fonts_dir = _fonts_dir()
    if not fonts_dir.exists():
        return None
    for f in fonts_dir.glob("*.woff2"):
        family = f.stem.replace("_", " ").replace("-", " ")
        if family == font_family:
            ttf = _woff2_to_ttf(f)
            if ttf:
                return str(ttf).replace("\\", "/").replace(":", "\\:")
    return None


class ExportError(Exception):
    pass


def _reject_foreign_clip_paths(clips: list[dict]) -> None:
    """Refuse to render a timeline whose clips point outside ITDA's own media
    directories.

    A clip's "path" is not trusted state: it is read straight out of the
    project file, and `POST /itda/api/project/<name>` writes whatever JSON it
    is handed - so anything able to reach the local port can choose these
    paths. Without this check they go directly to ffmpeg as inputs, which
    will read any file the ComfyUI process can and composite it into the
    exported video; the export is then itself served back over
    /itda/api/file, completing an arbitrary-file-read chain. Rejecting
    outright (rather than skipping the clip) so a tampered project is
    obvious instead of silently rendering short.
    """
    roots = itda_media_roots()
    for c in clips:
        raw = c.get("path")
        if not raw:
            continue
        if not is_contained(Path(raw), roots):
            raise ExportError(
                f"Clip '{c.get('name') or c.get('id')}' points outside ITDA's media folders "
                f"({raw}). Import media through the editor instead of editing project files by hand."
            )


_FORMAT_CODECS = {
    "mp4": {"ext": "mp4", "vcodec": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"], "acodec": ["-c:a", "aac"]},
    "mov": {"ext": "mov", "vcodec": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"], "acodec": ["-c:a", "aac"]},
    "webm": {"ext": "webm", "vcodec": ["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-pix_fmt", "yuv420p"], "acodec": ["-c:a", "libopus"]},
}


def export_timeline(
    project_name: str,
    project: dict[str, Any],
    fmt: str = "mp4",
    out_dir: Path | None = None,
    stem: str | None = None,
    write_manifest: bool = True,
) -> dict[str, Any]:
    """Composes the full ITDA timeline (layered video/image, text burn-in,
    mixed audio) into a single video file (mp4/mov/webm) via one ffmpeg
    filter_complex graph, and records a per-project last_export.json manifest.

    out_dir/stem/write_manifest exist so pre-render can reuse this exact
    compositing path for a sub-range without writing into the user's output
    folder or clobbering last_export.json (which ITDALoadExport reads).
    """
    fmt = fmt.lower() if fmt else "mp4"
    if fmt not in _FORMAT_CODECS:
        fmt = "mp4"
    settings = project.get("settings") or {}
    fps = float(settings.get("fps") or 24)
    total_frames = int(settings.get("total_frames") or 360)
    duration_sec = max(1.0 / fps, total_frames / fps)

    clips = _flatten_clips(project.get("clips") or [])
    _reject_foreign_clip_paths(clips)
    visual = [c for c in clips if c.get("kind") in ("video", "image") and c.get("path")]
    text_clips = [c for c in clips if c.get("kind") == "text" and (c.get("text") or c.get("name"))]
    audio_capable = [
        c for c in clips
        if c.get("kind") in ("video", "audio") and c.get("path") and c.get("audio_enabled") is not False
    ]
    # Solo mirrors the editor's own monitor rule: if anything is soloed,
    # only soloed clips are heard in the export mix too.
    soloed = [c for c in audio_capable if c.get("solo")]
    if soloed:
        audio_capable = soloed

    width, height = _pick_canvas_size(visual)

    safe = safe_name(project_name)
    if out_dir is None:
        out_dir = output_dir() / "ITDA" / safe
    out_dir.mkdir(parents=True, exist_ok=True)
    if stem is None:
        stem = f"{safe}_{time.strftime('%Y%m%d_%H%M%S')}"
    out_path = out_dir / f"{stem}.{_FORMAT_CODECS[fmt]['ext']}"

    inputs: list[str] = []
    filter_parts: list[str] = []
    input_index = 0

    def add_input(path: str, is_image: bool, dur_sec: float) -> int:
        nonlocal input_index
        if is_image:
            inputs.extend(["-loop", "1", "-t", f"{max(dur_sec, 1.0/fps):.6f}", "-i", path])
        else:
            inputs.extend(["-i", path])
        idx = input_index
        input_index += 1
        return idx

    filter_parts.append(f"color=size={width}x{height}:rate={fps}:color=black:duration={duration_sec:.6f}[base0]")
    base_label = "base0"
    layer_n = 0

    # Video/image layers, lowest-priority lane first (T5) up to highest (T1),
    # matching the editor's own "T1 occludes everything below it" rule.
    for c in sorted(visual, key=lambda c: -int(c.get("lane", 0) or 0)):
        start = float(c.get("start", 0) or 0)
        length = max(1.0, float(c.get("length", 1) or 1))
        start_sec = start / fps
        end_sec = (start + length) / fps
        is_image = c.get("kind") == "image"
        if is_image:
            idx = add_input(c["path"], True, length / fps)
            vf = (
                f"[{idx}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setpts=PTS-STARTPTS+{start_sec:.6f}/TB[v{layer_n}]"
            )
        else:
            src_in = float(c.get("source_in", 0) or 0)
            src_out = float(c.get("source_out", src_in + length) or (src_in + length))
            idx = add_input(c["path"], False, 0)
            vf = (
                f"[{idx}:v]trim=start={(src_in/fps):.6f}:end={(src_out/fps):.6f},setpts=PTS-STARTPTS+{start_sec:.6f}/TB,"
                f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2[v{layer_n}]"
            )
        filter_parts.append(vf)
        new_base = f"base{layer_n + 1}"
        filter_parts.append(f"[{base_label}][v{layer_n}]overlay=enable='between(t,{start_sec:.6f},{end_sec:.6f})'[{new_base}]")
        base_label = new_base
        layer_n += 1

    # Text overlays always sit above every visual layer, regardless of the
    # text clip's own lane - matching the editor's preview compositing rule.
    default_fontfile = _drawtext_fontfile()
    for c in sorted(text_clips, key=lambda c: int(c.get("lane", 0) or 0)):
        start = float(c.get("start", 0) or 0)
        length = max(1.0, float(c.get("length", 1) or 1))
        start_sec = start / fps
        end_sec = (start + length) / fps
        text = _escape_drawtext(c.get("text") or c.get("name") or "")
        size = int(c.get("size") or 42)
        color_hex = _safe_color(c.get("color"), "ffffff")
        opacity = float(c.get("opacity") if c.get("opacity") is not None else 1)
        x_pct = float(c.get("x") if c.get("x") is not None else 50)
        y_pct = float(c.get("y") if c.get("y") is not None else 88)
        x_expr = f"(w*{x_pct}/100)-(text_w/2)"
        y_expr = f"h-(h*{y_pct}/100)-(text_h/2)"
        shadow = ""
        if c.get("shadow_enabled"):
            shadow_hex = _safe_color(c.get("shadow_color"), "000000")
            shadow_alpha = float(c.get("shadow_opacity") if c.get("shadow_opacity") is not None else 0.6)
            shadow = f":shadowcolor=0x{shadow_hex}@{shadow_alpha:.3f}:shadowx=2:shadowy=2"
        fontfile = _custom_fontfile(c.get("font_family")) or default_fontfile
        fontfile_part = f":fontfile='{fontfile}'" if fontfile else ""
        new_base = f"txt{layer_n}"
        filter_parts.append(
            # expansion=none: drawtext expands %{...} in text by default, so a
            # subtitle that merely contains a percent sign would either break
            # the export or evaluate as an expression. Nothing here wants that.
            f"[{base_label}]drawtext=expansion=none:text='{text}':x={x_expr}:y={y_expr}:fontsize={size}:"
            f"fontcolor=0x{color_hex}@{opacity:.3f}{shadow}{fontfile_part}:enable='between(t,{start_sec:.6f},{end_sec:.6f})'[{new_base}]"
        )
        base_label = new_base
        layer_n += 1

    # Audio: mix every audio-enabled clip, each delayed to its timeline start.
    audio_labels: list[str] = []
    for c in audio_capable:
        start = float(c.get("start", 0) or 0)
        length = max(1.0, float(c.get("length", 1) or 1))
        src_in = float(c.get("source_in", 0) or 0)
        src_out = float(c.get("source_out", src_in + length) or (src_in + length))
        idx = add_input(c["path"], False, 0)
        start_ms = max(0.0, (start / fps) * 1000.0)
        gain = max(0.0, float(c.get("volume", 100) or 100) / 100.0)
        alabel = f"a{len(audio_labels)}"
        filter_parts.append(
            f"[{idx}:a]atrim=start={(src_in/fps):.6f}:end={(src_out/fps):.6f},asetpts=PTS-STARTPTS,"
            f"adelay={start_ms:.0f}|{start_ms:.0f},volume={gain:.4f}[{alabel}]"
        )
        audio_labels.append(alabel)

    has_audio = bool(audio_labels)
    if has_audio:
        mix_inputs = "".join(f"[{l}]" for l in audio_labels)
        filter_parts.append(f"{mix_inputs}amix=inputs={len(audio_labels)}:duration=longest:normalize=0[aout]")

    filter_complex = ";".join(filter_parts)

    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    cmd += inputs
    cmd += ["-filter_complex", filter_complex, "-map", f"[{base_label}]"]
    if has_audio:
        cmd += ["-map", "[aout]"]
    codec = _FORMAT_CODECS[fmt]
    cmd += ["-t", f"{duration_sec:.6f}", "-r", str(fps)]
    cmd += codec["vcodec"]
    if has_audio:
        cmd += codec["acodec"]
    cmd += [str(out_path)]

    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=1800, text=True)
    except subprocess.CalledProcessError as e:
        raise ExportError(e.stderr or str(e))
    except subprocess.TimeoutExpired as e:
        raise ExportError(f"Export timed out: {e}")

    if not out_path.exists():
        raise ExportError("ffmpeg finished but produced no output file")

    manifest = {
        "ok": True,
        "project": safe,
        "path": str(out_path),
        "fps": fps,
        "total_frames": total_frames,
        "width": width,
        "height": height,
        "has_audio": has_audio,
        "format": fmt,
        "created_at": time.time(),
    }
    if write_manifest:
        (out_dir / "last_export.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def prerender_range(project_name: str, project: dict[str, Any], start_frame: int, end_frame: int) -> dict[str, Any]:
    """Flattens [start_frame, end_frame) of the timeline into one cached video
    so the editor can play that stretch back as a single decode instead of
    seeking several layered <video> elements in lockstep every frame.

    Built by rewriting the range into a standalone project - clips shifted so
    the range's start becomes frame 0, and trimmed to the parts that actually
    fall inside it - then handing that to the normal export path, so what gets
    pre-rendered is by construction the same composite the export produces.
    """
    fps = float((project.get("settings") or {}).get("fps") or 24)
    start_frame = max(0, int(start_frame))
    end_frame = int(end_frame)
    if end_frame <= start_frame:
        raise ExportError("Pre-render needs a non-empty range - mark In (I) and Out (O) first.")

    span = end_frame - start_frame
    sub_clips: list[dict] = []
    for c in _flatten_clips(project.get("clips") or []):
        c_start = int(c.get("start", 0) or 0)
        c_end = c_start + int(c.get("length", 0) or 0)
        ov_start, ov_end = max(c_start, start_frame), min(c_end, end_frame)
        if ov_end <= ov_start:
            continue
        n = dict(c)
        head = ov_start - c_start  # frames of this clip that fall before the range
        n["start"] = ov_start - start_frame
        n["length"] = ov_end - ov_start
        src_in = int(c.get("source_in", 0) or 0) + head
        n["source_in"] = src_in
        n["source_out"] = src_in + n["length"]
        sub_clips.append(n)

    if not sub_clips:
        raise ExportError("Nothing on the timeline inside that range.")

    sub = dict(project)
    sub["clips"] = sub_clips
    sub["settings"] = {**(project.get("settings") or {}), "total_frames": span}

    safe = safe_name(project_name)
    out_dir = itda_root() / "cache" / safe / "prerender"
    # Deterministic stem: re-rendering the same range replaces its cache file
    # instead of piling up a new one on every click.
    manifest = export_timeline(
        project_name, sub, fmt="mp4",
        out_dir=out_dir, stem=f"prerender_{start_frame}_{end_frame}", write_manifest=False,
    )
    manifest["start_frame"] = start_frame
    manifest["end_frame"] = end_frame
    manifest["fps"] = fps
    return manifest
