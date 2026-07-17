"""
ITDA standalone launcher - runs the same editor and REST API
(itda/server.py's register_itda_routes) outside of ComfyUI, as its own
aiohttp server bound to localhost only.

Usage:
    python itda_standalone.py [--port 8189] [--host 127.0.0.1] [--no-browser]

Input/output directories default to this folder's own input/ and output/
(since folder_paths isn't available standalone - see itda/paths.py). Point
them elsewhere with an itda_config.json next to this file:
    {"ITDA_INPUT_DIR": "C:/path/to/input", "ITDA_OUTPUT_DIR": "C:/path/to/output"}
or the ITDA_INPUT_DIR / ITDA_OUTPUT_DIR environment variables.
"""
from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aiohttp import web

from itda.server import register_itda_routes
from itda.paths import ensure_dirs


def main() -> None:
    parser = argparse.ArgumentParser(description="Run ITDA as a standalone local app.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1, local-only)")
    parser.add_argument("--port", type=int, default=8189)
    parser.add_argument("--no-browser", action="store_true", help="Don't auto-open a browser tab")
    args = parser.parse_args()

    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(f"[ITDA] Warning: binding to {args.host} exposes this server beyond localhost. "
              f"ITDA's media routes trust same-machine access; only do this on a network you trust.")

    ensure_dirs()

    app = web.Application(client_max_size=1024 * 1024 * 1024)
    routes = web.RouteTableDef()
    register_itda_routes(routes)
    app.add_routes(routes)

    url = f"http://{args.host}:{args.port}/itda/editor"
    print(f"[ITDA] Standalone server starting at {url}")
    if not args.no_browser:
        app.on_startup.append(lambda _app: _open_browser(url))
    web.run_app(app, host=args.host, port=args.port, print=None)


async def _open_browser(url: str) -> None:
    webbrowser.open(url)


if __name__ == "__main__":
    main()
