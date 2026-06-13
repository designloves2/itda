from __future__ import annotations

from pathlib import Path
import time
import shutil
from aiohttp import web

from .media import scan_media, ffprobe, media_roots, classify, make_video_thumbnail, make_audio_waveform, extract_video_frame, extract_image_snapshot
from .paths import ensure_dirs, web_root, safe_name, itda_root, input_dir, project_file
from .project import load_project, save_project, default_project

_REGISTERED = False


def _is_allowed_media_path(path: Path, project: str = "project") -> bool:
    resolved = path.resolve()
    roots = [r.resolve() for r in media_roots(project)]
    return any(resolved == root or root in resolved.parents for root in roots)



def fonts_root() -> Path:
    root = Path(__file__).resolve().parents[1] / "Fonts"
    root.mkdir(parents=True, exist_ok=True)
    return root


_FONT_EXTS = {".ttf", ".otf", ".woff", ".woff2"}


def _font_format(path: Path) -> str:
    ext = path.suffix.lower()
    if ext == ".otf":
        return "opentype"
    if ext == ".woff":
        return "woff"
    if ext == ".woff2":
        return "woff2"
    return "truetype"


def project_file_exists(name: str) -> bool:
    from .paths import project_file
    return project_file(name).exists()

def register_itda_routes() -> None:
    global _REGISTERED
    if _REGISTERED:
        return
    try:
        from server import PromptServer
    except Exception as e:
        print(f"[ITDA] PromptServer unavailable: {e}")
        return

    routes = PromptServer.instance.routes

    @routes.get("/itda/editor")
    async def editor(request):
        return web.FileResponse(web_root() / "index.html")

    @routes.get("/itda/web/{filename:.*}")
    async def web_file(request):
        filename = request.match_info.get("filename", "")
        target = (web_root() / filename).resolve()
        root = web_root().resolve()
        if target != root and root not in target.parents:
            raise web.HTTPForbidden(text="Path traversal blocked")
        if not target.exists() or not target.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(target)


    @routes.get("/itda/api/fonts")
    async def list_fonts(request):
        root = fonts_root().resolve()
        items = []
        for path in sorted(root.iterdir()):
            if path.is_file() and path.suffix.lower() in _FONT_EXTS:
                family = path.stem.replace("_", " ").replace("-", " ")
                items.append({
                    "name": path.name,
                    "family": family,
                    "format": _font_format(path),
                    "url": f"/itda/fonts/{path.name}",
                })
        return web.json_response({"ok": True, "items": items})

    @routes.get("/itda/fonts/{filename:.*}")
    async def font_file(request):
        filename = request.match_info.get("filename", "")
        target = (fonts_root() / filename).resolve()
        root = fonts_root().resolve()
        if target != root and root not in target.parents:
            raise web.HTTPForbidden(text="Path traversal blocked")
        if not target.exists() or not target.is_file() or target.suffix.lower() not in _FONT_EXTS:
            raise web.HTTPNotFound()
        return web.FileResponse(target)

    @routes.get("/itda/api/file")
    async def media_file(request):
        raw = request.query.get("path", "")
        project = safe_name(request.query.get("project", "project"))
        if not raw:
            raise web.HTTPBadRequest(text="path required")
        target = Path(raw).resolve()
        if not _is_allowed_media_path(target, project):
            # fallback allows files scanned under the default project roots
            if not _is_allowed_media_path(target, "project"):
                raise web.HTTPForbidden(text="Media path not allowed")
        if not target.exists() or not target.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(target)

    @routes.get("/itda/api/health")
    async def health(request):
        return web.json_response({"ok": True, "name": "ITDA", "version": "0.2.8-waveform-hotfix"})

    @routes.post("/itda/api/init")
    async def init_project(request):
        body = await request.json()
        name = safe_name(body.get("project") or "project")
        ensure_dirs(name)
        data = load_project(name)
        return web.json_response({"ok": True, "project": data})

    @routes.get("/itda/api/project/{name}")
    async def get_project(request):
        data = load_project(request.match_info["name"])
        return web.json_response({"ok": True, "project": data})

    @routes.post("/itda/api/project/{name}")
    async def post_project(request):
        body = await request.json()
        result = save_project(request.match_info["name"], body)
        return web.json_response(result)

    @routes.get("/itda/api/media/{project}")
    async def get_media(request):
        project = safe_name(request.match_info["project"])
        return web.json_response({"ok": True, "items": scan_media(project)})


    @routes.post("/itda/api/waveform")
    async def waveform(request):
        body = await request.json()
        project = safe_name(body.get("project", "project"))
        raw = body.get("path", "")
        bars = int(body.get("bars", 240) or 240)
        if not raw:
            raise web.HTTPBadRequest(text="path required")
        target = Path(raw).resolve()
        if not _is_allowed_media_path(target, project):
            raise web.HTTPForbidden(text="Media path not allowed")
        if not target.exists() or not target.is_file():
            raise web.HTTPNotFound()
        kind = classify(target)
        if kind not in {"video", "audio"}:
            raise web.HTTPBadRequest(text="waveform requires video or audio media")
        data = make_audio_waveform(target, project, bars)
        if not data or not data.get("ok"):
            return web.json_response(data or {"ok": False, "peaks": []}, status=200)
        return web.json_response(data)

    @routes.post("/itda/api/probe")
    async def probe(request):
        body = await request.json()
        path = Path(body.get("path", "")).resolve()
        project = safe_name(body.get("project", "project"))
        if not _is_allowed_media_path(path, project):
            raise web.HTTPForbidden(text="Media path not allowed")
        return web.json_response({"ok": True, "meta": ffprobe(path)})


    @routes.post("/itda/api/media/upload")
    async def upload_media(request):
        reader = await request.multipart()
        project = "itda-project-1"
        files = []
        async for part in reader:
            if part.name == "project":
                project = safe_name((await part.text()) or project)
                continue
            if part.name != "files" or not part.filename:
                continue
            ensure_dirs(project)
            dest_dir = itda_root() / "media" / project
            dest_dir.mkdir(parents=True, exist_ok=True)
            raw_name = Path(part.filename).name
            base = safe_name(Path(raw_name).stem)
            ext = Path(raw_name).suffix.lower()
            if not ext:
                ext = ".bin"
            dest = dest_dir / f"{base}{ext}"
            i = 1
            while dest.exists():
                dest = dest_dir / f"{base}_{i}{ext}"
                i += 1
            with dest.open("wb") as f:
                while True:
                    chunk = await part.read_chunk()
                    if not chunk:
                        break
                    f.write(chunk)
            kind = classify(dest)
            if not kind:
                dest.unlink(missing_ok=True)
                continue
            if kind == "video":
                make_video_thumbnail(dest, project)
            files.append(str(dest))
        return web.json_response({"ok": True, "items": files})

    @routes.post("/itda/api/media/delete")
    async def delete_media(request):
        body = await request.json()
        project = safe_name(body.get("project", "project"))
        raw = body.get("path", "")
        if not raw:
            raise web.HTTPBadRequest(text="path required")
        target = Path(raw).resolve()
        media_root = (itda_root() / "media" / project).resolve()
        if target != media_root and media_root not in target.parents:
            raise web.HTTPForbidden(text="Only input/ITDA/media/<project> files can be deleted")
        if target.exists() and target.is_file():
            target.unlink()
        # Best-effort thumbnail cleanup is handled by cache refresh on next scan.
        return web.json_response({"ok": True})



    @routes.post("/itda/api/snapshot_frame")
    async def save_snapshot_frame(request):
        body = await request.json()
        project = safe_name(body.get("project", "itda-project-1"))
        raw = body.get("path", "")
        kind = body.get("kind", "video")
        source_frame = int(body.get("source_frame", 0) or 0)
        source_fps = body.get("source_fps")
        try:
            source_fps = float(source_fps) if source_fps is not None else None
        except Exception:
            source_fps = None
        if not raw:
            raise web.HTTPBadRequest(text="path required")
        target = Path(raw).resolve()
        if not _is_allowed_media_path(target, project):
            raise web.HTTPForbidden(text="Media path not allowed")
        if not target.exists() or not target.is_file():
            raise web.HTTPNotFound()
        if kind == "image":
            saved = extract_image_snapshot(target, project)
        else:
            saved = extract_video_frame(target, project, source_frame, source_fps)
        if not saved:
            raise web.HTTPInternalServerError(text="snapshot extraction failed")
        return web.json_response({"ok": True, "path": saved, "source_frame": source_frame})

    @routes.post("/itda/api/snapshot")
    async def save_snapshot(request):
        reader = await request.multipart()
        project = "itda-project-1"
        image_part = None
        async for part in reader:
            if part.name == "project":
                project = safe_name((await part.text()) or project)
            elif part.name == "image":
                image_part = part
                break
        if image_part is None:
            raise web.HTTPBadRequest(text="image required")
        snap_dir = input_dir() / "ITDA-SNAPSHOT"
        snap_dir.mkdir(parents=True, exist_ok=True)
        stem = f"snapshot_{project}_{time.strftime('%Y%m%d_%H%M%S')}"
        dest = snap_dir / f"{stem}.png"
        i = 1
        while dest.exists():
            dest = snap_dir / f"{stem}_{i}.png"
            i += 1
        with dest.open("wb") as f:
            while True:
                chunk = await image_part.read_chunk()
                if not chunk:
                    break
                f.write(chunk)
        return web.json_response({"ok": True, "path": str(dest)})


    @routes.get("/itda/api/projects")
    async def list_projects(request):
        ensure_dirs()
        root = itda_root() / "projects"
        items = []
        for path in sorted(root.glob("*.itda.json")):
            name = path.name[:-len(".itda.json")]
            items.append({"name": name, "path": str(path), "updated_at": int(path.stat().st_mtime)})
        return web.json_response({"ok": True, "items": items})

    @routes.post("/itda/api/project/new")
    async def new_project(request):
        body = await request.json()
        base = safe_name(body.get("name") or "itda-project-1")
        name = base
        i = 1
        while project_file_exists(name):
            i += 1
            name = f"{base}-{i}"
        data = default_project(name)
        save_project(name, data)
        ensure_dirs(name)
        return web.json_response({"ok": True, "project": data})

    @routes.post("/itda/api/project/duplicate")
    async def duplicate_project(request):
        body = await request.json()
        src = safe_name(body.get("source") or "")
        if not src:
            raise web.HTTPBadRequest(text="source required")
        src_file = project_file(src)
        if not src_file.exists():
            raise web.HTTPNotFound(text="source project not found")
        base = safe_name(body.get("target") or f"{src}-copy")
        target = base
        i = 1
        while project_file_exists(target):
            i += 1
            target = f"{base}-{i}"
        data = load_project(src)
        data["name"] = target
        save_project(target, data)
        src_media = itda_root() / "media" / src
        dst_media = itda_root() / "media" / target
        if src_media.exists() and not dst_media.exists():
            shutil.copytree(src_media, dst_media)
        ensure_dirs(target)
        return web.json_response({"ok": True, "project": target})

    @routes.post("/itda/api/project/rename")
    async def rename_project(request):
        body = await request.json()
        src = safe_name(body.get("source") or "")
        target = safe_name(body.get("target") or "")
        if not src or not target:
            raise web.HTTPBadRequest(text="source and target required")
        src_file = project_file(src)
        if not src_file.exists():
            raise web.HTTPNotFound(text="source project not found")
        if src != target and project_file_exists(target):
            raise web.HTTPConflict(text="target project already exists")
        data = load_project(src)
        data["name"] = target
        save_project(target, data)
        if src != target:
            src_file.unlink(missing_ok=True)
            for folder in ("media", "cache"):
                a = itda_root() / folder / src
                b = itda_root() / folder / target
                if a.exists() and not b.exists():
                    a.rename(b)
        ensure_dirs(target)
        return web.json_response({"ok": True, "project": target})

    @routes.post("/itda/api/project/delete")
    async def delete_project(request):
        body = await request.json()
        name = safe_name(body.get("project") or "")
        if not name:
            raise web.HTTPBadRequest(text="project required")
        project_file(name).unlink(missing_ok=True)
        for folder in ("media", "cache"):
            target = itda_root() / folder / name
            if target.exists():
                shutil.rmtree(target)
        return web.json_response({"ok": True})

    @routes.post("/itda/api/prerender")
    async def prerender(request):
        body = await request.json()
        return web.json_response({
            "ok": False,
            "status": "stub",
            "message": "Pre-render cache engine is reserved for v0.4+",
            "request": body,
        })

    fonts_root()
    _REGISTERED = True
    print("[ITDA] routes registered: /itda/editor")
