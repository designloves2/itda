# Changelog

## v1.0.0 - First complete release

Everything on the original v0.1.5→v1.0 roadmap is implemented, with two
deliberate exclusions documented under "Not included" below.

### Added - Auto Stitch (the v0.7 Frame Stitching Engine)
- `itda/stitch.py`: analyses the overlap between two selected video clips near their shared boundary and recommends where to cut A and where to start B.
- Scores every candidate independently on **frame similarity** (mean-squared difference over a decoded window) and **motion continuity** (Farneback optical flow — does the camera keep moving the same way through the cut).
- Top 5 candidates are shown with their scores; nothing is applied until Apply is clicked.
- `POST /itda/api/stitch_analyze`. Analysis window length is user-settable.

### Added - AI Detect (the v0.8 AI layer)
- `itda/analyze.py`.
- **Scene Detect**: finds shot changes via ffmpeg's own `scene` score (one decode pass, not a Python-side frame diff), then splits the clip at each one. Sensitivity is adjustable. `POST /itda/api/scene_detect`.
- **Beat Detect**: tempo + beat positions via librosa, fed PCM decoded by ffmpeg. Beats render as ticks on the clip and become snap targets for Peak Match. Persisted per media path in project settings. `POST /itda/api/beat_detect`.

### Added - editing
- Box Select (drag a rectangle over the timeline) and Shift+click range select.
- Wipe Compare preview mode with a draggable split handle.
- Peak Match: snapping to audio transients and detected beats, not just clip edges.
- Version Stack: multiple takes per clip, switch the active one, compare any two in Wipe view.
- Per-clip Solo and Gain (0–200%), honoured in both preview and export.
- MOV and WebM export alongside MP4.
- Whole-timeline batch Send To ComfyUI (zero selection sends everything).

### Added - Pre-render
- The Pre-render button was previously a stub that did nothing but report itself as a stub. It now flattens the marked In/Out range into a single cached video (`input/ITDA/cache/<project>/prerender/`) and plays that back inside the range instead of seeking every layer in lockstep. `POST /itda/api/prerender`.
- Built by rewriting the range into a standalone project and handing it to the normal export path, so what is pre-rendered is by construction the same composite Export produces.
- The cache carries a signature of the timeline it was baked from and stops being used the moment anything changes — showing a stale render silently would be worse than the stutter this removes. The preview is badged `PRE-RENDERED` while the cache is driving it.

### Security
All of the below were found by auditing against the containment standard
ComfyUI-Manager applies to node registrations (reject absolute paths and `..`;
verify with realpath/commonpath-style containment, never a string prefix).
ITDA already used `Path.resolve()` + `.parents` containment everywhere and had
no `startswith()`-based path checks — these were the gaps around it.

- **Fixed a path-restriction bypass.** `safe_name()` stripped path separators but let `.` and `..` through unchanged. A project named `..` collapsed the per-project sandbox one level up — `media/<project>` resolved to the whole ITDA root — which let any project-scoped route reach every other project's files. Most seriously, `POST /itda/api/media/delete` would then accept any file under `input/ITDA`, including every saved `.itda.json`. Dot-only names are now rejected.
- **Fixed an arbitrary-file-read chain through Export.** A clip's `path` is read straight out of the project file, and `POST /itda/api/project/<name>` stores whatever JSON it is given — so anything able to reach the local port could point a clip at any file on disk, have ffmpeg composite it into the export, and then fetch the result back through `/itda/api/file`. Clip paths are now required to be inside ITDA's own media directories, and a timeline that violates this is refused rather than silently rendered short.
- **Fixed an arbitrary file read in `ITDA Load Export`.** The node trusted `path` from `last_export.json` and handed it straight to a decoder, so a tampered or shipped-in manifest could name any file and have its contents emitted as the node's IMAGE/AUDIO output. The path must now resolve inside that project's own export folder.
- **Fixed an ffmpeg filter-option injection.** Text clip `color` / `shadow_color` were interpolated into the `drawtext` filter without validation, so a value like `ffffff:textfile=C\:/secret.txt` appended a real drawtext option — `textfile=` renders that file's contents into the exported video. Colors must now be exactly six hex digits or the default is used. (The `text` field itself was already escaped correctly.)
- Hardened `drawtext` with `expansion=none`, so a subtitle containing `%` is drawn literally instead of being evaluated as an expression.
- Containment now goes through one shared `is_contained()` helper, so there is a single place for this logic to be right.

