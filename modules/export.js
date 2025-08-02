/**
 * export.js
 * Export logic extracted from app.js. Provides downloadPNG, exportWithOptions, and initExport.
 */

import { handleFormatChange as uiHandleFormatChange } from "./ui.js";

function featureSupports(type) {
  try {
    const c = document.createElement("canvas");
    return typeof c.toDataURL === "function" && c.toDataURL(type).startsWith(`data:${type}`);
  } catch {
    return false;
  }
}

function fillIfOpaqueFormat(ctx, w, h, format) {
  if (format === "jpeg" || format === "webp") {
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

export function downloadPNG(canvas, { announce, showToast } = {}) {
  try {
    if (!canvas || !canvas.width || !canvas.height) throw new Error("No image loaded");

    // Merge layers into a temporary canvas before exporting
    const textLayer = document.getElementById("text-layer");
    const drawLayer = document.getElementById("draw-layer");
    const temp = document.createElement("canvas");
    temp.width = canvas.width;
    temp.height = canvas.height;
    const tctx = temp.getContext("2d");
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";

    // Draw base canvas
    tctx.drawImage(canvas, 0, 0);
    // Draw text layer if present
    if (textLayer && textLayer.width && textLayer.height) {
      tctx.drawImage(textLayer, 0, 0);
    }
    // Draw draw layer if present
    if (drawLayer && drawLayer.width && drawLayer.height) {
      tctx.drawImage(drawLayer, 0, 0);
    }

    const url = temp.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "edited.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    announce && announce("Image saved as PNG");
    showToast && showToast("Saved", "Your image has been downloaded.");
  } catch (e) {
    console.error("Save failed:", e);
    announce && announce("Save failed due to browser security restrictions");
    showToast && showToast("Save failed", "Cannot export due to cross-origin restrictions.");
  }
}

export async function exportWithOptions(canvas, {
  formatSel,
  qualityRange,
  scaleInput
} = {}, { announce, showToast } = {}) {
  try {
    if (!canvas || !canvas.width || !canvas.height) throw new Error("No image loaded");

    const fmt = (formatSel?.value || "png").toLowerCase();
    const scalePct = Math.max(10, Math.min(400, parseInt(scaleInput?.value || "100", 10)));
    const quality = Math.max(0.1, Math.min(1, parseFloat(qualityRange?.value || "0.85")));

    const mime = fmt === "png" ? "image/png" : (fmt === "jpeg" ? "image/jpeg" : "image/webp");

    if (fmt === "webp" && !featureSupports("image/webp")) {
      showToast && showToast("WebP unsupported", "Your browser doesn't support WebP export.");
      return;
    }

    const outW = Math.max(1, Math.round(canvas.width * (scalePct / 100)));
    const outH = Math.max(1, Math.round(canvas.height * (scalePct / 100)));

    // Merge layers into a source temp first at 1:1, then scale
    const textLayer = document.getElementById("text-layer");
    const drawLayer = document.getElementById("draw-layer");
    const merged = document.createElement("canvas");
    merged.width = canvas.width; merged.height = canvas.height;
    const mctx = merged.getContext("2d");
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = "high";
    mctx.drawImage(canvas, 0, 0);
    if (textLayer && textLayer.width && textLayer.height) {
      mctx.drawImage(textLayer, 0, 0);
    }
    if (drawLayer && drawLayer.width && drawLayer.height) {
      mctx.drawImage(drawLayer, 0, 0);
    }

    // Now scale to requested output size
    const temp = document.createElement("canvas");
    temp.width = outW; temp.height = outH;
    const tctx = temp.getContext("2d");
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";
    tctx.drawImage(merged, 0, 0, outW, outH);
    fillIfOpaqueFormat(tctx, outW, outH, fmt);

    const blob = await new Promise((resolve, reject) => {
      if (temp.toBlob) {
        temp.toBlob((b) => b ? resolve(b) : reject(new Error("toBlob returned null")), mime, fmt === "png" ? undefined : quality);
      } else {
        try {
          const dataUrl = temp.toDataURL(mime, fmt === "png" ? undefined : quality);
          fetch(dataUrl).then(r => r.blob()).then(resolve).catch(reject);
        } catch (err) { reject(err); }
      }
    });

    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    const defaultName = fmt === "png" ? "edited.png" : (fmt === "jpeg" ? "edited.jpg" : "edited.webp");
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    announce && announce(`Image exported as ${fmt.toUpperCase()} at ${scalePct}% with quality ${fmt === "png" ? "N/A" : quality}`);
    showToast && showToast("Exported", `${fmt.toUpperCase()} ${scalePct}%${fmt === "png" ? "" : ` • Q=${quality}`}`);
  } catch (e) {
    console.error("Export failed:", e);
    announce && announce("Export failed due to browser security restrictions");
    showToast && showToast("Export failed", "Cannot export due to cross-origin restrictions.");
  }
}

/**
 * Initialize export UI wiring.
 */
export function initExport({
  canvas,
  exportBtn,
  exportDialog,
  cancelExportBtn,
  confirmExportBtn,
  formatSel,
  qualityRange,
  qualityVal,
  scaleInput
}, { announce, showToast } = {}) {

  const onOpen = () => {
    if (!canvas?.width) return;
    if (exportDialog && typeof exportDialog.showModal === "function") {
      exportDialog.showModal();
    } else {
      // Fallback: perform export with current defaults
      exportWithOptions(canvas, { formatSel, qualityRange, scaleInput }, { announce, showToast });
      return;
    }
    uiHandleFormatChange(formatSel, qualityRange, qualityVal);
  };

  exportBtn && exportBtn.addEventListener("click", onOpen);
  cancelExportBtn && exportDialog && cancelExportBtn.addEventListener("click", () => exportDialog.close());
  confirmExportBtn && exportDialog && confirmExportBtn.addEventListener("click", (e) => {
    e.preventDefault();
    exportDialog.close();
    exportWithOptions(canvas, { formatSel, qualityRange, scaleInput }, { announce, showToast });
  });
  qualityRange && qualityVal && qualityRange.addEventListener("input", () => {
    const v = Math.max(0.1, Math.min(1, parseFloat(qualityRange.value || "0.85")));
    qualityVal.textContent = v.toFixed(2);
  });
  formatSel && formatSel.addEventListener("change", () => uiHandleFormatChange(formatSel, qualityRange, qualityVal));

  return {
    downloadPNG: () => downloadPNG(canvas, { announce, showToast }),
    exportNow: () => exportWithOptions(canvas, { formatSel, qualityRange, scaleInput }, { announce, showToast })
  };
}
