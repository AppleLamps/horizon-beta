/**
 * ui.js
 * UI helpers extracted from app.js. Functions are stateless and receive required DOM nodes.
 */

export function showToast(toastsEl, title, message) {
  if (!toastsEl) return;
  const el = document.createElement("div");
  el.className = "toast";
  const strong = document.createElement("strong");
  strong.textContent = title;
  el.appendChild(strong);
  if (message) {
    el.appendChild(document.createTextNode(` — ${message}`));
  }
  toastsEl.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, 2500);
}

export function announce(toastsEl, text) {
  if (!toastsEl) return;
  const sr = document.createElement("div");
  sr.className = "sr-only";
  sr.textContent = text;
  toastsEl.appendChild(sr);
  setTimeout(() => sr.remove(), 1000);
}

export function renderHistoryStrip(historyStripEl, entries, prefs, {
  canvas,
  undo,
  redo,
  getCurrentIndex,
  jumpTo, // optional optimized jump
  drawImageData, // required for correct canvas updates while jumping
  onHistoryChange,
  announce: announceFn,
  showToast: showToastFn
}) {
  if (!historyStripEl) return;
  if (!Array.isArray(entries)) entries = [];
  historyStripEl.innerHTML = "";
  const currentIdx = typeof getCurrentIndex === "function" ? getCurrentIndex() : (entries.length - 1);

  entries.forEach((e, idx) => {
    const btn = document.createElement("button");
    btn.className = "history-item" + (idx === currentIdx ? " selected" : "");
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", String(idx === currentIdx));
    btn.title = (e.label ? (e.label + " • ") : "") + `${e.width}×${e.height}`;

    const img = document.createElement("img");
    img.alt = e.label || `State ${idx+1}`;
    const prefH = prefs && prefs.height ? prefs.height : parseInt(getComputedStyle(historyStripEl).getPropertyValue("--hist-thumb")) || 96;
    img.height = prefH;
    img.width = Math.max(1, Math.round((e.width / e.height) * prefH));
    if (e.thumbDataUrl) {
      img.src = e.thumbDataUrl;
    } else if (idx === currentIdx && canvas && canvas.width && canvas.height) {
      try {
        const h = prefH;
        const w = Math.max(1, Math.round(canvas.width * (h / canvas.height)));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const cctx = c.getContext("2d");
        cctx.imageSmoothingEnabled = true;
        cctx.imageSmoothingQuality = "high";
        cctx.drawImage(canvas, 0, 0, w, h);
        img.src = c.toDataURL("image/webp");
      } catch {}
    }

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = e.label || `${e.width}×${e.height}`;

    btn.appendChild(img);
    btn.appendChild(label);

    btn.addEventListener("click", () => {
      const delta = currentIdx - idx;
      if (delta === 0) return;
      try {
        // Prefer optimized jump if available
        if (typeof jumpTo === "function") {
          const data = jumpTo(idx);
          if (data && drawImageData) {
            drawImageData(data);
          }
        } else if (drawImageData) {
          // Minimal fix: apply returned ImageData on each step
          if (delta > 0) {
            for (let i = 0; i < delta; i++) {
              const data = undo && undo();
              if (data) drawImageData(data);
            }
          } else {
            for (let i = 0; i < Math.abs(delta); i++) {
              const data = redo && redo();
              if (data) drawImageData(data);
            }
          }
        } else {
          // Fallback: maintain previous behavior without canvas updates per step
          if (delta > 0) {
            for (let i = 0; i < delta; i++) undo && undo();
          } else {
            for (let i = 0; i < Math.abs(delta); i++) redo && redo();
          }
        }
      } finally {
        onHistoryChange && onHistoryChange();
        announceFn && announceFn("Jumped to history step " + (idx + 1));
        showToastFn && showToastFn("History", `Jumped to step ${idx + 1}`);
      }
    });

    historyStripEl.appendChild(btn);
  });
}

export function updateUndoRedoButtons({ undoBtn, redoBtn, saveBtn, brightness, contrast, saturation, vibrance }, { getTainted, canUndo, canRedo }) {
  const tainted = getTainted && getTainted();
  if (undoBtn) undoBtn.disabled = tainted || !canUndo();
  if (redoBtn) redoBtn.disabled = tainted || !canRedo();
  if (saveBtn) saveBtn.disabled = !!tainted;
  if (brightness) brightness.disabled = !!tainted;
  if (contrast) contrast.disabled = !!tainted;
  if (saturation) saturation.disabled = !!tainted;
  if (vibrance) vibrance.disabled = !!tainted;
}

export function handleFormatChange(formatSel, qualityRange, qualityVal) {
  const fmt = (formatSel && formatSel.value) || "png";
  const isLossy = fmt === "jpeg" || fmt === "webp";
  if (qualityRange) {
    qualityRange.disabled = !isLossy;
    if (!isLossy) qualityVal && (qualityVal.textContent = "N/A");
    else qualityVal && (qualityVal.textContent = Number(qualityRange.value || 0.85).toFixed(2));
  }
}

export function applyHistSize(historyStripEl, h) {
  if (!historyStripEl) return;
  const px = Math.max(48, Math.min(256, Math.floor(h)));
  historyStripEl.style.setProperty("--hist-thumb", px + "px");
}

export function updateCanvasAriaLabel(canvasEl) {
  if (!canvasEl) return;
  if (canvasEl.width && canvasEl.height) {
    canvasEl.setAttribute("aria-label", `Image canvas, ${canvasEl.width} by ${canvasEl.height} pixels`);
  } else {
    canvasEl.setAttribute("aria-label", "Image canvas, empty");
  }
}

/**
 * Optional binder to reduce argument passing around the app.
 */
export function initUI(elements, services) {
  const {
    toasts,
    historyStrip,
    canvas,
    formatSel,
    qualityRange,
    qualityVal
  } = elements;

  const boundShowToast = (title, message) => showToast(toasts, title, message);
  const boundAnnounce = (text) => announce(toasts, text);
  const boundRenderHistoryStrip = (entries, prefs) => renderHistoryStrip(historyStrip, entries, prefs, {
    canvas,
    undo: services?.undo,
    redo: services?.redo,
    getCurrentIndex: services?.getCurrentIndex,
    jumpTo: services?.jumpTo,
    drawImageData: services?.drawImageData,
    onHistoryChange: services?.onHistoryChange,
    announce: boundAnnounce,
    showToast: boundShowToast
  });
  const boundUpdateUndoRedoButtons = (buttons) =>
    updateUndoRedoButtons(buttons, {
      getTainted: services?.getTainted,
      canUndo: services?.canUndo,
      canRedo: services?.canRedo
    });
  const boundHandleFormatChange = () => handleFormatChange(formatSel, qualityRange, qualityVal);
  const boundApplyHistSize = (h) => applyHistSize(historyStrip, h);
  const boundUpdateCanvasAriaLabel = () => updateCanvasAriaLabel(canvas);

  return {
    showToast: boundShowToast,
    announce: boundAnnounce,
    renderHistoryStrip: boundRenderHistoryStrip,
    updateUndoRedoButtons: boundUpdateUndoRedoButtons,
    handleFormatChange: boundHandleFormatChange,
    applyHistSize: boundApplyHistSize,
    updateCanvasAriaLabel: boundUpdateCanvasAriaLabel
  };
}