### Fixed
- **ffmpeg no longer freezes ComfyUI.** Every ffmpeg call ran synchronously inside its async route handler, blocking the shared aiohttp event loop — ComfyUI's, not just ITDA's — for the call's full duration, up to the 30-minute export timeout. All of them now run off the loop; the server stays responsive (health replies in ~3 ms) while an export runs.

### Removed
- `itda_server.py` and `web/itda_editor.html`: superseded by `itda/server.py` and `web/index.html` and referenced by nothing. Copies are kept in `_removed_v1.0_backup/` since this package is not tracked by git.

### Changed
- **Auto Stitch no longer ranks candidates using audio.** Measured against known-correct cut points on real generated footage, the audio metric could not separate good cuts from bad ones: score ranges for continuous and discontinuous cuts overlapped completely, and a deliberate jump to unrelated footage scored *higher* than a genuinely continuous cut. Ranking on it demoted the objectively perfect cut to last place (0/5 on ground truth). Frame + motion alone scores 5/5. Audio level is still displayed for reference, clearly marked as not affecting ranking. Reasoning is recorded in `itda/stitch.py`.
- Project schema version → `1.0.0`. Existing project files keep the version they were saved with.

### Not included (deliberately)
- **Whisper subtitles / speaker detection.** Both need packages that aren't installed and that pin dependencies shared with other custom nodes. More to the point, AI-generated clips rarely contain dialogue to transcribe, so the feature would have had nothing to run on. Scene and beat detection — the parts of the AI layer that do fit this workflow — are included.
- **Cross-correlation audio alignment.** Distinct from the rejected scoring metric above; would be worth adding if clips with genuinely overlapping audio become part of the workflow.

## v0.4.0 - Send To ComfyUI (Selected Clip)

### Added
- Real backend export: selected clip's trimmed range (video/audio) or frame (image) is rendered via ffmpeg into `ComfyUI/input/ITDA/send/<project>/` (`POST /itda/api/send_to_comfy`).
- "Send To ComfyUI" button now exports the single selected clip and opens the main ComfyUI graph in a new tab.
- If an In/Out range is marked, only the portion of the selected clip inside that range is exported (Selected Range send).
- New `web/itda_bridge.js` ComfyUI frontend extension: reads the `itda_send`/`itda_kind` URL params on load and drops a matching core loader node (`LoadImage` / `LoadVideo` / `LoadAudio`) pre-filled with the exported file.
- Fixed a latent `NameError` in `extract_image_snapshot` (`shutil` was used without being imported).

### Known limitations
- Only a single selected clip can be sent at a time; range/full-timeline batch send is planned for a later v0.4 pass.
- Text and stitched clips are not yet sendable.

## v0.3.2 - Timeline Navigation / Waveform Alignment Patch

### Fixed
- Improved source-frame waveform alignment for trimmed clips.
- Changed waveform rendering to source-frame indexed bars to reduce micro drift.
- Made timeline ruler sticky during vertical scroll.
- Extended playhead/navigation bar height across the full timeline content.


## v0.3.1 - Waveform Source Alignment Patch

### Fixed
- Trimmed clip waveform now uses source-frame aligned sampling.
- Front-trimmed/back-trimmed clips now display the exact matching waveform segment from the original media.
- Increased waveform peak cache density for more stable overlap/sync comparison.

# Changelog

## [0.2.7] - 2026-06-12

### Added
- Real Audio Waveform Engine using FFmpeg PCM peak analysis.
- `/itda/api/waveform` backend endpoint.
- Per-project waveform cache under `ComfyUI/input/ITDA/cache/<project>/waveforms`.

