import json
import subprocess
from pathlib import Path

from .itda.paths import is_contained, output_dir, safe_name, itda_root


def _list_projects() -> list[str]:
    """Project names come from the saved .itda.json files, not free typing -
    there's no reason to make users remember/type an exact project name."""
    try:
        root = itda_root() / "projects"
        names = sorted(p.name[: -len(".itda.json")] for p in root.glob("*.itda.json"))
        return names or ["itda-project-1"]
    except Exception:
        return ["itda-project-1"]


class ITDAOpenEditor:
    """Opens the ITDA editor for a project, embedded in the graph."""

    DESCRIPTION = (
        "Opens the ITDA video editor for the selected project, embedded directly in the graph. "
        "Also outputs the project name so it can be wired into ITDA Load Export."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "project_name": (_list_projects(), {"tooltip": "ITDA project to open. The list is read from ComfyUI/input/ITDA/projects."}),
            }
        }

    # project_name first (and first output wires are the default drag target
    # in the graph) so this can connect straight into ITDALoadExport's own
    # project_name input - picking a project here and feeding the same name
    # downstream, instead of having to set it twice.
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("project_name", "editor_url")
    OUTPUT_TOOLTIPS = (
        "The selected project's name. Connect this to ITDA Load Export's project_name_override input.",
        "Relative URL of the editor for this project.",
    )
    FUNCTION = "open_url"
    CATEGORY = "ITDA"

    def open_url(self, project_name="project"):
        return (project_name, f"/itda/editor?project={project_name}")


class ITDALoadExport:
    """Loads the most recently exported ITDA timeline (itda/export.py writes
    a last_export.json manifest per project) as an IMAGE batch + AUDIO.

    Decoupled from the editor by design: this node just reads whatever the
    last "Export" click produced on disk, so running the ComfyUI queue always
    delivers the latest export without needing any live connection.
    """

    DESCRIPTION = (
        "Loads the most recent ITDA export for a project as an IMAGE batch plus AUDIO. "
        "Click Export in the ITDA editor first; this node then reads whatever that produced on disk."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "project_name": (_list_projects(), {"tooltip": "ITDA project whose latest export should be loaded. Ignored if project_name_override is connected."}),
            },
            # ComfyUI's combo-typed inputs can't accept a plain STRING
            # connection (LiteGraph.isValidConnection('STRING','COMBO') is
            # false in this build), so wiring ITDAOpenEditor's project_name
            # output straight into the combo widget isn't possible. This
            # separate optional STRING input is what that output should
            # connect to instead - when wired, it overrides the dropdown.
            "optional": {
                "project_name_override": ("STRING", {
                    "default": "", "forceInput": True,
                    "tooltip": "Optional. Connect ITDA Open Editor's project_name output here; when connected it takes priority over the dropdown above.",
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "INT", "FLOAT")
    RETURN_NAMES = ("frames", "audio", "frame_count", "fps")
    OUTPUT_TOOLTIPS = (
        "Every frame of the export as an IMAGE batch.",
        "The export's mixed audio track.",
        "Number of frames in the batch.",
        "Frames per second the timeline was exported at.",
    )
    FUNCTION = "load"
    CATEGORY = "ITDA"

    @classmethod
    def VALIDATE_INPUTS(cls, project_name, project_name_override=""):
        # Fail fast with a clear message before the queue even starts,
        # rather than only surfacing "no export found" as an execution error
        # after other nodes may have already run.
        resolved = project_name_override or project_name
        manifest_path = output_dir() / "ITDA" / safe_name(resolved) / "last_export.json"
        if not manifest_path.exists():
            return (
                f"No export found for project '{resolved}'. "
                f"Open it in the ITDA editor and click Export first."
            )
        return True

    def load(self, project_name="itda-project-1", project_name_override=""):
        project_name = project_name_override or project_name
        import numpy as np
        import torch
        import cv2

        safe = safe_name(project_name)
        manifest_path = output_dir() / "ITDA" / safe / "last_export.json"
        if not manifest_path.exists():
            raise RuntimeError(
                f"No export found for project '{project_name}'. "
                f"Click Export in the ITDA editor first."
            )
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        # last_export.json is a file on disk, so its "path" is data, not a
        # trusted internal value - a hand-edited or shipped-in manifest could
        # name anything. Unchecked it goes straight to a decoder and comes
        # back out as this node's IMAGE/AUDIO output, which turns "load my
        # export" into "read any file the ComfyUI process can". Exports only
        # ever live in this project's own output folder, so require that.
        export_root = output_dir() / "ITDA" / safe
        video_path = Path(manifest.get("path") or "")
        if not is_contained(video_path, [export_root]):
            raise RuntimeError(
                f"Refusing to load '{video_path}': it is outside this project's export folder "
                f"({export_root}). Re-export from the ITDA editor."
            )
        if not video_path.exists():
            raise RuntimeError(f"Exported file is missing on disk: {video_path}")

        cap = cv2.VideoCapture(str(video_path))
        frames = []
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        finally:
            cap.release()
        if not frames:
            raise RuntimeError(f"Could not decode any frames from {video_path}")

        arr = np.stack(frames).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(arr)

        waveform = torch.zeros(1, 1, 1)
        sample_rate = 44100
        if manifest.get("has_audio"):
            # torchaudio.load() on this install requires the optional
            # torchcodec package (ImportError otherwise), so decode PCM
            # straight from ffmpeg instead - no extra dependency needed.
            raw = subprocess.check_output(
                ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(video_path),
                 "-vn", "-ac", "2", "-ar", str(sample_rate), "-f", "f32le", "pipe:1"],
                timeout=120,
            )
            if raw:
                pcm = np.frombuffer(raw, dtype=np.float32)
                usable = pcm.size - (pcm.size % 2)
                if usable > 0:
                    pcm = pcm[:usable].reshape(-1, 2).T.copy()  # [channels, samples]
                    waveform = torch.from_numpy(pcm).unsqueeze(0)  # [1, C, N]

        audio = {"waveform": waveform, "sample_rate": sample_rate}
        return (image_tensor, audio, len(frames), float(manifest.get("fps", 24)))


NODE_CLASS_MAPPINGS = {
    "ITDAOpenEditor": ITDAOpenEditor,
    "ITDALoadExport": ITDALoadExport,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ITDAOpenEditor": "ITDA Open Editor",
    "ITDALoadExport": "ITDA Load Export",
}
