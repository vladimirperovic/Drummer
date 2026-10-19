import { INSTRUMENTS } from './patterns.js';

const instruments = new Map(INSTRUMENTS.map(i => [i.target, i.id]).reverse());

// Strike on pointer-down for responsive playing. A struck part owns the gesture;
// in 3D, dragging the empty background still rotates the camera. Layout editing
// registers its capture handler first and takes precedence over playing.
export function bindKitPlay(surface, pick, callbacks = {}) {
  const down = e => {
    if (e.button !== 0 || callbacks.canPlay?.() === false) return;
    const id = instruments.get(pick(e)); if (!id || !callbacks.hit) return;
    e.preventDefault(); e.stopImmediatePropagation();
    callbacks.hit(id, e.shiftKey ? 122 : e.altKey ? 40 : 92, e.timeStamp);
  };
  surface.addEventListener('pointerdown', down, true);
  return { dispose() { surface.removeEventListener('pointerdown', down, true); } };
}

// Both the live raycaster and generated 2D picking image use the nearest visible
// mesh, including separate ride-bell, snare-rim and hi-hat-pedal articulations.
export function meshPad(mesh) {
  for (let node = mesh; node; node = node.parent) {
    if (node.userData.pad) return node.userData.pad;
    if (node.userData.part) return node.userData.part;
  }
  return null;
}