### Changed
- Removed fake/random placeholder waveform bars from timeline clips.
- Video and audio clips now render waveform only from real decoded audio peak data.

## [0.1.5c] - 2026-06-11

### Fixed
- Fixed playhead jump back to clip start when navigation reaches clip end frame.
- Preserved multi-clip selection while dragging one selected clip.
- Added grouped multi-selection movement behavior.
- Restored same-track non-overlap rule while keeping cross-track layer overlap workflow.
- Added paused-state audio scrub monitoring for selected clip audio.
- Kept ruler/playhead navigation independent from clip selection.

## [0.1.5a] - 2026-06-11

### Fixed
- Preview transport controls centered and frame/time moved to a second row.
- Restored timeline clip selection with pointer events.
- Prevented browser text selection while dragging the timeline ruler/navigation bar.
- Reconnected Media Bin thumbnail scale slider to card thumbnail size.
- Added preview source reset fallback to avoid stale/blank preview states.
- Kept same-lane clip overlap allowed by preserving free-layer timeline behavior.

# Changelog

A record of the notable changes to this project.

## [0.1.5] - 2026-06-11

### Added
- Layer-based T1~T5 preview rule.
- Audio Monitor rule for selected clip count.
- Text Clip support for subtitle/caption style rendered text.
- Editable Clip Properties inspector.
- Media Bin `+ Text` button.
- Media Bin thumbnail size slider.
- Timeline In / Out / Clear Range buttons.
- Track visibility and lock controls.
- Preview fullscreen button.
- Preview click Play/Pause.
- Compare / Overlay UI-level preview behavior for exactly two selected clips.
- v0.1.5 update and roadmap documentation.

### Changed
- Preview is no longer selected-clip-only. It is resolved by playhead position and layer priority.
- Playhead navigation is independent from clip selection.
- Project FPS / Total Frame settings synchronize timeline display.
- Clip colors now differ by type: video, audio, image, text.
- Header layout updated to Settings / Project / Project Name / Load / Save / Export / Send To ComfyUI / ITDA.
- ITDA project paths now use ComfyUI input/output directories.

### Removed
- Package-local `input/` and `output/` folders from the distributed node package.
- Duplicate preview settings button.

### Fixed
- Empty timeline click now clears selected clips.
- Delete / Backspace deletes selected clips.
- Non-selected clips dim to 60% opacity when another clip is selected.
- Timeline scrollbar dark-theme styling.
- Broken icon/button layout pass from v0.1.4.

## [0.1.4] - 2026-06-11

### Added
- Initial header, preview, media bin, timeline, and properties UI polish pass.

## [0.1.5b] - 2026-06-11
### Fixed
- Preview transport layout changed to 2-row structure.
- Preview control icons are centered relative to preview panel.
- Frame / time / FPS-total readout aligned on the second row.
- Timeline ruler drag now preserves current clip selection.
- Timeline ruler drag now prevents browser text selection more aggressively.

## [0.1.5d] - 2026-06-11

### Fixed
- Added a project total-frame end marker line on the timeline ruler.
- Fixed loop playback stopping at the last frame of the leading clip in an overlap range.
- Decoupled playback playhead advancement from individual video element end/timeupdate events.

### Changed
- Added keyboard shortcuts for Preview modes and control buttons: `1` Single, `2` Compare, `3` Overlay, `L` Loop, `M` Mute, `F` Fullscreen, `P` Snapshot.

## [0.1.5e] - 2026-06-11

### Added
- Preview monitor volume control with 0-200% range.
- Timeline editing shortcuts: `S` Snap, `C` Split, `Shift+M` Stitch, `Shift+U` UnStitch, `G` Group, `Shift+G` Ungroup, `D` Detach Audio, `R` Pre-render.
- Header shortcuts: `Ctrl+O` Load, `Ctrl+S` Save, `Ctrl+E` Export, `Ctrl+Enter` Send To ComfyUI, `Ctrl+,` Settings, `Ctrl+P` Project Library.
- Tooltip labels for shortcut-enabled header, preview, and timeline buttons.
- Video thumbnail extraction from frame 0 via FFmpeg during Media Bin scan.
- Non-destructive Stitch/UnStitch state. Stitched clips display pink.
- Group selection behavior. Selecting one grouped clip selects the entire group. Grouped clips display mint highlight.

