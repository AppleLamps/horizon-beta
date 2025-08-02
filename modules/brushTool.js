/**
 * modules/brushTool.js
 * Non-destructive brush tool that draws on a separate canvas layer.
 *
 * API: initBrushTool(drawLayer, { controlsEl, colorInput, sizeInput, getActive, onActivate })
 * - drawLayer: the drawing canvas element
 * - controlsEl: container element for brush controls (hidden/shown by app)
 * - colorInput: <input type="color">
 * - sizeInput: <input type="range"> (1..100)
 * - getActive: () => boolean, whether brush tool is currently active
 * - onActivate: (active:boolean) => void, optional callback when tool activation toggles
 *
 * The tool attaches pointer event listeners and draws smooth lines on drawLayer.
 * It uses pointer capture for robust input and respects devicePixelRatio scaling,
 * assuming app.js resizes the canvas dimensions.
 */

export function initBrushTool(drawLayer, {
  controlsEl,
  colorInput,
  sizeInput,
  getActive = () => true,
  onActivate
} = {}) {
  if (!drawLayer) throw new Error("drawLayer is required");
  const ctx = drawLayer.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable for draw layer");

  // Default settings
  let brushColor = (colorInput && colorInput.value) || "#ff0000";
  let brushSize = parseFloat((sizeInput && sizeInput.value) || "5") || 5;

  // State
  let isDrawing = false;
  let last = null; // {x,y}
  let lastMid = null; // for smoothing via quadratic

  // Ensure correct base styles
  function applyStrokeStyle() {
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.miterLimit = 2;
  }
  applyStrokeStyle();

  // Helpers
  function getPointFromEvent(e) {
    const rect = drawLayer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const x = (e.clientX - rect.left) * (drawLayer.width / rect.width);
    const y = (e.clientY - rect.top) * (drawLayer.height / rect.height);
    return { x, y, dpr };
  }

  function midPoint(p1, p2) {
    return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  }

  function beginStroke(p) {
    isDrawing = true;
    last = p;
    lastMid = p;
    // immediate dot for taps
    ctx.save();
    applyStrokeStyle();
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, brushSize / 2), 0, Math.PI * 2);
    ctx.fillStyle = brushColor;
    ctx.fill();
    ctx.restore();
  }

  function drawStroke(p) {
    if (!isDrawing || !last) return;
    ctx.save();
    applyStrokeStyle();
    const mid = midPoint(last, p);
    ctx.beginPath();
    // Smooth using quadratic curve from last midpoint -> current midpoint with control point at last
    ctx.moveTo(lastMid.x, lastMid.y);
    ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
    ctx.stroke();
    ctx.restore();
    last = p;
    lastMid = mid;
  }

  function endStroke() {
    isDrawing = false;
    last = null;
    lastMid = null;
  }

  // Event handlers
  function onPointerDown(e) {
    if (!getActive()) return;
    if (e.button !== 0) return; // left only
    // Allow this layer to capture events while drawing
    drawLayer.setPointerCapture?.(e.pointerId);
    beginStroke(getPointFromEvent(e));
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!getActive()) return;
    if (!isDrawing) return;
    drawStroke(getPointFromEvent(e));
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!getActive()) return;
    if (isDrawing) endStroke();
    drawLayer.releasePointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function onPointerCancel(e) {
    if (isDrawing) endStroke();
    drawLayer.releasePointerCapture?.(e.pointerId);
  }

  // Controls listeners
  if (colorInput) {
    colorInput.addEventListener("input", () => {
      brushColor = colorInput.value || "#ff0000";
      applyStrokeStyle();
    });
  }
  if (sizeInput) {
    sizeInput.addEventListener("input", () => {
      const v = parseFloat(sizeInput.value || "5");
      brushSize = isFinite(v) ? Math.max(1, Math.min(100, v)) : 5;
      applyStrokeStyle();
    });
  }

  // Pointer events
  // By default, .edit-layer has pointer-events: none; app.js should toggle this when brush tool is active
  drawLayer.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("pointerleave", onPointerCancel);

  function setActive(active) {
    // Toggle pointer events capture via CSS style
    drawLayer.style.pointerEvents = active ? "auto" : "none";
    controlsEl && (controlsEl.style.display = active ? "" : "none");
    onActivate && onActivate(!!active);
  }

  function clear() {
    ctx.clearRect(0, 0, drawLayer.width, drawLayer.height);
  }

  function ensureLayerSizeLike(baseCanvas) {
    if (!baseCanvas) return;
    if (drawLayer.width !== baseCanvas.width || drawLayer.height !== baseCanvas.height) {
      drawLayer.width = baseCanvas.width;
      drawLayer.height = baseCanvas.height;
    }
  }

  // Initial state
  setActive(!!getActive());

  return {
    setActive,
    clear,
    ensureLayerSizeLike
  };
}
