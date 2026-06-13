from __future__ import annotations

import os
from pathlib import Path

try:
    import folder_paths
except Exception:
    folder_paths = None

PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def comfy_base_dir() -> Path:
    if folder_paths is not None:
        return Path(folder_paths.base_path).resolve()
    return PACKAGE_ROOT.resolve()


def input_dir() -> Path:
    if folder_paths is not None:
        return Path(folder_paths.get_input_directory()).resolve()
    return (comfy_base_dir() / "input").resolve()


def output_dir() -> Path:
    if folder_paths is not None:
        return Path(folder_paths.get_output_directory()).resolve()
    return (comfy_base_dir() / "output").resolve()


def itda_root() -> Path:
    # Use ComfyUI/input/ITDA as the project root for Manager/security compatibility.
    return (input_dir() / "ITDA").resolve()


def web_root() -> Path:
    return (PACKAGE_ROOT / "web").resolve()


def ensure_dirs(project_name: str | None = None) -> dict[str, str]:
    roots = {
        "input_itda": input_dir() / "ITDA",
        "snapshot": input_dir() / "ITDA-SNAPSHOT",
        "output_itda": output_dir() / "ITDA",
        "projects": itda_root() / "projects",
    }
    if project_name:
        safe = safe_name(project_name)
        roots["media"] = itda_root() / "media" / safe
        roots["cache"] = itda_root() / "cache" / safe
    for p in roots.values():
        p.mkdir(parents=True, exist_ok=True)
    return {k: str(v) for k, v in roots.items()}


def safe_name(name: str) -> str:
    cleaned = "".join(c for c in name.strip() if c.isalnum() or c in "._- ").strip()
    return cleaned or "untitled"


def resolve_under(base: Path, *parts: str) -> Path:
    base = base.resolve()
    target = (base / Path(*parts)).resolve()
    if target != base and base not in target.parents:
        raise ValueError("Path traversal blocked")
    return target


def project_file(project_name: str) -> Path:
    ensure_dirs()
    filename = safe_name(project_name)
    if not filename.endswith(".itda.json"):
        filename += ".itda.json"
    return resolve_under(itda_root() / "projects", filename)
