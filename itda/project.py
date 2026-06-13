from __future__ import annotations

import json
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

from .paths import project_file, ensure_dirs, safe_name

PROJECT_VERSION = "0.1.5c"


def default_project(name: str = "untitled") -> dict[str, Any]:
    now = int(time.time())
    safe = safe_name(name)
    return {
        "schema": "itda.project",
        "version": PROJECT_VERSION,
        "name": safe,
        "created_at": now,
        "updated_at": now,
        "settings": {
            "fps": 24,
            "total_frames": 360,
            "snap": True,
            "preview_mode": "single",
            "loop": False,
            "mute": False,
        },
        "range": {"start": None, "end": None},
        "media": [],
        "clips": [],
        "lanes": [],
    }


def load_project(name: str) -> dict[str, Any]:
    path = project_file(name)
    if not path.exists():
        project = default_project(name)
        save_project(name, project)
        return project
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_project(name: str, data: dict[str, Any]) -> dict[str, Any]:
    safe = safe_name(data.get("name") or name)
    data["name"] = safe
    data["version"] = data.get("version") or PROJECT_VERSION
    data["updated_at"] = int(time.time())
    ensure_dirs(safe)
    path = project_file(safe)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(path)
    return {"ok": True, "project": safe, "path": str(path)}
