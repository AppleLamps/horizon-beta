/**
 * loader.js
 * Handles file input and draws the selected image to the canvas.
 */

export function initLoader({ fileInput, onImage, setLoading, options = {} }) {
  if (!fileInput) return;

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      setLoading && setLoading(true);
      const bitmap = await fileToImageBitmap(file, options);
      onImage && onImage(bitmap);
    } catch (err) {
      console.error("Failed to load image:", err);
      // Prefer non-blocking UX; if a toast/notify callback is provided, use it; otherwise log.
      if (options.onNotify) {
        options.onNotify("Failed to load image. Please try a different file.", { type: "error", error: err });
      } else {
        // Fallback to alert only if no notify system exists
        alert("Failed to load image. Please try a different file.");
      }
    } finally {
      setLoading && setLoading(false);
      // Let user re-select the same file if needed
      fileInput.value = "";
    }
  });
}

/**
 * Initialize drag-and-drop loading on a wrapper element. Calls onImage with an ImageBitmap/Canvas.
 */
export function initDragAndDrop(canvasWrapper, onImage, { onNotify } = {}) {
  if (!canvasWrapper) return;
  const dndOverClass = "is-drag-over";
  const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
  ["dragenter", "dragover"].forEach(ev => {
    canvasWrapper.addEventListener(ev, (e) => {
      prevent(e);
      canvasWrapper.classList.add(dndOverClass);
    });
  });
  ["dragleave", "drop"].forEach(ev => {
    canvasWrapper.addEventListener(ev, (e) => {
      prevent(e);
      if (ev === "dragleave") {
        if (!canvasWrapper.contains(e.relatedTarget)) {
          canvasWrapper.classList.remove(dndOverClass);
        }
      } else {
        canvasWrapper.classList.remove(dndOverClass);
      }
    });
  });
  canvasWrapper.addEventListener("drop", async (e) => {
    const dt = e.dataTransfer;
    if (!dt || !dt.files || dt.files.length === 0) return;
    const file = Array.from(dt.files).find(f => /^image\//i.test(f.type));
    if (!file) {
      onNotify && onNotify("Please drop an image file.", { type: "warning" });
      return;
    }
    try {
      const bitmap = await fileToImageBitmap(file, { onNotify });
      onImage && onImage(bitmap);
    } catch (err) {
      console.error("Drop load failed:", err);
      onNotify && onNotify("Could not load the dropped file.", { type: "error", error: err });
    }
  });
}

async function fileToImageBitmap(file, options = {}) {
  const {
    maxDimension = 4096,
    onNotify, // optional callback: (message, { type: 'info'|'warning'|'error', meta? })
  } = options;

  // Preferred path: createImageBitmap directly from File/Blob (no blob URL/fetch overhead)
  if (window.createImageBitmap) {
    try {
      let bitmap = await createImageBitmap(file);

      // Optional downscale if image is extremely large
      if ((bitmap.width > maxDimension) || (bitmap.height > maxDimension)) {
        const scaled = await downscaleToMax(bitmap, maxDimension);
        // Close original bitmap to free memory when supported
        try { typeof bitmap.close === "function" && bitmap.close(); } catch {}
        bitmap = scaled;
        if (onNotify) {
          onNotify(`Image was downscaled for performance to fit within ${maxDimension}px.`, { type: "info" });
        }
      }

      return bitmap;
    } catch (e) {
      // Fall through to HTMLImageElement fallback
      console.warn("createImageBitmap(file) failed, falling back to HTMLImageElement path.", e);
    }
  }

  // Fallback: HTMLImageElement + FileReader
  const dataURL = await readFileAsDataURL(file);
  const img = await loadImage(dataURL);
  if (typeof img.decode === "function") {
    try { await img.decode(); } catch {}
  }

  // Attempt to convert to ImageBitmap for consistency if supported
  try {
    let bitmap = await (window.createImageBitmap ? createImageBitmap(img) : createImageBitmapFromCanvasFallbackImage(img));
    if ((bitmap.width > maxDimension) || (bitmap.height > maxDimension)) {
      const scaled = await downscaleToMax(bitmap, maxDimension);
      // If bitmap has close, close the original
      try { typeof bitmap.close === "function" && bitmap.close(); } catch {}
      bitmap = scaled;
      if (onNotify) {
        onNotify(`Image was downscaled for performance to fit within ${maxDimension}px.`, { type: "info" });
      }
    }
    return bitmap;
  } catch {
    // Last resort: draw to canvas and return canvas (works with drawImage)
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const cx = c.getContext("2d");
    cx.drawImage(img, 0, 0);
    let fallback = await createImageBitmapFromCanvasFallback(c);

    // Downscale if oversized
    if ((fallback.width > maxDimension) || (fallback.height > maxDimension)) {
      fallback = await downscaleToMax(fallback, maxDimension);
      if (onNotify) {
        onNotify(`Image was downscaled for performance to fit within ${maxDimension}px.`, { type: "info" });
      }
    }
    return fallback;
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = (e) => reject(e);
    fr.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

/**
 * Downscale any image-like source (ImageBitmap or Canvas) to fit within maxDimension.
 * Returns an ImageBitmap when possible; otherwise a Canvas.
 */
async function downscaleToMax(source, maxDimension) {
  const width = source.width;
  const height = source.height;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  if (scale === 1) return source;

  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  // Prefer OffscreenCanvas for performance if available
  let canvas, ctx;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(targetW, targetH);
    ctx = canvas.getContext("2d");
  } else {
    canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    ctx = canvas.getContext("2d");
  }

  if (!ctx) return source;

  ctx.imageSmoothingEnabled = true;
  try { ctx.imageSmoothingQuality = "high"; } catch {}

  // drawImage accepts ImageBitmap and Canvas as sources
  ctx.drawImage(source, 0, 0, width, height, 0, 0, targetW, targetH);

  // Try to return an ImageBitmap if possible
  if (typeof canvas.transferToImageBitmap === "function") {
    return canvas.transferToImageBitmap();
  }
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(canvas); } catch {}
  }
  return canvas;
}

// Attempt to create ImageBitmap via a temporary canvas when only an HTMLImageElement is available
async function createImageBitmapFromCanvasFallbackImage(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const cx = c.getContext("2d");
  cx.drawImage(img, 0, 0);
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(c); } catch {}
  }
  return c;
}

// Minimal fallback that returns the canvas directly; acceptable for drawImage usage.
async function createImageBitmapFromCanvasFallback(canvas) {
  return canvas;
}
