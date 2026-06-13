# ComfyUI-ITDA

ITDA (잇다) = Stitch  
Connect Frames. Connect Stories.

Frame-Accurate AI Video Stitching Environment for ComfyUI workflows.

## v0.2.7

Open editor:

```text
http://127.0.0.1:8189/itda/editor
```

Use your actual ComfyUI port. If ComfyUI runs on 8188, use 8188. If it runs on 8189, use 8189.

## Path Policy

ITDA uses ComfyUI official paths:

```text
ComfyUI/input/ITDA
ComfyUI/input/ITDA-SNAPSHOT
ComfyUI/output/ITDA
```

Project JSON files:

```text
ComfyUI/input/ITDA/projects
```

Package-local input/output folders are not used.

## Current Scope

v0.2.7 is a Foundation + Real Waveform build:

- Media Bin
- Timeline
- Layer-based Preview
- T1~T5 Layer Rule
- Audio Monitor Rule
- Text Clip preview
- Editable Clip Properties
- Project FPS / Total Frame sync

Export and ComfyUI bridge are reserved for later versions.


## v0.1.5e Hotfix

- Preview monitor volume control.
- Timeline/Header shortcut pass.
- Group / Ungroup linked selection.
- Stitch / UnStitch visual state.
- Video frame-0 thumbnail extraction.
- Transparent Text Clip preview overlay.


## v0.1.5f Hotfix
- Media import uploads to ComfyUI/input/ITDA/media/<project>.
- Media delete removes library file after confirmation.
- Snapshot API saves PNG to ComfyUI/input/ITDA-SNAPSHOT.
- Monitor volume limited to 0-100%.
- Group movement blocked as one unit at frame 0 / collision boundary.
- Split creates stable independent clips.
- Stitch creates a real stitched clip with restorable children.
- Timeline vertical zoom added for future waveform display.


## v0.1.5 final4 track-state hotfix
- Track preview enable/disable icon state clarified.
- Track lock icon state clarified.
- Lane label area now visually changes: preview OFF = gray, locked = dark red.
- Track toggle buttons now prevent default event leakage and refresh preview/properties safely.

## v0.2.7 Real Audio Waveform Engine

- FFmpeg decodes video/audio media audio streams to mono PCM.
- ITDA generates normalized peak data and stores it as `.wave.json`.
- Timeline waveform display now uses real cache data only.
- Fake placeholder waveform bars were removed.

Cache path:

```text
ComfyUI/input/ITDA/cache/<project>/waveforms
```


## Text Clip Fonts

Place font files in:

```text
ComfyUI-ITDA/Fonts/
```

Supported formats:

```text
.ttf
.otf
.woff
.woff2
```

Restart ComfyUI after adding fonts. The fonts appear in Clip Properties > Text / Overlay > Font.

Text Clip default style has no shadow. Shadow can be enabled manually with color and opacity controls.


## v0.2.5
- Text input focus/caret hotfix.

### v0.2.6 Audio Monitor / Waveform
- Two selected clips now monitor A+B audio during playback and scrub.
- Scrub Audio toggle controls pause-state audio scrubbing.
- Video/audio timeline clips display an embedded waveform when browser audio decoding is available.


### v0.2.8 Waveform / Audio Trim Hotfix

- Real waveform display visibility improved.
- Audio playback now respects timeline clip trim boundaries.
- Scrub Audio default is OFF.


### v0.3.1 Timeline Clip Length Guard

- Video/audio clips cannot extend beyond their original source media length.
- Timeline trim, source_in, source_out, and waveform display are clamped together.
- Image/text clips remain freely extendable as timeline overlays.

