// Shared pointer lifecycle. Renderers provide picking and screen-to-floor
// projection; the owner handles a reversible preview and one save on release.
export function bindKitDrag(surface, projection, callbacks = {}) {
  let editing = false, drag = null;
  function finish(commit) {
    if (!drag) return;
    const previous = drag; drag = null;
    surface.classList.remove('kit-dragging');
    if (surface.hasPointerCapture(previous.pointerId)) surface.releasePointerCapture(previous.pointerId);
    if (commit && previous.moved) callbacks.commit?.(); else callbacks.cancel?.();
  }
  const down = e => {
    if (!editing || drag || e.button !== 0 || !e.isPrimary) return;
    const hit = projection.pick(e); if (!hit || callbacks.start?.(hit.id) === false) return;
    e.preventDefault(); e.stopImmediatePropagation();
    drag = { hit, pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, moved: false };
    surface.setPointerCapture(e.pointerId); surface.classList.add('kit-dragging');
  };
  const move = e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!drag.moved && Math.hypot(e.clientX - drag.clientX, e.clientY - drag.clientY) < 3) return;
    const delta = projection.delta(e, drag.hit); if (!delta) return;
    drag.moved = true; callbacks.preview?.(drag.hit.id, delta.x, delta.z);
  };
  const up = e => { if (drag && e.pointerId === drag.pointerId) { move(e); finish(true); } };
  const cancel = e => { if (drag && (e.pointerId == null || e.pointerId === drag.pointerId)) finish(false); };
  const key = e => { if (drag && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(false); } };
  const blur = () => finish(false);
  surface.addEventListener('pointerdown', down, true); surface.addEventListener('pointermove', move, true);
  surface.addEventListener('pointerup', up, true); surface.addEventListener('pointercancel', cancel);
  surface.addEventListener('lostpointercapture', cancel); document.addEventListener('keydown', key, true);
  window.addEventListener('blur', blur);
  return {
    setEditing(value) { if (!value) finish(false); editing = !!value; surface.classList.toggle('kit-layout-editing', editing); },
    cancel: () => finish(false),
    dispose() {
      finish(false); surface.removeEventListener('pointerdown', down, true); surface.removeEventListener('pointermove', move, true);
      surface.removeEventListener('pointerup', up, true); surface.removeEventListener('pointercancel', cancel);
      surface.removeEventListener('lostpointercapture', cancel); document.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur);
    },
  };
}
