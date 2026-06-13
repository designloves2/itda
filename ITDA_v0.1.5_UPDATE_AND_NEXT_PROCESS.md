# ITDA v0.1.5a Update & Next Process

## Version
v0.1.5a Foundation Complete Pass

## Core Update Summary

### Timeline
- Empty timeline click clears clip selection.
- ESC clears clip selection.
- Playhead / navigation ruler is independent from selected clips.
- T1~T5 fixed layer structure is applied.
- T1 is the highest visual layer, then T2, T3, T4, T5.
- Timeline preview now resolves the visible clip from current playhead position by layer priority.
- Delete / Backspace removes selected clips.
- Ctrl + Click supports multi selection.
- Non-selected clips are shown at 60% opacity while clips are selected.
- Clip colors are separated by media type:
  - Video: Purple
  - Audio: Green
  - Image: Orange
  - Text: Blue/Cyan
- Track visibility and lock controls are added to T1~T5.
- In / Out / Clear Range controls are added.
- Loop toggle remains in the preview controller.
- Project FPS and Total Frames are synchronized with the timeline ruler.

### Audio Monitor Rule
- 1 selected clip: monitor selected clip audio only.
- 2 selected clips: monitor both selected clip audio.
- 3 or more selected clips: mute.
- No selection: monitor current playhead position's highest layer audio.
- Mute option overrides all monitor modes.

### Preview
- Preview is layer-based, not selected-clip-only.
- Compare and Overlay are enabled only when exactly two clips are selected.
- Compare mode displays two selected clips as split-screen.
- Overlay mode displays the second selected clip with opacity over the first.
- Preview click toggles Play/Pause.
- Fullscreen button is implemented.
- Snapshot button shows a save notification and reserves the snapshot API path.
- Preview FPS / Total frame display is synchronized with project settings.

### Media Bin
- Media cards keep square thumbnails with black padding.
- Video thumbnails use the first frame via HTML video metadata preview.
- Individual media delete button is available on each card.
- Thumbnail / list view toggle is available.
- + Video / + Audio / + Image / + Text controls are available.
- Media double-click loads media into the Preview monitor.
- Media Bin thumbnail size slider is added.

### Text Clip
- Text Clip is added as a rendered subtitle/caption style clip.
- Text Clip can be placed on the timeline like video/audio/image clips.
- Text preview overlay is supported.
- Editable properties include:
  - Text
  - X / Y position
  - Size
  - Opacity
- Export burn-in is reserved for a later FFmpeg/ASS implementation.

### Clip Properties
- Clip Properties is now an editable inspector.
- Editable fields:
  - Name
  - Type
  - Lane
  - Start
  - Length
  - Trim In
  - Trim Out
  - Text
  - X / Y
  - Size
  - Opacity
- Property changes apply directly to the selected clip.

### Header
- Header layout:
  - Settings
  - Project
  - Project Name
  - Load
  - Save
  - Export
  - Send To ComfyUI
  - ITDA brand on the right
- Default project name is `itda-project-1`.
- Project menu is treated as a Project Library manager.
- Settings handles FPS / Total Frames / Frame Policy.

### Security / Path Policy
- Internal node-package input/output folders are removed.
- ITDA now uses ComfyUI official input/output directories:
  - `ComfyUI/input/ITDA`
  - `ComfyUI/input/ITDA-SNAPSHOT`
  - `ComfyUI/output/ITDA`
- Project JSON files are stored under:
  - `ComfyUI/input/ITDA/projects`
- This path structure is intended for ComfyUI Manager security compatibility.

### UI / Responsive
- Broken icon layout is reset.
- Button size is unified through CSS variables.
- Responsive base sizing is applied to buttons, icons, fonts, and panel elements.
- Timeline scrollbars use dark theme styling.

---

# Known Limitations in v0.1.5a

- Snapshot file writing API is still reserved; current implementation provides UI notification only.
- Real FFmpeg export is not implemented yet.
- Text Clip export burn-in is not implemented yet.
- Waveform display is not implemented yet.
- Audio mixing is browser-preview level only, not final render mixing.
- Project Library delete/duplicate/open UI exists, but full project library scan API is not finalized.
- Compare / Overlay are UI-level preview functions; frame-perfect backend compare is a later task.

---

# Next Process

## v0.1.6 Stabilization Pass
- Test at 1280x720, 1920x1080, 2560x1440, 3440x1440, 3840x2160.
- Fix any responsive breakage.
- Verify timeline ruler scaling with FPS changes.
- Verify media card size slider.
- Verify clip drag / trim / lane lock behavior.
- Verify layered preview with T1~T5 overlap.
- Verify Text Clip preview behavior.

## v0.2 Real Editing
- Split accuracy refinement.
- Stitch behavior refinement.
- Group / Ungroup behavior refinement.
- Duplicate.
- Copy / Paste.
- Box Select.
- Advanced Snap.
- Text Clip subtitle workflow improvement.

## v0.3 Sync Editing
- Audio waveform generation.
- Waveform cache.
- Audio peak alignment.
- A/B audio sync monitor.
- Gain / Mute / Solo.

## v0.4 ComfyUI Bridge
- Send selected clip to ComfyUI.
- Send selected range to ComfyUI.
- Send full timeline to ComfyUI.
- IMAGE Batch / VIDEO Batch / AUDIO Batch transfer design.

## v0.5 AI Review
- Generated media management.
- Version stack.
- Original / generated compare.
- Difference overlay.

## v0.6 Export Engine
- MP4 / MOV / WEBM export.
- Text Clip burn-in using ASS subtitle or FFmpeg drawtext.
- Audio mixdown.

## v0.7 Frame Stitching Engine
- Overlap analysis.
- Frame matching.
- Audio matching.
- Motion matching.
- Auto stitch suggestion.

## v0.8 AI Assist
- Whisper subtitle generation.
- Speaker detection.
- Beat detection.
- Scene detection.

## v1.0 Production Release
- Frame-accurate stitching workflow stabilized.
- ComfyUI bridge stabilized.
- Export engine stabilized.


## v0.1.5f Hotfix
- Media import uploads to ComfyUI/input/ITDA/media/<project>.
- Media delete removes library file after confirmation.
- Snapshot API saves PNG to ComfyUI/input/ITDA-SNAPSHOT.
- Monitor volume limited to 0-100%.
- Group movement blocked as one unit at frame 0 / collision boundary.
- Split creates stable independent clips.
- Stitch creates a real stitched clip with restorable children.
- Timeline vertical zoom added for future waveform display.
