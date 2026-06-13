import { app } from "../../scripts/app.js";

app.registerExtension({
  name: "ITDA.Foundation.EditorLauncher",
  setup() {
    const openEditor = () => window.open("/itda/editor", "ITDA_EDITOR", "width=1600,height=960");

    const addButton = () => {
      if (document.getElementById("itda-open-editor-button")) return;
      const menu = document.querySelector(".comfy-menu") || document.querySelector("#comfyui-body-top") || document.body;
      const btn = document.createElement("button");
      btn.id = "itda-open-editor-button";
      btn.textContent = "ITDA Editor";
      btn.title = "Open ITDA Web Editor";
      btn.onclick = openEditor;
      btn.style.margin = "4px";
      btn.style.background = "#111";
      btn.style.color = "#fff";
      btn.style.border = "1px solid #7612DA";
      btn.style.borderRadius = "6px";
      btn.style.padding = "6px 10px";
      menu.appendChild(btn);
    };

    addButton();
    setTimeout(addButton, 1000);
    setTimeout(addButton, 3000);
  },
});
