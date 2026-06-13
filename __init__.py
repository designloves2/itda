"""
ComfyUI-ITDA
Frame-Accurate Video Stitching Environment for AI video workflows.
"""

from .itda.server import register_itda_routes
from .itda_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

try:
    register_itda_routes()
except Exception as e:
    print(f"[ITDA] route registration failed: {e}")

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
