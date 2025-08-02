export function initTextTool({
  canvas,               // main image canvas
  textLayer,            // new separate text layer canvas
  textControls,
  addTextBtn,
  textInput,
  textColor,
  fontSize,
  flattenBtn,           // new button to flatten/apply text layer
  onCommit
}) {
  if (!canvas || !textLayer || !addTextBtn || !textInput || !textColor || !fontSize) return;

  const mainCtx = canvas.getContext("2d");
  const textCtx = textLayer.getContext("2d");

  // State for current text and drag interaction
  const textState = {
    text: "",
    color: "#ffffff",
    size: 48,
    x: 0,
    y: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    originX: 0,
    originY: 0
  };

  function ensureLayerSize() {
    if (textLayer.width !== canvas.width || textLayer.height !== canvas.height) {
      textLayer.width = canvas.width || 1;
      textLayer.height = canvas.height || 1;
    }
  }

  function clearTextLayer() {
    textCtx.clearRect(0, 0, textLayer.width, textLayer.height);
  }

  function drawText() {
    clearTextLayer();
    if (!textState.text) return;
    textCtx.save();
    textCtx.font = `${textState.size}px sans-serif`;
    textCtx.fillStyle = textState.color;
    textCtx.textAlign = "left";      // use left/alphabetic for precise hitbox
    textCtx.textBaseline = "alphabetic";
    textCtx.imageSmoothingEnabled = true;
    textCtx.imageSmoothingQuality = "high";
    textCtx.fillText(textState.text, textState.x, textState.y);
    textCtx.restore();
  }

  // Helpers
  function getPointerPos(e) {
    const rect = textLayer.getBoundingClientRect();
    const scaleX = textLayer.width / rect.width;
    const scaleY = textLayer.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  function getTextBounds() {
    if (!textState.text) return null;
    textCtx.save();
    textCtx.font = `${textState.size}px sans-serif`;
    textCtx.textAlign = "left";
    textCtx.textBaseline = "alphabetic";
    const metrics = textCtx.measureText(textState.text);
    const w = metrics.width;
    const ascent = metrics.actualBoundingBoxAscent ?? textState.size * 0.8;
    const descent = metrics.actualBoundingBoxDescent ?? textState.size * 0.2;
    const left = textState.x;
    const right = left + w;
    const top = textState.y - ascent;
    const bottom = textState.y + descent;
    textCtx.restore();
    return { left, top, right, bottom, width: w, height: ascent + descent };
  }

  function hitTest(x, y) {
    const b = getTextBounds();
    if (!b) return false;
    return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  }

  // Pointer handlers
  function onPointerDown(e) {
    if (!canvas.width || !canvas.height) return;
    const { x, y } = getPointerPos(e);
    if (hitTest(x, y)) {
      textState.isDragging = true;
      textState.dragStartX = x;
      textState.dragStartY = y;
      textState.originX = textState.x;
      textState.originY = textState.y;
      try { textLayer.setPointerCapture && textLayer.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
    }
  }

  function onPointerMove(e) {
    if (!textState.isDragging) return;
    const { x, y } = getPointerPos(e);
    const dx = x - textState.dragStartX;
    const dy = y - textState.dragStartY;
    textState.x = Math.round(textState.originX + dx);
    textState.y = Math.round(textState.originY + dy);
    drawText();
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (textState.isDragging) {
      textState.isDragging = false;
      try { textLayer.releasePointerCapture && textLayer.releasePointerCapture(e.pointerId); } catch {}
      e.preventDefault();
    }
  }

  // Add/remove listeners only when interactive
  let listenersAttached = false;
  function attachListeners() {
    if (listenersAttached) return;
    textLayer.addEventListener("pointerdown", onPointerDown);
    textLayer.addEventListener("pointermove", onPointerMove);
    textLayer.addEventListener("pointerup", onPointerUp);
    textLayer.addEventListener("pointercancel", onPointerUp);
    listenersAttached = true;
  }
  function detachListeners() {
    if (!listenersAttached) return;
    textLayer.removeEventListener("pointerdown", onPointerDown);
    textLayer.removeEventListener("pointermove", onPointerMove);
    textLayer.removeEventListener("pointerup", onPointerUp);
    textLayer.removeEventListener("pointercancel", onPointerUp);
    listenersAttached = false;
    textState.isDragging = false;
  }

  function setInteractive(enabled) {
    // Manage both CSS and event listeners
    textLayer.style.pointerEvents = enabled ? "auto" : "none";
    if (enabled) attachListeners();
    else detachListeners();
  }

  function addText() {
    try {
      if (!canvas.width || !canvas.height) return false;

      ensureLayerSize();

      const text = (textInput.value || "").trim();
      if (!text) return false;

      const color = textColor.value || "#ffffff";
      const size = Math.max(10, Math.min(200, parseInt(fontSize.value, 10) || 48));

      // Initialize text state; default to center position using alphabetic baseline
      textState.text = text;
      textState.color = color;
      textState.size = size;

      // Center horizontally/vertically using measured metrics
      textCtx.save();
      textCtx.font = `${size}px sans-serif`;
      const metrics = textCtx.measureText(text);
      const textWidth = metrics.width;
      const ascent = metrics.actualBoundingBoxAscent ?? size * 0.8;
      textCtx.restore();

      textState.x = Math.floor((textLayer.width - textWidth) / 2);
      // For alphabetic baseline centering, position baseline so vertical center of bbox is at layer center
      const bboxHeight = (metrics.actualBoundingBoxAscent ?? size * 0.8) + (metrics.actualBoundingBoxDescent ?? size * 0.2);
      const baselineOffset = (bboxHeight / 2) - (metrics.actualBoundingBoxDescent ?? size * 0.2);
      textState.y = Math.floor(textLayer.height / 2 + baselineOffset);

      drawText();

      // Do NOT push history here — user can still move/modify before flattening
      return true;
    } catch (e) {
      console.error("Add text failed:", e);
      return false;
    }
  }

  function flatten() {
    try {
      if (!canvas.width || !canvas.height) return false;
      ensureLayerSize();
      // Composite text layer onto main canvas
      mainCtx.save();
      mainCtx.imageSmoothingEnabled = true;
      mainCtx.imageSmoothingQuality = "high";
      mainCtx.drawImage(textLayer, 0, 0);
      mainCtx.restore();
      // Clear text layer and reset state text (keep position for next time)
      clearTextLayer();
      textState.text = "";
      // Commit history once flattened
      if (typeof onCommit === "function") onCommit();
      return true;
    } catch (e) {
      console.error("Flatten text layer failed:", e);
      return false;
    }
  }

  // Public API
  const api = { addText, flatten, clearTextLayer, setInteractive, ensureLayerSize, drawText };

  // Wire "Add" to draw on the text layer
  addTextBtn.addEventListener("click", (e) => {
    e.preventDefault();
    api.addText();
  });

  // Wire "Flatten/Apply" if provided
  if (flattenBtn) {
    flattenBtn.addEventListener("click", (e) => {
      e.preventDefault();
      api.flatten();
    });
  }

  // Start non-interactive; app.js toggles this with the Text Tool button
  setInteractive(false);

  return api;
}
