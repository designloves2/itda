import { app } from "../../scripts/app.js";

// Adds an in-graph live preview (iframe) of the ITDA editor to the
// "ITDAOpenEditor" node, plus explicit "Open In Browser" / "Reload Preview"
// buttons. The Python node (itda_nodes.py) only ever produced a URL string
// output for workflow use - this is the actual visual node the user asked
// for: see and use the editor without leaving the ComfyUI graph, or pop it
// out to a full browser tab.
const NODE_CLASS = "ITDAOpenEditor";

function getWidget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

function editorUrl(node) {
  const w = getWidget(node, "project_name");
  const project = encodeURIComponent(w?.value || "project");
  return `${location.origin}/itda/editor?project=${project}`;
}

// Setting iframe.src to a string identical to its current src is a no-op in
// some browsers - no navigation happens at all, so "Reload Preview" and the
// project_name-change auto-refresh could silently keep showing a stale page
// (this is also just generally safer against any HTTP-cache weirdness for
// content this actively under development). A cache-busting param forces a
// genuinely new navigation/fetch every time.
function previewUrl(node) {
  return `${editorUrl(node)}&_cb=${Date.now()}`;
}

function buildUI(node) {
  if (node._itdaPreviewUI) return;

  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:4px;width:100%;height:100%;box-sizing:border-box;padding:2px;";

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:4px;";

  const openBtn = document.createElement("button");
  openBtn.textContent = "Open In Browser";
  openBtn.style.cssText = "flex:1;height:26px;border:none;border-radius:5px;background:#6a5cff;color:#fff;cursor:pointer;font-weight:700;font-size:12px;";

  const reloadBtn = document.createElement("button");
  reloadBtn.textContent = "Reload Preview";
  reloadBtn.style.cssText = "height:26px;border:none;border-radius:5px;background:#2a2e38;color:#cfd5df;cursor:pointer;font-size:11px;padding:0 10px;";

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "flex:1;width:100%;min-height:220px;border:0;border-radius:6px;background:#0b0c0e;";
  iframe.src = previewUrl(node);

  // Buttons sit inside the node body - without this, a click/drag on them
  // would also be interpreted by the graph canvas as dragging the node.
  [openBtn, reloadBtn, wrap].forEach((el) => {
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
  });

  // ITDA's own keyboard shortcuts (Delete, C for split, Ctrl+D, etc.) only
  // fire if the iframe's own window actually has keyboard focus. LiteGraph's
  // canvas has its own global shortcuts (Delete removes the *node*, Ctrl+C
  // copies the *node*, ...) that otherwise win whenever focus is still on
  // the graph canvas rather than inside the iframe. A capture-phase
  // pointerdown listener on the wrapper sees the click before it disappears
  // into the iframe's separate document, so we can force focus in
  // explicitly rather than relying on default browser click-to-focus (which
  // is what "editing shortcuts get eaten by ComfyUI" reports symptom-match).
  const focusIframe = () => {
    try {
      iframe.contentWindow.focus();
    } catch (e) {
      /* cross-origin or not-yet-loaded - ignore */
    }
  };
  wrap.addEventListener("pointerdown", focusIframe, true);
  iframe.addEventListener("load", focusIframe);
  openBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    window.open(editorUrl(node), "_blank");
  });
  reloadBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // Reload must refresh whichever project is ACTUALLY open right now, not
    // rebuild from the project_name widget. The ITDA editor switches
    // projects via its own in-app Project menu without ever touching the
    // iframe's URL (no history.pushState) - so contentWindow.location.href
    // stays stuck on the URL it was first loaded with. The only place that
    // reflects the true current project is the editor's own #projectName
    // input inside the iframe's DOM.
    let currentProject = null;
    try {
      currentProject = iframe.contentDocument?.getElementById("projectName")?.value || null;
    } catch (err) {
      currentProject = null;
    }
    const projectWidget = getWidget(node, "project_name");
    const project = encodeURIComponent(currentProject || projectWidget?.value || "project");
    if (currentProject && projectWidget) projectWidget.value = currentProject;
    iframe.src = `${location.origin}/itda/editor?project=${project}&_cb=${Date.now()}`;
  });

  row.appendChild(openBtn);
  row.appendChild(reloadBtn);
  wrap.appendChild(row);
  wrap.appendChild(iframe);

  const domWidget = node.addDOMWidget("itda_preview", "itda_preview", wrap, {
    serialize: false,
    hideOnZoom: false,
  });
  domWidget.computeSize = function () {
    const width = Math.max(320, (node.size?.[0] || 1000) - 20);
    const height = Math.max(220, (node.size?.[1] || 760) - 90);
    return [width, height];
  };

  node._itdaPreviewUI = { wrap, iframe, openBtn, reloadBtn, domWidget };
  // The full editor (media bin + timeline + preview + properties, all side
  // by side) needs real estate - the old 460x420 default opened cramped and
  // mostly unusable until manually resized.
  if (!node.size || node.size[0] < 1000 || node.size[1] < 760) node.size = [1000, 760];

  // Keep the preview pointed at whichever project the widget currently names.
  const projectWidget = getWidget(node, "project_name");
  if (projectWidget) {
    const origCallback = projectWidget.callback;
    projectWidget.callback = function (...args) {
      const r = origCallback ? origCallback.apply(this, args) : undefined;
      iframe.src = previewUrl(node);
      return r;
    };
  }
}

app.registerExtension({
  name: "ITDA.PreviewNode",
  nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    buildUI(node);
  },
  loadedGraphNode(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    buildUI(node);
  },
});
