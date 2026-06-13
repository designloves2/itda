class ITDAOpenEditor:
    """Utility node placeholder. Actual ITDA editor opens from the ComfyUI top menu or /itda/editor."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"project_name": ("STRING", {"default": "project"})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("editor_url",)
    FUNCTION = "open_url"
    CATEGORY = "ITDA"

    def open_url(self, project_name="project"):
        return (f"/itda/editor?project={project_name}",)


NODE_CLASS_MAPPINGS = {"ITDAOpenEditor": ITDAOpenEditor}
NODE_DISPLAY_NAME_MAPPINGS = {"ITDAOpenEditor": "ITDA Open Editor"}
