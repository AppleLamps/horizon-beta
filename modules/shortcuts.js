/**
 * shortcuts.js
 * Extracted keyboard shortcuts initialization from app.js.
 * Accepts dependencies so it stays decoupled from app state.
 */

export function initShortcuts({
  undo,
  redo,
  drawImageData,
  onHistoryChange,
  announce,
  showToast
}) {
  window.addEventListener("keydown", (e) => {
    // Ignore shortcuts while typing in inputs/textareas/contenteditable
    const tag = (e.target && e.target.tagName) || "";
    const isEditable = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
    if (isEditable) return;

    const key = (e.key || "").toLowerCase();

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === "z") {
      e.preventDefault();
      const data = undo && undo();
      if (data && typeof drawImageData === "function") drawImageData(data);
      onHistoryChange && onHistoryChange();
      announce && announce("Undid last action");
      showToast && showToast("Undo", "Reverted to previous state.");
    } else if ((e.ctrlKey || e.metaKey) && (key === "y" || (e.shiftKey && key === "z"))) {
      e.preventDefault();
      const data = redo && redo();
      if (data && typeof drawImageData === "function") drawImageData(data);
      onHistoryChange && onHistoryChange();
      announce && announce("Redid action");
      showToast && showToast("Redo", "Reapplied last change.");
    } else if (key === "escape") {
      // ESC may be handled elsewhere (e.g., crop overlay). No-op here.
    }
  });
}
