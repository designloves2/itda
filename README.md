# ComfyUI-ITDA v1.0

ITDA (잇다) = Stitch
**Connect Frames. Connect Stories.**

A frame-accurate, layered video editor that runs inside ComfyUI — built for the workflow where you generate video clips with AI and then have to make them into one continuous piece.

---

## Why this exists

Generating a long AI video means generating several clips and joining them. The join is the hard part: two clips usually overlap in content, and finding the exact frame where one should end and the next should begin is fiddly, manual work. ITDA is built around that problem — everything else (timeline, layers, text, audio, export) exists to support it.

## Opening the editor

```text
http://127.0.0.1:8188/itda/editor
```

Use your actual ComfyUI port. You can also add the **ITDA Open Editor** node to a workflow and get the editor embedded directly in the graph.

## Features

**Timeline**
- 5 layered tracks (T1 = topmost). Per-track preview toggle and lock.
- Frame-accurate trim, split, group/ungroup, stitch/unstitch.
- Magnetic snapping to neighbouring clip edges (not a fixed grid).
- Box select (drag a rectangle) and Shift+click range select.
- Duplicate (Ctrl+D), copy/paste (Ctrl+C / Ctrl+V).

**Preview**
- Single, Compare, Overlay, and **Wipe** (draggable split) modes.
- Real pixel-dense audio waveforms rendered on clips.

**Audio**
- Per-clip on/off, Solo, and Gain (0–200%).
- Detach audio from video, and merge it back.

**Auto Stitch** — the core feature
- Analyses the overlap between two selected clips and recommends where to cut.
- Scores each candidate on **frame similarity** and **motion continuity**, then shows the top 5 with scores. Nothing is applied until you click Apply.

**AI Detect**
- **Scene Detect** — finds shot changes inside a clip and splits it at each one.
- **Beat Detect** — tracks tempo, marks beats on the timeline, and feeds them into Peak Match snapping.

**Text**
- Font (bundled fonts included), size, position, colour, opacity, shadow.
- Burned into the export with correct Hangul/CJK rendering.

**Versions**
- Keep multiple takes of a clip, switch the active one, and compare any two side by side in Wipe view.

**Pre-render**
- Flattens the marked In/Out range into one cached file so a heavy stretch plays back smoothly. Automatically stops being used the moment you edit anything, so you never watch a stale render.

**Export**
- MP4 / MOV / WebM, composited through a single ffmpeg pass.

**ComfyUI bridge**
- Send a clip, a range, or the whole timeline to the graph as loader nodes.
- `ITDA Open Editor` → in-graph editor + project name output.
- `ITDA Load Export` → loads the last export as an IMAGE batch + AUDIO.

## Paths

ITDA uses ComfyUI's official directories only. It never writes inside its own package folder.

```text
ComfyUI/input/ITDA/projects      project .itda.json files
ComfyUI/input/ITDA/media/<proj>  imported media
ComfyUI/input/ITDA/cache/<proj>  thumbnails, waveform cache
ComfyUI/input/ITDA-SNAPSHOT      snapshots
ComfyUI/output/ITDA/<proj>       exports
```

Every path-taking API is confined to these roots and rejects anything outside them — on the read side as well as the write side, and for paths that arrive as data (a clip's `path`, an export manifest) as well as request arguments. Containment resolves the path first (collapsing `..` and symlinks) and then checks real parentage rather than a string prefix, so `/a/bc` is never mistaken for being inside `/a/b`.

## Fonts

Drop `.ttf` / `.otf` / `.woff` / `.woff2` files into:

```text
ComfyUI-ITDA/Fonts/
```

Restart ComfyUI. They appear in Clip Properties → Text / Overlay → Font, and are used for burn-in on export too (`.woff2` is converted to `.ttf` automatically, since ffmpeg cannot read web fonts).

## Requirements

ffmpeg and ffprobe must be on PATH. Everything else ships with ComfyUI. Optional: OpenCV enables Motion Match, librosa enables Beat Detect — both are already present in standard ComfyUI installs, and each feature degrades gracefully if its library is missing.

## Notes / limitations

- **Auto Stitch does not use audio to rank cuts.** It was measured against known-correct cut points on generated footage and could not separate good cuts from bad ones — the score ranges overlapped completely, and ranking on it demoted the objectively perfect cut to last place. Audio level is still shown next to each candidate for reference. See the comments in `itda/stitch.py` for the full reasoning.
- Speech-to-text subtitles and speaker detection are deliberately **not** included: AI-generated clips rarely contain dialogue to transcribe, and the dependencies would put a working ComfyUI install at risk for a feature with nothing to run on.
- ITDA assumes it is reachable only from localhost, exactly like ComfyUI itself.
