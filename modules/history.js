/**
 * history.js
 * Undo/redo stack storing ImageData snapshots from a canvas with bounded size and taint awareness.
 * Improvements:
 * - Configurable limits (maxEntries and optional maxBytes)
 * - Optional protectReturned to avoid extra cloning on undo/redo
 * - Diagnostics getters and consistent UI updates
 * - Thumbnails for history preview (dataURL) and size preference
 */

let canvasRef = null;
let ctxRef = null;
let undoStack = [];
let redoStack = [];
let updateUICallback = () => {};
let isTainted = false;

/**
 * Persisted settings keys (localStorage)
 */
const LS_KEYS = {
  maxEntries: "hist.maxEntries"
};

// Defaults
const DEFAULT_MAX_ENTRIES = 50;

// Initialize persisted maxEntries if available
let maxEntries = (() => {
  try {
    const saved = Number(localStorage.getItem(LS_KEYS.maxEntries));
    return Number.isFinite(saved) && saved > 0 ? Math.floor(saved) : DEFAULT_MAX_ENTRIES;
  } catch { return DEFAULT_MAX_ENTRIES; }
})();

let maxBytes = undefined; // optional cap
let protectReturned = false;

// Thumbnails
const THUMB_DEFAULT_SIZE = 96; // logical thumb height; width is proportional
let thumbEnabled = true;
let thumbHeight = Number(localStorage.getItem("hist.thumbHeight")) || THUMB_DEFAULT_SIZE;
let thumbQuality = 0.7; // jpeg/webp quality for thumbnails

/**
 * Internal structure:
 * { width, height, data:ImageData, thumbDataUrl?:string, ts:number, label?:string }
 * For memory efficiency, we don't wrap ImageData; we keep parallel arrays of metadata in a WeakMap if needed.
 * Simpler approach: store an object {imgData, thumbDataUrl, ts}. For compatibility with existing code,
 * we will store the ImageData directly but attach metadata via a Map.
 */
const metaMap = new WeakMap();

export function initHistory(
  canvas,
  onChangeOrOptions = () => {}
) {
  canvasRef = canvas;
  ctxRef = canvas.getContext("2d");

  // Support signature:
  // initHistory(canvas, onChange)
  // initHistory(canvas, { onUpdateUI, maxEntries, maxBytes, protectReturned, thumbnails, thumbHeight })
  if (typeof onChangeOrOptions === "function") {
    updateUICallback = onChangeOrOptions;
    maxEntries = DEFAULT_MAX_ENTRIES;
    maxBytes = undefined;
    protectReturned = false;
  } else if (onChangeOrOptions && typeof onChangeOrOptions === "object") {
    const {
      onUpdateUI = () => {},
      maxEntries: me = DEFAULT_MAX_ENTRIES,
      maxBytes: mb,
      protectReturned: pr = false,
      thumbnails = true,
      thumbHeight: th,
    } = onChangeOrOptions;
    updateUICallback = onUpdateUI;
    maxEntries = Number.isFinite(me) && me > 0 ? Math.floor(me) : DEFAULT_MAX_ENTRIES;
    maxBytes = Number.isFinite(mb) && mb > 0 ? Math.floor(mb) : undefined;
    protectReturned = !!pr;
    thumbEnabled = !!thumbnails;
    if (Number.isFinite(th) && th > 16 && th <= 256) thumbHeight = Math.floor(th);
  } else {
    updateUICallback = () => {};
    maxEntries = DEFAULT_MAX_ENTRIES;
    maxBytes = undefined;
    protectReturned = false;
  }

  undoStack = [];
  redoStack = [];
  isTainted = false;

  // Initial UI sync
  _updateUI();
}

export function getTainted() {
  return isTainted;
}

export function canUndo() {
  // Allow undo if we have at least one previous snapshot
  return !isTainted && undoStack.length > 0;
}

export function canRedo() {
  return !isTainted && redoStack.length > 0;
}

// Diagnostics
export function getUndoCount() {
  return undoStack.length;
}

export function getRedoCount() {
  return redoStack.length;
}

export function getEstimatedBytes() {
  const bytesPerPixel = 4;
  let total = 0;
  for (const s of undoStack) total += s.width * s.height * bytesPerPixel;
  for (const s of redoStack) total += s.width * s.height * bytesPerPixel;
  return total;
}

export function getLimits() {
  return { maxEntries, maxBytes, protectReturned };
}

/**
 * Public: update maximum number of history entries and persist to localStorage.
 */
