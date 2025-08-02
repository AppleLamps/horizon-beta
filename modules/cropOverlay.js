/**
 * cropOverlay.js
 * Manages a drawing overlay for interactive cropping on a canvas.
 *
 * Usage:
 * const crop = initCropOverlay({
 *   canvas, overlay,
 *   onFinalize: ({x,y,w,h}) => { ... },
 *   onCancel: () => {}
 * });
 * crop.toggle(); // enter/exit crop mode
 */

export function initCropOverlay({ canvas, overlay, onFinalize, onCancel }) {
  const octx = overlay.getContext("2d");

  let active = false;
  let dragging = false;
  let capturedId = null;
  let start = { x: 0, y: 0 };
  let current = { x: 0, y: 0 };
  let rect = null;

  function toggle() {
    if (active) {
      endCrop(false);
      return false;
    } else {
      beginCrop();
      return true;
    }
  }

  function beginCrop() {
    if (!canvas.width || !canvas.height) return;
    active = true;
    rect = null;
    attach();
    drawOverlay();
  }

  function endCrop(commit) {
    if (!active) return;
    detach();
    clearOverlay();
    active = false;

    if (commit && rect && rect.w > 0 && rect.h > 0) {
      onFinalize && onFinalize(rect);
    } else {
      onCancel && onCancel();
    }
    rect = null;
  }

  function attach() {
    overlay.style.pointerEvents = "auto";
    overlay.addEventListener("pointerdown", onPointerDown);
    overlay.addEventListener("pointermove", onPointerMove);
    overlay.addEventListener("pointerup", onPointerUp);
    overlay.addEventListener("pointerleave", onPointerLeave);
    overlay.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);
  }

  function detach() {
    overlay.style.pointerEvents = "none";
    overlay.removeEventListener("pointerdown", onPointerDown);
    overlay.removeEventListener("pointermove", onPointerMove);
    overlay.removeEventListener("pointerup", onPointerUp);
    overlay.removeEventListener("pointerleave", onPointerLeave);
    overlay.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("keydown", onKeyDown);
  }

  function canvasCoords(ev) {
    const rect = overlay.getBoundingClientRect();
    // Account for potential CSS scaling vs canvas pixel size
    const scaleX = overlay.width / rect.width;
    const scaleY = overlay.height / rect.height;
    const x = (ev.clientX - rect.left) * scaleX;
    const y = (ev.clientY - rect.top) * scaleY;
    return { x, y };
  }

  function onPointerDown(e) {
    if (!active) return;
    overlay.setPointerCapture(e.pointerId);
    capturedId = e.pointerId;
    dragging = true;
    start = canvasCoords(e);
    current = { ...start };
    updateRect();
    drawOverlay();
  }

  function onPointerMove(e) {
    if (!active || !dragging) return;
    current = canvasCoords(e);
    updateRect();
    drawOverlay();
  }

  function onPointerUp(e) {
    if (!active) return;
    if (dragging) {
      dragging = false;
      if (capturedId != null) {
        try { overlay.releasePointerCapture(capturedId); } catch {}
      }
      capturedId = null;
    }
    // Commit only if we actually dragged to create non-zero rect
    const commit = rect && rect.w !== 0 && rect.h !== 0;
    endCrop(commit);
  }

  function onPointerCancel(e) {
    if (!active) return;
    if (dragging) {
      dragging = false;
      if (capturedId != null) {
        try { overlay.releasePointerCapture(capturedId); } catch {}
      }
      capturedId = null;
    }
    // Cancel selection on pointer cancel to avoid accidental commit
    endCrop(false);
  }

  function onPointerLeave(e) {
    if (!active) return;
    // Do not finalize on leave; keep dragging until pointerup occurs inside/outside.
    // Optionally could show a hint here in the future.
    // No-op by design to prevent accidental finalize.
  }

  function onKeyDown(e) {
    if (!active) return;
    if (e.key === "Escape") {
      e.preventDefault();
      endCrop(false);
    }
  }

  function updateRect() {
    const x = Math.round(start.x);
    const y = Math.round(start.y);
    const x2 = Math.round(current.x);
    const y2 = Math.round(current.y);
    rect = {
      x: Math.min(x, x2),
      y: Math.min(y, y2),
      w: Math.abs(x2 - x),
      h: Math.abs(y2 - y),
    };
  }

  function clearOverlay() {
    octx.clearRect(0, 0, overlay.width, overlay.height);
  }

  function drawOverlay() {
    clearOverlay();
    if (!active) return;

    // Dim everything
    octx.save();
    octx.fillStyle = "rgba(0,0,0,0.45)";
    octx.fillRect(0, 0, overlay.width, overlay.height);

    if (rect && (rect.w > 0 || rect.h > 0)) {
      // Clear selection area (show underlying image)
      octx.clearRect(rect.x, rect.y, rect.w, rect.h);

      // Draw border
      octx.strokeStyle = "#4da3ff";
      octx.lineWidth = 1;
      octx.setLineDash([6, 4]);
      octx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);

      // Draw size label
      const label = `${rect.w} × ${rect.h}`;
      const padding = 4;
      octx.setLineDash([]);
      octx.font = "12px ui-monospace, monospace";
      const tw = octx.measureText(label).width;
      const bx = Math.min(Math.max(rect.x + 6, 2), overlay.width - tw - 10);
      const by = Math.min(Math.max(rect.y + 6, 14), overlay.height - 6);
      octx.fillStyle = "rgba(0,0,0,0.7)";
      octx.fillRect(bx - padding, by - 12, tw + padding * 2, 16);
      octx.strokeStyle = "rgba(255,255,255,0.15)";
      octx.strokeRect(bx - padding, by - 12, tw + padding * 2, 16);
      octx.fillStyle = "#e6e6e6";
      octx.fillText(label, bx, by);
    } else {
      // Hint text
      octx.setLineDash([]);
      octx.font = "13px system-ui, sans-serif";
      octx.fillStyle = "rgba(255,255,255,0.75)";
      const msg = "Drag to select an area • Esc to cancel";
      const tw = octx.measureText(msg).width;
      octx.fillText(msg, overlay.width / 2 - tw / 2, 24);
    }

    octx.restore();
  }

  // Ensure overlay size matches canvas when canvas resizes
  const ro = new ResizeObserver(() => {
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    if (active) drawOverlay();
  });
  ro.observe(canvas);

  // Initial sync
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  overlay.style.pointerEvents = "none";

  return { toggle };
}
