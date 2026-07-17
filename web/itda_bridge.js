import { app } from "../../scripts/app.js";

// Consumes ?itda_send=<subfolder/file>&itda_kind=<image|video|audio> (single
// clip/range) or ?itda_send_batch=<JSON array of {relative,kind}> (whole
// timeline) set by the ITDA editor's "Send To ComfyUI" button, and drops
// matching loader node(s) pointed at the exported file(s) into the graph.
//
// ComfyUI's own frontend strips/normalizes the URL (history.replaceState)
// during its early startup, before any extension's setup() hook runs. So the
// query string must be captured here at module top-level (which executes
// synchronously the moment this script is imported), not inside setup().
const _params = new URLSearchParams(window.location.search);
const _pendingSend = _params.get("itda_send");
const _pendingKind = _params.get("itda_kind");
let _pendingBatch = null;
try {
  const raw = _params.get("itda_send_batch");
  if (raw) _pendingBatch = JSON.parse(raw);
} catch (e) {
  console.warn("[ITDA] Could not parse itda_send_batch:", e);
}
if (_pendingSend || _pendingBatch) {
  _params.delete("itda_send");
  _params.delete("itda_kind");
  _params.delete("itda_send_batch");
  const clean = _params.toString();
  window.history.replaceState({}, "", clean ? `${window.location.pathname}?${clean}` : window.location.pathname);
}

let _consumed = false;

function nodeTypeFor(kind) {
  return kind === "image" ? "LoadImage" : kind === "audio" ? "LoadAudio" : "LoadVideo";
}
function widgetNameFor(kind) {
  return kind === "image" ? "image" : kind === "audio" ? "audio" : "file";
}
function dropLoaderNode(relative, kind, pos) {
  const node = LiteGraph.createNode(nodeTypeFor(kind));
  if (!node) {
    console.warn(`[ITDA] Node type "${nodeTypeFor(kind)}" not available in this ComfyUI install.`);
    return null;
  }
  node.pos = pos;
  app.graph.add(node);
  const widget = node.widgets?.find((w) => w.name === widgetNameFor(kind));
  if (widget) widget.value = relative;
  return node;
}

app.registerExtension({
  name: "ITDA.Bridge",
  // setup() fires before app.graph exists ("ComfyApp graph accessed before
  // initialization"); afterConfigureGraph fires once the graph is loaded and
  // ready, which is what every other node-inserting extension here uses.
  afterConfigureGraph() {
    if (_consumed || (!_pendingSend && !_pendingBatch)) return;
    _consumed = true;

    if (_pendingBatch && Array.isArray(_pendingBatch)) {
      _pendingBatch.forEach((item, i) => {
        if (!item?.relative || !item?.kind) return;
        dropLoaderNode(item.relative, item.kind, [200, 120 + i * 220]);
      });
    } else if (_pendingSend) {
      dropLoaderNode(_pendingSend, _pendingKind, [200, 200]);
    }
    app.graph.setDirtyCanvas(true, true);
  },
});