export function setMaxEntries(n) {
  if (!Number.isFinite(n) || n <= 0) return;
  maxEntries = Math.floor(n);
  try { localStorage.setItem(LS_KEYS.maxEntries, String(maxEntries)); } catch {}
  // Enforce immediately in case stacks exceed new limit
  _enforceLimits();
  _updateUI({ limits: getLimits() });
}

export function getMaxEntries() {
  return maxEntries;
}

export function getThumbPrefs() {
  return { enabled: thumbEnabled, height: thumbHeight };
}

export function setThumbHeight(h) {
  if (Number.isFinite(h) && h >= 48 && h <= 256) {
    thumbHeight = Math.floor(h);
    try { localStorage.setItem("hist.thumbHeight", String(thumbHeight)); } catch {}
    _updateUI({ thumbHeight });
  }
}

export function pushHistory(label) {
  if (!canvasRef || !ctxRef || canvasRef.width === 0) return false;
  try {
    const snapshot = ctxRef.getImageData(0, 0, canvasRef.width, canvasRef.height);
    undoStack.push(snapshot);
    metaMap.set(snapshot, { ts: Date.now(), label: label || "" });

    // Clear redo stack on new action
    redoStack = [];

    // Enforce limits
    _enforceLimits();

    if (isTainted) {
      isTainted = false;
      _updateUI({ tainted: false });
    } else {
      _updateUI();
    }

    // Generate thumbnail after UI update to avoid blocking
    if (thumbEnabled) {
      _scheduleThumbGeneration(snapshot).catch(() => {});
    }

    return true;
  } catch (e) {
    // Detect cross-origin taint or security errors
    const msg = String(e && (e.message || e.name || e));
    const tainted = (e && e.name === "SecurityError") || /taint|SecurityError/i.test(msg);
    if (tainted) {
      isTainted = true;
      _updateUI({ tainted: true });
    }
    console.error("pushHistory failed:", e);
    return false;
  }
}

/**
 * Undo: move current state to redo, return previous ImageData for caller to draw.
 */
export function undo() {
  if (isTainted || !canUndo()) return null;
  // Move current canvas state to redo for symmetry
  try {
    const current = ctxRef.getImageData(0, 0, canvasRef.width, canvasRef.height);
    redoStack.push(current);
    metaMap.set(current, { ts: Date.now(), label: "redo-base" });
  } catch (e) {
    // If this throws, mark tainted and bail
    const msg = String(e && (e.message || e.name || e));
    if ((e && e.name === "SecurityError") || /taint|SecurityError/i.test(msg)) {
      isTainted = true;
      _updateUI({ tainted: true });
      return null;
    }
  }
  const prev = undoStack.pop();
  const result = prev
    ? (protectReturned ? cloneImageData(prev) : prev)
    : null;

  _updateUI();
  return result;
}

/**
 * Redo: move from redo stack back to undo, return the redone ImageData to draw.
 */
export function redo() {
  if (isTainted || !canRedo()) return null;
  const next = redoStack.pop();
  if (!next) return null;
  // Push current state to undo for symmetry
  try {
    const current = ctxRef.getImageData(0, 0, canvasRef.width, canvasRef.height);
    undoStack.push(current);
    metaMap.set(current, { ts: Date.now(), label: "undo-base" });
    _enforceLimits();
  } catch (e) {
    const msg = String(e && (e.message || e.name || e));
    if ((e && e.name === "SecurityError") || /taint|SecurityError/i.test(msg)) {
      isTainted = true;
      _updateUI({ tainted: true });
      return null;
    }
  }
  const result = protectReturned ? cloneImageData(next) : next;
  _updateUI();
  return result;
}

/**
 * Replace canvas with given ImageData and push as the new current state.
 * Not used by default flow, but provided for completeness.
 */
export function restoreImageData(imgData) {
  if (!canvasRef || !ctxRef) return;
  canvasRef.width = imgData.width;
  canvasRef.height = imgData.height;
  ctxRef.putImageData(imgData, 0, 0);
  pushHistory();
}

/**
 * Utility to deeply clone ImageData (to avoid aliasing with stack storage).
 */
function cloneImageData(imgData) {
  const copy = new ImageData(imgData.width, imgData.height);
  copy.data.set(imgData.data);
  return copy;
}

/**
 * Internal: enforce maxEntries and optional maxBytes by evicting oldest undo snapshots.
 * Strategy: Prefer evicting from undoStack (oldest first). We avoid touching redoStack on push
 * since redo is logically invalidated on new actions (already cleared). On undo/redo, we only
 * ensure undoStack respects limits.
 */
