/**
 * transforms.js
 * Geometric transforms (rotate, flip) and crop operation on a canvas.
 */

/**
 * Rotate canvas content 90 degrees clockwise.
 * This resizes the canvas and redraws the rotated content.
 */
export function rotate90CW(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return;

  const temp = document.createElement("canvas");
  temp.width = w;
  temp.height = h;
  const tctx = temp.getContext("2d");
  tctx.drawImage(canvas, 0, 0);

  canvas.width = h;
  canvas.height = w;
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.rotate(90 * Math.PI / 180);
  ctx.drawImage(temp, 0, 0);
  ctx.restore();
}

/**
 * Flip canvas content horizontally.
 */
export function flipHorizontal(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return;

  const temp = document.createElement("canvas");
  temp.width = w;
  temp.height = h;
  const tctx = temp.getContext("2d");
  tctx.drawImage(canvas, 0, 0);

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(-1, 1);
  // clearRect is unnecessary here because drawImage fully covers the canvas after scaling.
  // Keep a clear step only if you intentionally preserve transparency without a full redraw.
  ctx.drawImage(temp, -w, 0);
  ctx.restore();
}

/**
 * Crop the canvas to the given rectangle (x,y,w,h).
 * Resizes canvas to the crop size and draws the selected region at (0,0).
 */
export function cropToRect(canvas, rect) {
  const { x, y, w, h } = normalizedRect(rect);
  if (w <= 0 || h <= 0) return;

  const temp = document.createElement("canvas");
  temp.width = w;
  temp.height = h;
  const tctx = temp.getContext("2d");
  tctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(temp, 0, 0);
}

/**
 * Ensure rect has positive width/height and is within integer pixel bounds.
 */
function normalizedRect(rect) {
  let { x, y, w, h } = rect;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  return { x, y, w, h };
}
