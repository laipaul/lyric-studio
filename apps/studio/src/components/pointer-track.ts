// Follows the mouse for a drag that starts on a pointerdown. The listeners are attached at once, inside the
// pointerdown handler (not after a React render), so a quick move or release is never missed, and the drag also
// ends on pointercancel and when the window loses focus (otherwise it could stay stuck). Returns the stop function.
export function trackPointer(onMove: (e: PointerEvent) => void, onEnd: (e: PointerEvent | null, cancelled: boolean) => void, cursor?: string): () => void {
  let done = false;
  const body = document.body;
  const prevSelect = body.style.userSelect;
  const prevCursor = body.style.cursor;
  body.style.userSelect = "none"; // no text selection while dragging
  if (cursor) body.style.cursor = cursor;
  const stop = () => {
    if (done) return false;
    done = true;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", blur);
    body.style.userSelect = prevSelect;
    body.style.cursor = prevCursor;
    return true;
  };
  const up = (e: PointerEvent) => {
    if (stop()) onEnd(e, false);
  };
  const cancel = (e: PointerEvent) => {
    if (stop()) onEnd(e, true);
  };
  const blur = () => {
    if (stop()) onEnd(null, true);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", blur);
  return () => void stop();
}
