import { initHistory, pushHistory, undo, redo, canUndo, canRedo, getTainted, getHistoryThumbnails, setThumbHeight, setMaxEntries } from "./modules/history.js";
import { initLoader, initDragAndDrop } from "./modules/loader.js";
import { rotate90CW, flipHorizontal, cropToRect } from "./modules/transforms.js";
import { initCropOverlay } from "./modules/cropOverlay.js";
import { initTextTool } from "./modules/textTool.js";
import { initBrushTool } from "./modules/brushTool.js";
import { initUI } from "./modules/ui.js";
import { initExport, downloadPNG as downloadPNGExport } from "./modules/export.js";
import { initShortcuts } from "./modules/shortcuts.js";

const canvas = document.getElementById("canvas");
const textLayer = document.getElementById("text-layer");
const drawLayer = document.getElementById("draw-layer");
const overlay = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

// DOM refs
const fileInput = document.getElementById("fileInput");
const cropBtn = document.getElementById("cropBtn");
const rotateBtn = document.getElementById("rotateBtn");
const flipHBtn = document.getElementById("flipHBtn");
const brightness = document.getElementById("brightness");
const contrast = document.getElementById("contrast");
const saturation = document.getElementById("saturation");
const vibrance = document.getElementById("vibrance");
const resetAdjustBtn = document.getElementById("resetAdjustBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const saveBtn = document.getElementById("saveBtn");
const exportBtn = document.getElementById("exportBtn");
const historyStrip = document.getElementById("historyStrip");
const histSize = document.getElementById("histSize");
// Filters
const vintageBtn = document.getElementById("vintageBtn");
const lomoBtn = document.getElementById("lomoBtn");
const sepiaBtn = document.getElementById("sepiaBtn");
const nostalgiaBtn = document.getElementById("nostalgiaBtn");
/* Text tool */
const textBtn = document.getElementById("textBtn");
const textControls = document.getElementById("textControls");
const textInput = document.getElementById("textInput");
const textColor = document.getElementById("textColor");
const fontSize = document.getElementById("fontSize");
const addTextBtn = document.getElementById("addTextBtn");
let flattenTextBtn = null; // will create button dynamically

/* Brush tool */
const drawBtn = document.getElementById("drawBtn");
const brushControls = document.getElementById("brushControls");
const brushColor = document.getElementById("brushColor");
const brushSize = document.getElementById("brushSize");
// Export UI
const exportDialog = document.getElementById("exportDialog");
const formatSel = document.getElementById("format");
const qualityRange = document.getElementById("quality");
const qualityVal = document.getElementById("qualityVal");
const scaleInput = document.getElementById("scale");
const cancelExportBtn = document.getElementById("cancelExport");
const confirmExportBtn = document.getElementById("confirmExport");
// Misc UI
const hint = document.getElementById("hint");
const canvasWrapper = document.getElementById("canvasWrapper");
const toasts = document.getElementById("toasts");
const layersPanel = document.getElementById("layersPanel");
const layerList = document.getElementById("layerList");

// Settings helpers
const SETTINGS_KEY = "photoEdit.settings";
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveSettings(next) {
  try {
    const prev = loadSettings();
    const merged = { ...prev, ...next };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  } catch {}
}

function setCanvasSize(w, h){
  canvas.width = Math.max(1, Math.floor(w));
  canvas.height = Math.max(1, Math.floor(h));
  // keep layers in sync
  if (textLayer) {
    textLayer.width = canvas.width;
    textLayer.height = canvas.height;
  }
  if (drawLayer) {
    drawLayer.width = canvas.width;
    drawLayer.height = canvas.height;
  }
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  // ui updates moved inside main() scope-safe wrappers
}

function drawImageData(imgData){
  setCanvasSize(imgData.width, imgData.height);
  ctx.putImageData(imgData, 0, 0);
  // ui updates moved inside main() scope-safe wrappers
}

function main(){
  // Bind UI helpers
  const ui = initUI({
    toasts,
    historyStrip,
    canvas,
    formatSel,
    qualityRange,
    qualityVal
  }, {
    undo,
    redo,
    onHistoryChange,
    getTainted,
    canUndo,
    canRedo,
    getCurrentIndex: () => {
      const thumbs = getHistoryThumbnails();
      return Array.isArray(thumbs) ? thumbs.length - 1 : 0;
    },
    jumpTo: null, // optimized jump not implemented; ui will iterate undo/redo
    drawImageData: (data) => drawImageDataWithUI(data)
  });

  // Busy/serialization for Caman and debounce
  let camanBusy = false;
  let camanOpToken = 0;

  function setUiBusy(busy) {
    [brightness, contrast, saturation, vibrance, vintageBtn, lomoBtn, sepiaBtn, nostalgiaBtn].forEach(el => {
      if (!el) return;
      el.disabled = !!busy;
      el.setAttribute("aria-disabled", String(!!busy));
    });
  }

  function debounce(fn, wait = 200) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function withCaman(work, { label, onDone } = {}) {
    if (!canvas.width) return;
    // cancel previous by advancing token
    const token = ++camanOpToken;
    if (camanBusy) {
      // allow previous render to finish but mark it stale by token comparison
    }
    camanBusy = true;
    setUiBusy(true);
    try {
      Caman("#canvas", function () {
        try {
          // Ensure we always start from current pixels unless explicitly reverted inside work
          work && work.call(this);
          this.render(() => {
            // Only accept result if token matches latest
            if (token === camanOpToken) {
              if (label) {
                try { pushHistory(label); } catch {}
              }
              onHistoryChange();
              if (label) {
                ui.announce(`${label} applied`);
              }
              onDone && onDone();
            }
            camanBusy = false;
            setUiBusy(false);
          });
        } catch (e) {
          console.error("Caman work failed:", e);
          camanBusy = false;
          setUiBusy(false);
          onHistoryChange({ tainted: true });
        }
      });
    } catch (e) {
      console.error("Caman init failed:", e);
      camanBusy = false;
      setUiBusy(false);
      onHistoryChange({ tainted: true });
    }
  }

  function applyAdjustmentsFromUI() {
    const b = parseInt(brightness?.value || "0", 10) || 0;
    const c = parseInt(contrast?.value || "0", 10) || 0;
    const s = parseInt(saturation?.value || "0", 10) || 0;
    const v = parseInt(vibrance?.value || "0", 10) || 0;
    withCaman(function () {
      this.revert(false);
      this.brightness(b);
      this.contrast(c);
      this.saturation(s);
      this.vibrance(v);
    }, { label: "Adjustments" });
  }

  const applyAdjustmentsDebounced = debounce(applyAdjustmentsFromUI, 200);

  // Layer sync helper (tools may provide ensure functions)
  function syncLayers() {
    try {
      textApi && textApi.ensureLayerSize && textApi.ensureLayerSize();
    } catch {}
    try {
      brushApi && brushApi.ensureLayerSizeLike && brushApi.ensureLayerSizeLike(canvas);
    } catch {}
  }

  // Safe wrappers that can access ui
  const setCanvasSizeWithUI = (w, h) => {
    setCanvasSize(w, h);
    ui.updateCanvasAriaLabel();
    syncLayers();
  };
  const drawImageDataWithUI = (imgData) => {
    drawImageData(imgData);
    ui.updateCanvasAriaLabel();
    syncLayers();
  };

  function onHistoryChange(payload){
    const tainted = (payload && payload.tainted) || (getTainted && getTainted());
    ui.updateUndoRedoButtons({ undoBtn, redoBtn, saveBtn, brightness, contrast, saturation, vibrance });
    if (!document.body.classList.contains("is-cropping")) {
      hint.textContent = canvas.width ? "Tip: Use Crop, Rotate, Flip, or the sliders. Undo/Redo available." : "Drop or load an image to begin. No uploads, all in-browser.";
    }
    if (tainted) {
      ui.showToast("Cross-origin image", "Undo, adjustments, and saving are disabled.");
      ui.announce("Image is cross-origin; undo, adjustments, and saving are disabled.");
    }
    ui.renderHistoryStrip((payload && payload.thumbnails) || getHistoryThumbnails(), (payload && payload.thumbPrefs) || null);
    ui.updateCanvasAriaLabel();
  }

  // History
  initHistory(canvas, onHistoryChange);

  // Settings
  const settings = loadSettings();
  if (settings && Number.isFinite(settings.historyMax) && settings.historyMax > 0) {
    try { setMaxEntries(Math.floor(settings.historyMax)); } catch {}
  }

  // Shared bitmap loader (DRY for file input and DnD)
  const loadBitmap = (bmp) => {
    setCanvasSizeWithUI(bmp.width, bmp.height);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(bmp, 0, 0);
    pushHistory();
    onHistoryChange();
    ui.announce(`Image loaded ${canvas.width} by ${canvas.height} pixels`);
    cropBtn && cropBtn.focus();
  };

  // Loader (file input)
  initLoader({
    fileInput,
    setLoading: (loading) => {
      if (!canvasWrapper) return;
      canvasWrapper.classList.toggle("is-loading", !!loading);
    },
    onImage: loadBitmap,
    options: {
      onNotify: (msg, meta) => ui.showToast(meta?.type === "error" ? "Error" : "Info", msg)
    }
  });

  // Drag & Drop
  initDragAndDrop(canvasWrapper, loadBitmap, {
    onNotify: (msg, meta) => ui.showToast(meta?.type === "error" ? "Error" : "Info", msg)
  });

  // Crop overlay
  const crop = initCropOverlay({
    canvas,
    overlay,
    onFinalize: (rect) => {
      if (!rect || rect.w <= 0 || rect.h <= 0) return;
      try {
        cropToRect(canvas, rect);
        pushHistory();
        onHistoryChange();
        syncLayers();
        ui.announce(`Cropped to ${canvas.width} by ${canvas.height} pixels`);
        ui.showToast("Cropped", `${canvas.width}×${canvas.height}`);
      } catch (e) {
        console.error("Crop failed:", e);
        onHistoryChange({ tainted: true });
      } finally {
        document.body.classList.remove("crop-active", "is-cropping");
        cropBtn.classList.remove("active", "is-active");
        cropBtn.focus();
      }
    },
    onCancel: () => {
      document.body.classList.remove("crop-active", "is-cropping");
      cropBtn.classList.remove("active", "is-active");
      cropBtn.focus();
      ui.announce("Crop cancelled");
      hint.textContent = canvas.width ? "Tip: Use Crop, Rotate, Flip, or the sliders. Undo/Redo available." : "Drop or load an image to begin. No uploads, all in-browser.";
    }
  });

  // Text tool
  let textApi = null;

  // Brush tool
  let brushApi = null;
  if (textBtn && textControls && addTextBtn && textInput && textColor && fontSize && textLayer) {
    // Create a Flatten/Apply button next to Add (non-destructive workflow)
    if (!flattenTextBtn) {
      flattenTextBtn = document.createElement("button");
      flattenTextBtn.id = "flattenTextBtn";
      flattenTextBtn.className = "tool-btn";
      flattenTextBtn.type = "button";
      flattenTextBtn.textContent = "Apply Text";
      addTextBtn.insertAdjacentElement("afterend", flattenTextBtn);
    }

    textApi = initTextTool({
      canvas,
      textLayer,
      textControls,
      addTextBtn,
      textInput,
      textColor,
      fontSize,
      flattenBtn: flattenTextBtn,
      onCommit: () => {
        try { pushHistory("Text"); } catch {}
        onHistoryChange();
        // After flatten, keep tool open but clear layer interactivity
        textApi && textApi.setInteractive(false);
        ui.announce("Text applied to image");
        ui.showToast("Text", "Applied to image");
      }
    });

    textBtn.addEventListener("click", () => {
      // Deactivate brush tool when opening text tool
      if (brushApi) brushApi.setActive(false);
      if (brushControls) brushControls.style.display = "none";
      drawBtn && drawBtn.classList.remove("is-active");
      if (!canvas.width) return;
      const isShown = textControls.style.display !== "none";
      const next = !isShown;
      textControls.style.display = next ? "" : "none";
      textBtn.classList.toggle("is-active", next);
      textBtn.setAttribute("aria-pressed", String(next));
      if (next) {
        // When activating, ensure text layer sized and interactive
        textApi && textApi.ensureLayerSize();
        textApi && textApi.setInteractive(true);
        ui.announce("Text tool active. Enter text then press Add to preview on text layer. Use Apply to merge.");
        textInput && textInput.focus();
      } else {
        textApi && textApi.setInteractive(false);
        ui.announce("Text tool closed");
      }
    });
  }

  // Brush tool init and toggle
  if (drawBtn && brushControls && brushColor && brushSize && drawLayer) {
    brushApi = initBrushTool(drawLayer, {
      controlsEl: brushControls,
      colorInput: brushColor,
      sizeInput: brushSize,
      getActive: () => drawBtn.classList.contains("is-active"),
      onActivate: (active) => {
        // make layer interactive only when active
        drawLayer.style.pointerEvents = active ? "auto" : "none";
      }
    });

    drawBtn.addEventListener("click", () => {
      if (!canvas.width) return;
      // close text tool if open
      if (textControls) textControls.style.display = "none";
      textBtn && textBtn.classList.remove("is-active");
      textBtn && textBtn.setAttribute("aria-pressed", "false");
      textApi && textApi.setInteractive(false);

      const nowActive = !drawBtn.classList.contains("is-active");
      drawBtn.classList.toggle("is-active", nowActive);
      drawBtn.setAttribute("aria-pressed", String(nowActive));
      brushApi.setActive(nowActive);
      if (nowActive) {
        // Ensure layer size matches base canvas
        brushApi.ensureLayerSizeLike(canvas);
        // Announce UI
        ui.announce("Brush tool active. Drag on the canvas to draw. Adjust color and size in controls.");
        brushControls.style.display = "";
      } else {
        ui.announce("Brush tool closed");
        brushControls.style.display = "none";
      }
    });
  }

  // Transform buttons
  rotateBtn.addEventListener("click", () => {
    if (!canvas.width) return;
    try {
      rotate90CW(canvas);
      pushHistory();
      onHistoryChange();
      syncLayers();
      ui.announce("Rotated 90 degrees");
      ui.showToast("Rotated", "Image rotated 90°");
    } catch (e) {
      console.error("Rotate failed:", e);
      onHistoryChange({ tainted: true });
    }
  });

  flipHBtn.addEventListener("click", () => {
    if (!canvas.width) return;
    try {
      flipHorizontal(canvas);
      pushHistory();
      onHistoryChange();
      syncLayers();
      ui.announce("Flipped horizontally");
      ui.showToast("Flipped", "Image flipped horizontally");
    } catch (e) {
      console.error("Flip failed:", e);
      onHistoryChange({ tainted: true });
    }
  });

  // Filters via CamanJS
  function applyFilter(label, applyFn){
    if (!canvas.width) return;
    withCaman(function () {
      applyFn.call(this);
    }, { label, onDone: () => ui.showToast("Filter Applied", `${label} effect added.`) });
  }
  vintageBtn && vintageBtn.addEventListener("click", () => applyFilter("Vintage", function(){ this.vintage(); }));
  lomoBtn && lomoBtn.addEventListener("click", () => applyFilter("Lomo", function(){ this.lomo(); }));
  sepiaBtn && sepiaBtn.addEventListener("click", () => applyFilter("Sepia", function(){ this.sepia(); }));
  nostalgiaBtn && nostalgiaBtn.addEventListener("click", () => applyFilter("Nostalgia", function(){ this.nostalgia(); }));

  // Adjustments
  (function initCamanAdjustments(){
    if (!brightness || !contrast || !saturation || !vibrance) return;

    const onAnySliderInput = () => applyAdjustmentsDebounced();

    ["input", "change"].forEach(ev => {
      brightness.addEventListener(ev, onAnySliderInput);
      contrast.addEventListener(ev, onAnySliderInput);
      saturation.addEventListener(ev, onAnySliderInput);
      vibrance.addEventListener(ev, onAnySliderInput);
    });

    if (resetAdjustBtn) {
      resetAdjustBtn.addEventListener("click", () => {
        if (!canvas.width) return;
        brightness.value = "0";
        contrast.value = "0";
        saturation.value = "0";
        vibrance.value = "0";
        try {
          withCaman(function () {
            this.revert(true);
          }, { label: "Reset Adjustments", onDone: () => {
            ui.announce("Adjustments reset");
            ui.showToast("Adjustments", "Reset to baseline");
          }});
        } catch (e) {
          console.error("Reset adjustments failed:", e);
          onHistoryChange({ tainted: true });
        }
      });
    }
  })();

  // History buttons
  undoBtn.addEventListener("click", () => {
    const data = undo();
    if (data) drawImageDataWithUI(data);
    onHistoryChange();
    ui.announce("Undid last action");
    ui.showToast("Undo", "Reverted to previous state.");
  });
  redoBtn.addEventListener("click", () => {
    const data = redo();
    if (data) drawImageDataWithUI(data);
    onHistoryChange();
    ui.announce("Redid action");
    ui.showToast("Redo", "Reapplied last change.");
  });

  // Export wiring
  const exportApi = initExport({
    canvas,
    exportBtn,
    exportDialog,
    cancelExportBtn,
    confirmExportBtn,
    formatSel,
    qualityRange,
    qualityVal,
    scaleInput
  }, {
    announce: ui.announce,
    showToast: ui.showToast
  });

  // Save PNG
  saveBtn.addEventListener("click", () => exportApi.downloadPNG());

  // History thumbnail sizing (consolidated to SETTINGS_KEY)
  if (histSize) {
    const settingsNow = loadSettings();
    const prefH = Number.isFinite(settingsNow.thumbHeight) ? Number(settingsNow.thumbHeight) : Number(histSize.value || 96);
    histSize.value = String(prefH);
    ui.applyHistSize(prefH);
    histSize.addEventListener("change", () => {
      const h = Number(histSize.value || 96);
      ui.applyHistSize(h);
      try { setThumbHeight(h); } catch {}
      saveSettings({ thumbHeight: h });
      ui.showToast("History size", `${h}px thumbnails`);
    });
  }

  // Shortcuts
  initShortcuts({
    undo: () => {
      const data = undo();
      if (data) drawImageDataWithUI(data);
      return data;
    },
    redo: () => {
      const data = redo();
      if (data) drawImageDataWithUI(data);
      return data;
    },
    drawImageData: drawImageDataWithUI,
    onHistoryChange,
    announce: ui.announce,
    showToast: ui.showToast
  });

  // Layers panel render helper
  function renderLayersPanel(activeLayer) {
    if (!layerList) return;
    // activeLayer: "image" | "text" | "draw"
    const layers = [
      { id: "image", name: "Image", present: !!canvas },
      { id: "text", name: "Text", present: !!textLayer },
      { id: "draw", name: "Drawing", present: !!drawLayer }
    ];
    layerList.innerHTML = "";
    layers.forEach(l => {
      if (!l.present) return;
      const li = document.createElement("li");
      li.textContent = l.name + (activeLayer === l.id ? " •" : "");
      li.setAttribute("data-layer", l.id);
      li.style.color = activeLayer === l.id ? "#fff" : "var(--muted)";
      layerList.appendChild(li);
    });
  }

  // Initial UI
  onHistoryChange();
  renderLayersPanel("image");

  // Update layers panel on tool toggles
  textBtn && textBtn.addEventListener("click", () => {
    const isActive = textBtn.classList.contains("is-active");
    renderLayersPanel(isActive ? "text" : "image");
  });
  drawBtn && drawBtn.addEventListener("click", () => {
    const isActive = drawBtn.classList.contains("is-active");
    renderLayersPanel(isActive ? "draw" : "image");
  });
}

main();
