import { INSTRUMENTS } from './patterns.js';

export const KIT_LIMITS = { racks: [0, 3], floors: [0, 2], snares: [1, 2], kicks: [1, 2], crashes: [0, 3], rides: [0, 1] };
export const DEFAULT_KIT = Object.freeze({ racks: 2, floors: 1, snares: 1, kicks: 1, crashes: 2, rides: 1, leftHanded: false });
export const KIT_PRESETS = {
  compact: { ...DEFAULT_KIT, racks: 1, crashes: 1 },
  standard: { ...DEFAULT_KIT },
  expanded: { ...DEFAULT_KIT, racks: 3, floors: 2, snares: 2, kicks: 2, crashes: 3 },
};
export const KIT_PART_IDS = ['kick', 'kick2', 'tom1', 'tom2', 'tom4', 'snare', 'snare2', 'tom3', 'floor2', 'hihat', 'crash', 'crash2', 'crash3', 'ride'];
export const KIT_MOVE_LIMIT = 3;
const offsetNumber = n => typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.max(-KIT_MOVE_LIMIT, Math.min(KIT_MOVE_LIMIT, n)) * 1000) / 1000 : 0;
export function normalizeKit(value) {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = { ...DEFAULT_KIT, leftHanded: v.leftHanded === true };
  for (const [key, [min, max]] of Object.entries(KIT_LIMITS)) {
    if (typeof v[key] === 'number' && Number.isFinite(v[key])) result[key] = Math.max(min, Math.min(max, Math.round(v[key])));
  }
  const offsets = {};
  if (v.offsets && typeof v.offsets === 'object' && !Array.isArray(v.offsets)) for (const id of KIT_PART_IDS) {
    if (!Object.hasOwn(v.offsets, id)) continue;
    const p = v.offsets[id];
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    const x = offsetNumber(p.x), z = offsetNumber(p.z);
    if (x || z) offsets[id] = { x, z };
  }
  if (Object.keys(offsets).length) result.offsets = offsets;
  return result;
}
// Offsets use the right-handed layout's coordinates; switching hands mirrors
// the whole arrangement, including custom positions and attached hardware.
export function moveKitPart(value, id, dx, dz) {
  const c = normalizeKit(value);
  if (!kitLayout(c).some(p => p.id === id) || !Number.isFinite(dx) || !Number.isFinite(dz)) return c;
  const before = c.offsets?.[id] || { x: 0, z: 0 };
  return normalizeKit({ ...c, offsets: { ...c.offsets, [id]: { x: before.x + dx * (c.leftHanded ? -1 : 1), z: before.z + dz } } });
}
export const isDefaultKit = value => JSON.stringify(normalizeKit(value)) === JSON.stringify(DEFAULT_KIT);
export function kitLayout(value) {
  const c = normalizeKit(value), parts = [];
  const add = (id, kind, x, y, z, radius, depth = 0, tilt = 0) => {
    x += c.offsets?.[id]?.x || 0; z += c.offsets?.[id]?.z || 0;
    parts.push({ id, kind, x: c.leftHanded ? -x : x, y, z, radius, depth, tilt: kind === 'cymbal' && c.leftHanded ? -tilt : tilt });
  };
  for (let n = 0; n < c.kicks; n++) add(n ? 'kick2' : 'kick', 'kick', c.kicks === 1 ? 0 : n ? .65 : -.65, .64, -.25, .61, .74, Math.PI / 2);
  const rackX = c.racks === 1 ? [-.35] : c.racks === 2 ? [-.48, .32] : [-.85, 0, .85];
  for (let n = 0; n < c.racks; n++) add(['tom1', 'tom2', 'tom4'][n], 'tom', rackX[n], 1.43 + n * .025, -.32 - n * .08, .32 + n * .035, .34 + n * .045, .18);
  for (let n = 0; n < c.snares; n++) add(n ? 'snare2' : 'snare', 'snare', n ? -2.2 : -.8, .94, n ? 1.15 : .62, n ? .35 : .4, .25, -.08);
  for (let n = 0; n < c.floors; n++) add(n ? 'floor2' : 'tom3', 'floor', n ? 1.95 : .99, n ? .79 : .87, n ? 1.4 : .48, n ? .48 : .44, n ? .58 : .53);
  add('hihat', 'cymbal', -1.48, 1.4, .64, .39, 0, -.03);
  const crashes = [[-1.32, 1.99, -.68, .51, -.12], [1.55, 1.77, .24, .46, .16], [-2.1, 1.85, -.1, .42, -.16]];
  for (let n = 0; n < c.crashes; n++) { const [x, y, z, r, tilt] = crashes[n]; add(['crash', 'crash2', 'crash3'][n], 'cymbal', x, y, z, r, 0, tilt); }
  if (c.rides) add('ride', 'cymbal', .85, 2.03, -.94, .53, 0, .12);
  return parts;
}
export function kitInstruments(value) {
  const targets = new Set(kitLayout(value).map(p => p.id));
  targets.add('hhpedal');
  if (targets.has('snare')) targets.add('rim');
  if (targets.has('snare2')) targets.add('rim2');
  if (targets.has('ride')) targets.add('bell');
  return INSTRUMENTS.filter(i => targets.has(i.target));
}
export const missingKitInstruments = (pattern, value) => {
  const active = new Set(kitInstruments(value).map(i => i.id));
  return INSTRUMENTS.filter(i => !active.has(i.id) && pattern.steps?.[i.id]?.some(Boolean));
};
