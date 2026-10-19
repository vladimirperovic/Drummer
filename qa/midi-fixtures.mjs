export const vlq = value => { const out = [value & 127]; while ((value = Math.floor(value / 128))) out.unshift((value & 127) | 128); return out; };
export const track = events => { const data = events.flat(); return [...Buffer.from('MTrk'), ...u32(data.length), ...data]; };
const u32 = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
export const smf = (tracks, { format = tracks.length > 1 ? 1 : 0, ppq = 480 } = {}) => new Uint8Array([
  ...Buffer.from('MThd'), 0, 0, 0, 6, 0, format, tracks.length >> 8, tracks.length & 255, ppq >> 8, ppq & 255, ...tracks.flat()]);
export const end = [0, 255, 47, 0];
export const fixture = () => smf([
  track([[0, 255, 81, 3, 7, 161, 32], [0, 255, 88, 4, 6, 3, 24, 8], [0, 255, 3, 9, ...Buffer.from('Conductor')], end]),
  track([[0, 255, 3, 5, ...Buffer.from('Drums')], [0, 153, 36, 122], [...vlq(240), 38, 40], [...vlq(240), 42, 90], [...vlq(240), 52, 127], [...vlq(240), 60, 90], [0, 38, 0], end]),
  track([[0, 144, 60, 100], [...vlq(480), 64, 80], end]),
]);
