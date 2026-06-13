import json
import mimetypes
import os
import re
import shutil
import time
from pathlib import Path

from aiohttp import web
from server import PromptServer

ROOT = Path(__file__).resolve().parent
ITDA_ROOT = ROOT / "ITDA"
PROJECTS_DIR = ITDA_ROOT / "projects"
MEDIA_DIR = ITDA_ROOT / "media"
CACHE_DIR = ITDA_ROOT / "cache"
WEB_DIR = ROOT / "web"

INPUT_ITDA = ROOT.parent.parent / "input" / "ITDA"
INPUT_SNAPSHOT = ROOT.parent.parent / "input" / "ITDA-SNAPSHOT"
OUTPUT_ITDA = ROOT.parent.parent / "output" / "ITDA"

VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}
AUDIO_EXT = {".wav", ".mp3", ".flac", ".aac", ".m4a", ".ogg"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


def ensure_dirs():
    for p in [PROJECTS_DIR, MEDIA_DIR, CACHE_DIR, INPUT_ITDA, INPUT_SNAPSHOT, OUTPUT_ITDA]:
        p.mkdir(parents=True, exist_ok=True)


def safe_name(name: str) -> str:
    name = (name or "untitled").strip()
    name = re.sub(r"[^a-zA-Z0-9가-힣._ -]+", "_", name)
    name = name.strip(" .")
    return name or "untitled"


def safe_project_path(project_name: str) -> Path:
    project_name = safe_name(project_name)
    path = PROJECTS_DIR / f"{project_name}.itda.json"
    resolved = path.resolve()
    if PROJECTS_DIR.resolve() not in resolved.parents and resolved != PROJECTS_DIR.resolve():
        raise web.HTTPBadRequest(text="Invalid project name")
    return resolved


def classify_media(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in VIDEO_EXT:
        return "video"
    if ext in AUDIO_EXT:
        return "audio"
    if ext in IMAGE_EXT:
        return "image"
    return "unknown"


def media_record(path: Path, base: Path):
    stat = path.stat()
    mtype = classify_media(path)
    rel = path.relative_to(base).as_posix()
    return {
        "id": f"media_{abs(hash(str(path.resolve())))}",
        "name": path.name,
        "type": mtype,
        "path": str(path.resolve()),
        "relativePath": rel,
        "size": stat.st_size,
        "modified": int(stat.st_mtime),
    }


async def editor(_request):
    ensure_dirs()
    html = WEB_DIR / "itda_editor.html"
    return web.FileResponse(html)


async def static_file(request):
    filename = request.match_info.get("filename", "")
    path = (WEB_DIR / filename).resolve()
    if WEB_DIR.resolve() not in path.parents or not path.exists() or path.is_dir():
        raise web.HTTPNotFound(text="Not found")
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return web.FileResponse(path, headers={"Content-Type": content_type})


async def health(_request):
    ensure_dirs()
    return web.json_response({"ok": True, "app": "ITDA", "version": "0.1.0-foundation"})


async def scan_media(_request):
    ensure_dirs()
    items = []
    for base in [INPUT_ITDA, INPUT_SNAPSHOT, MEDIA_DIR]:
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if p.is_file() and classify_media(p) != "unknown":
                items.append(media_record(p, base))
    items.sort(key=lambda x: (x["type"], x["name"].lower()))
    return web.json_response({"items": items})


async def list_projects(_request):
    ensure_dirs()
    projects = []
    for p in PROJECTS_DIR.glob("*.itda.json"):
        stat = p.stat()
        projects.append({"name": p.name.replace(".itda.json", ""), "path": str(p), "modified": int(stat.st_mtime)})
    projects.sort(key=lambda x: x["modified"], reverse=True)
    return web.json_response({"projects": projects})


async def load_project(request):
    ensure_dirs()
    name = request.match_info.get("name", "untitled")
    path = safe_project_path(name)
    if not path.exists():
        return web.json_response(default_project(name))
    return web.json_response(json.loads(path.read_text(encoding="utf-8")))


async def save_project(request):
    ensure_dirs()
    data = await request.json()
    name = safe_name(data.get("name") or "untitled")
    data["name"] = name
    data["updatedAt"] = int(time.time())
    data.setdefault("version", "0.1.0")
    path = safe_project_path(name)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    (MEDIA_DIR / name).mkdir(parents=True, exist_ok=True)
    (CACHE_DIR / name).mkdir(parents=True, exist_ok=True)
    return web.json_response({"ok": True, "name": name, "path": str(path)})


async def prerender_range(request):
    ensure_dirs()
    data = await request.json()
    project = safe_name(data.get("project") or "untitled")
    cache_dir = CACHE_DIR / project
    cache_dir.mkdir(parents=True, exist_ok=True)
    marker = cache_dir / "last_prerender_request.json"
    marker.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return web.json_response({"ok": True, "status": "queued-placeholder", "cacheDir": str(cache_dir)})


def default_project(name="untitled"):
    now = int(time.time())
    return {
        "app": "ITDA",
        "version": "0.1.0",
        "name": safe_name(name),
        "fps": 24,
        "frame": 0,
        "range": {"start": None, "end": None},
        "snap": True,
        "loop": False,
        "previewMode": "single",
        "previewMute": False,
        "media": [],
        "clips": [],
        "groups": [],
        "createdAt": now,
        "updatedAt": now,
    }


routes = PromptServer.instance.routes
routes.get("/itda/editor")(editor)
routes.get("/itda/web/{filename}")(static_file)
routes.get("/itda/health")(health)
routes.get("/itda/media/scan")(scan_media)
routes.get("/itda/projects")(list_projects)
routes.get("/itda/project/{name}")(load_project)
routes.post("/itda/project/save")(save_project)
routes.post("/itda/prerender")(prerender_range)

ensure_dirs()
print("[ITDA] v0.1 Foundation server loaded")
