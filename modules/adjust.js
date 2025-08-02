/**
 * adjust.js
 * Brightness & contrast adjustments with live preview and debounced commit.
 *
 * UX:
 * - When the user starts moving either slider, we capture a base ImageData snapshot.
 * - While moving sliders, we render a preview from the base snapshot (not cumulative).
 * - After the user pauses for 200ms, we commit the result to the canvas and invoke onCommit().
 * - Sliders reset back to 0 after commit so subsequent edits are relative to the new baseline.
 */

export function initAdjust({ canvas, brightnessSlider, contrastSlider, onCommit }) {
  if (!canvas || !brightnessSlider || !contrastSlider) return;

  const ctx = canvas.getContext("2d");
  let baseSnapshot = null;   // ImageData captured at the start of an adjustment gesture
  let commitTimer = null;    // debounce timer
  let active = false;        // whether currently adjusting

  // Reusable preview buffer and rAF coalescing
  let previewBuffer = null;  // ImageData reused for previews
  let rafScheduled = false;  // whether a preview render is scheduled
  let latestB = 0;
  let latestC = 0;

  function captureBaseIfNeeded() {
    if (!canvas.width || !canvas.height) return false;
    if (!active) {
      try {
        baseSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
        active = true;
      } catch (e) {
        // Likely tainted; abort adjustment gracefully
        console.error("Failed to capture base snapshot:", e);
        baseSnapshot = null;
        active = false;
        return false;
      }
    }
    return true;
  }

  function scheduleCommit() {
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      commit();
    }, 200);
  }

  function commit() {
    if (!active) return;
    // At this moment, the current canvas already shows the latest preview.
    // We push to history via onCommit(), then reset sliders and state.
    onCommit && onCommit();
    resetControls();
  }

  function resetControls() {
    active = false;
    baseSnapshot = null;
    brightnessSlider.value = "0";
    contrastSlider.value = "0";
  }

  function schedulePreview() {
    if (!baseSnapshot) return;

    // coalesce multiple input events into a single rAF
    if (rafScheduled) return;
    rafScheduled = true;

    requestAnimationFrame(() => {
      rafScheduled = false;

      const b = latestB;
      const c = latestC;

      // If both are zero, show the base snapshot (fast path)
      if (b === 0 && c === 0) {
        try {
          ctx.putImageData(baseSnapshot, 0, 0);
        } catch (e) {
          console.error("Preview putImageData failed:", e);
        }
        return;
      }

      try {
        // Ensure preview buffer exists and matches base snapshot size
        if (!previewBuffer || previewBuffer.width !== baseSnapshot.width || previewBuffer.height !== baseSnapshot.height) {
          previewBuffer = new ImageData(baseSnapshot.width, baseSnapshot.height);
        }
        // Write into reusable previewBuffer
        adjustBrightnessContrastInto(baseSnapshot, b, c, previewBuffer);
        ctx.putImageData(previewBuffer, 0, 0);
      } catch (e) {
        console.error("Preview render failed:", e);
      }
    });
  }

  function onInput() {
    if (!captureBaseIfNeeded()) return;

    // Store latest slider values, then schedule single-frame preview
    latestB = parseInt(brightnessSlider.value || "0", 10);
    latestC = parseInt(contrastSlider.value || "0", 10);

    schedulePreview();
    scheduleCommit();
  }

  // Bind events
  brightnessSlider.addEventListener("input", onInput);
  contrastSlider.addEventListener("input", onInput);

  // If user releases mouse/touch, force faster commit for responsiveness
  ["change", "mouseup", "touchend", "keyup"].forEach(evt => {
    brightnessSlider.addEventListener(evt, () => scheduleCommit());
    contrastSlider.addEventListener(evt, () => scheduleCommit());
  });
}

/**
 * Returns a new ImageData with brightness and contrast applied to source.
 * brightness: -100..100
 * contrast:   -100..100
 */
export function adjustBrightnessContrast(sourceImageData, brightness, contrast) {
  const out = new ImageData(sourceImageData.width, sourceImageData.height);
  adjustBrightnessContrastInto(sourceImageData, brightness, contrast, out);
  return out;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

/**
 * Write brightness/contrast result into provided out ImageData (reuses buffer).
 * brightness: -100..100
 * contrast:   -100..100
 */
export function adjustBrightnessContrastInto(sourceImageData, brightness, contrast, out) {
  const w = sourceImageData.width;
  const h = sourceImageData.height;
  if (!out || out.width !== w || out.height !== h) {
    throw new Error("adjustBrightnessContrastInto: out buffer size mismatch");
  }

  const src = sourceImageData.data;
  const dst = out.data;

  // Map brightness -100..100 to additive offset
  const offset = Math.round((brightness / 100) * 255);

  // Contrast factor without || 1 discontinuity
  // contrast -100..100 -> -255..255
  const c255raw = contrast * 2.55;
  const c255 = Math.max(-255, Math.min(255, c255raw));
  const denom = 255 * (259 - c255);
  const factor = denom !== 0 ? (259 * (c255 + 255)) / denom : 1;

  for (let i = 0; i < src.length; i += 4) {
    let r = src[i] + offset;
    let g = src[i + 1] + offset;
    let b = src[i + 2] + offset;
    const a = src[i + 3];

    r = factor * (r - 128) + 128;
    g = factor * (g - 128) + 128;
    b = factor * (b - 128) + 128;

    dst[i]     = clamp255(r);
    dst[i + 1] = clamp255(g);
    dst[i + 2] = clamp255(b);
    dst[i + 3] = a; // keep alpha
  }
}