function _enforceLimits() {
  // Enforce entry count
  while (undoStack.length > maxEntries) {
    const evicted = undoStack.shift();
    if (evicted) metaMap.delete(evicted);
  }

  if (!maxBytes) return;

  // Estimate bytes; evict oldest until under cap
  const bytesPerPixel = 4;
  const estimate = () => {
    let total = 0;
    for (const s of undoStack) total += s.width * s.height * bytesPerPixel;
    for (const s of redoStack) total += s.width * s.height * bytesPerPixel;
    return total;
  };

  let totalBytes = estimate();
  while (totalBytes > maxBytes && undoStack.length > 0) {
    const evicted = undoStack.shift();
    if (evicted) metaMap.delete(evicted);
    totalBytes = estimate();
  }
}

/**
 * Internal: call UI callback with diagnostics if provided.
 * Includes history thumbnails and labels for preview UI.
 */
function _updateUI(extra = undefined) {
  if (typeof updateUICallback === "function") {
    const entries = undoStack.map((imgData, idx) => {
      const m = metaMap.get(imgData) || {};
      return {
        index: idx,
        width: imgData.width,
        height: imgData.height,
        ts: m.ts || 0,
        label: m.label || "",
        thumbDataUrl: m.thumbDataUrl || null
      };
    });
    const payload = {
      undoCount: getUndoCount(),
      redoCount: getRedoCount(),
      estimatedBytes: getEstimatedBytes(),
      limits: getLimits(),
      thumbnails: entries,
      thumbPrefs: { enabled: thumbEnabled, height: thumbHeight }
    };
    if (extra && typeof extra === "object") {
      updateUICallback({ ...payload, ...extra });
    } else {
      updateUICallback(payload);
    }
  }
}

/**
 * Create a thumbnail dataURL for an ImageData using an offscreen canvas.
 */
async function _scheduleThumbGeneration(imgData) {
  const run = () => new Promise((resolve) => {
    const h = thumbHeight;
    const w = Math.max(1, Math.round(imgData.width * (h / imgData.height)));
    // Use OffscreenCanvas if available, otherwise HTMLCanvasElement
    let off;
    try {
      off = typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(w, h)
        : (() => {
            const c = document.createElement("canvas");
            c.width = w; c.height = h; return c;
          })();
    } catch {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      off = c;
    }
    const octx = off.getContext("2d");
    // Draw source ImageData to a temp canvas, then scale
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = imgData.width;
    srcCanvas.height = imgData.height;
    srcCanvas.getContext("2d").putImageData(imgData, 0, 0);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(srcCanvas, 0, 0, w, h);

    // Prefer webp for better compression; fall back to jpeg
    const mime = (typeof HTMLCanvasElement !== "undefined" && "toDataURL" in off)
      ? (canvasSupportsType("image/webp") ? "image/webp" : "image/jpeg")
      : "image/jpeg";

    // OffscreenCanvas toDataURL not widely supported; use toBlob then FileReader dataURL
    const finalize = (blob) => {
      const fr = new FileReader();
      fr.onload = () => {
        const m = metaMap.get(imgData) || {};
        m.thumbDataUrl = String(fr.result || "");
        metaMap.set(imgData, m);
        _updateUI({}); // notify UI thumbnails updated
        resolve();
      };
      fr.readAsDataURL(blob);
    };

    if ("convertToBlob" in off) {
      off.convertToBlob({ type: mime, quality: thumbQuality }).then(finalize).catch(() => resolve());
    } else if (typeof off.toBlob === "function") {
      off.toBlob((blob) => {
        if (blob) finalize(blob); else resolve();
      }, mime, thumbQuality);
    } else {
      try {
        const dataUrl = off.toDataURL ? off.toDataURL(mime, thumbQuality) : "";
        const m = metaMap.get(imgData) || {};
        m.thumbDataUrl = dataUrl;
        metaMap.set(imgData, m);
        _updateUI({});
      } catch {}
      resolve();
    }
  });

  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => { run(); });
  } else {
    setTimeout(() => { run(); }, 0);
  }
}

function canvasSupportsType(type) {
  try {
    const c = document.createElement("canvas");
    return typeof c.toDataURL === "function" && c.toDataURL(type).startsWith(`data:${type}`);
  } catch { return false; }
}

/**
 * Public: get thumbnail metadata list (for UI components that don't receive callback payloads).
 */
export function getHistoryThumbnails() {
  return undoStack.map((imgData, idx) => {
    const m = metaMap.get(imgData) || {};
    return {
      index: idx,
      width: imgData.width,
      height: imgData.height,
      ts: m.ts || 0,
      label: m.label || "",
      thumbDataUrl: m.thumbDataUrl || null
    };
  });
}