### Changed
- Text clips are treated as transparent overlay captions in Preview.
- Ruler scrubbing during playback now keeps playback active and updates the playback clock from the scrubbed frame.

### Fixed
- Playback navigation bar could become locked after pause-state audio scrub monitoring.
- Monitor volume is now applied to both playback preview audio and pause-state scrub audio.


## v0.1.5f Hotfix
- Media import uploads to ComfyUI/input/ITDA/media/<project>.
- Media delete removes library file after confirmation.
- Snapshot API saves PNG to ComfyUI/input/ITDA-SNAPSHOT.
- Monitor volume limited to 0-100%.
- Group movement blocked as one unit at frame 0 / collision boundary.
- Split creates stable independent clips.
- Stitch creates a real stitched clip with restorable children.
- Timeline vertical zoom added for future waveform display.


## [0.1.5-final2] - 2026-06-11

### Fixed
- Text Clip preview now renders as a transparent overlay over the active video/image layer instead of replacing the preview with a black background.
- Added editable Text Color field under Opacity in Clip Properties.
- Added Media Bin drag-and-drop import support for video/audio/image files.
- PNG/WebP/JPG image import remains supported; PNG/WebP alpha is preserved in preview.


## v0.1.5 final4 track-state hotfix
- Track preview enable/disable icon state clarified.
- Track lock icon state clarified.
- Lane label area now visually changes: preview OFF = gray, locked = dark red.
- Track toggle buttons now prevent default event leakage and refresh preview/properties safely.

## [0.2.2] - 2026-06-12

### Added
- Text Clip font loading from `ComfyUI-ITDA/Fonts`.
- Text Clip shadow controls: ON/OFF, shadow color, shadow opacity.

### Changed
- Text Clip default style is clean text with no shadow.
- Text Clip properties now include Font selection.

### Fixed
- Text Clip overlay remains transparent by default.

## v0.2.3 - Keyboard Text Input Fix

### Fixed
- Disabled global shortcuts while the cursor is inside text-editable fields.
- Text Clip and Project Settings inputs now allow normal typing without triggering timeline/preview shortcuts.
- IME composition input is protected from global shortcut handling.

## v0.2.5 - Text Input Caret Fix

### Fixed
- Fixed all Clip Properties text/number/color fields losing focus after a single key press.
- Disabled expensive panel/timeline re-rendering during active input.
- Added model-only live updates while typing and full commit on change/blur.
- Preserved global shortcut blocking while input fields are focused.

## [0.2.6] - 2026-06-12
### Fixed
- Restored two-selected-clips audio monitoring during playback.
- Fixed audio monitor becoming muted after the first selected clip ended.
- Added audio monitor rebuild on seek/playhead changes.

### Added
- Scrub Audio ON/OFF toggle for pause-state ruler scrubbing.
- Audio waveform display inside video/audio clip blocks.


## v0.3.0 - Timeline Clip Length Guard

### Fixed
- Prevented video/audio clips from being trimmed longer than their source media length.
- Right trim now clamps to `source_total_frames - source_in`.
- Left trim now clamps `source_in`, `source_out`, and visible clip length together.
- Waveform rendering now stays bound to the actual trimmed media range instead of stretching beyond available media.
- Split clips keep valid source frame bounds after splitting.


## v0.2.8 - Waveform / Audio Trim Hotfix

- Improved real waveform visibility inside video/audio clip blocks.
- Waveform display now respects clip source trim range.
- Trim handles now receive pointer events across the full clip height.
- Audio monitoring now plays only within the timeline-trimmed clip range.
- Scrub Audio default changed to OFF.


## v0.3.3 - Trim Frame-Accurate Hotfix

### Fixed
- Clip trim handles now move in 1-frame increments.
- Timeline Snap remains active for clip movement, but no longer forces trim edits into 8-frame steps.
- Improved fine trim control for stitch/sync adjustment.
