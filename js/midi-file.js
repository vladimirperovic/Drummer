import { INSTRUMENTS, INST, blankPattern, slotsPerBeat, totalSlots } from './patterns.js';

// Standard MIDI File 0/1 with musical (PPQ) time. All reads are bounded by the
// owning chunk, including running status, metadata, SysEx and variable lengths.
export function parseMidiFile(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > 10 * 1024 * 1024) throw new Error('MIDI fajl je veći od 10 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0, end = bytes.length, eventCount = 0;
  const need = n => { if (pos + n > end) throw new Error('MIDI fajl je prekinut ili oštećen.'); };
  const u8 = () => { need(1); return bytes[pos++]; };
  const u16 = () => { need(2); const n = view.getUint16(pos); pos += 2; return n; };
  const u32 = () => { need(4); const n = view.getUint32(pos); pos += 4; return n; };
  const text = n => { need(n); const s = new TextDecoder().decode(bytes.subarray(pos, pos + n)); pos += n; return s; };
  const vlq = () => {
    let n = 0;
    for (let i = 0; i < 4; i++) { const b = u8(); n = n * 128 + (b & 127); if (b < 128) return n; }
    throw new Error('Neispravna MIDI promenljiva dužina.');
  };
  if (text(4) !== 'MThd') throw new Error('Fajl nije standardni MIDI (.mid).');
  const headerSize = u32();
  if (headerSize < 6) throw new Error('Neispravno MIDI zaglavlje.');
  need(headerSize);
  const format = u16(), count = u16(), ppq = u16(); pos += headerSize - 6;
  if (format > 1) throw new Error('Podržani su MIDI tipovi 0 i 1; tip 2 nije podržan.');
  if (!ppq || (ppq & 0x8000)) throw new Error('Potreban je MIDI sa PPQ vremenom; SMPTE nije podržan.');
  if (!count || count > 256 || (format === 0 && count !== 1)) throw new Error('Neispravan broj MIDI traka.');
  const notes = [], tempos = [], meters = [], tracks = [];
  while (tracks.length < count) {
    end = bytes.length;
    const tag = text(4), size = u32(); need(size);
    const chunkEnd = pos + size;
    if (tag !== 'MTrk') { pos = chunkEnd; continue; }
    end = chunkEnd;
    let tick = 0, running = 0, finished = false;
    const track = { index: tracks.length, name: `Traka ${tracks.length + 1}`, notes: 0 };
    while (pos < end) {
      if (++eventCount > 200000) throw new Error('MIDI ima previše događaja (najviše 200.000).');
      tick += vlq();
      let status = u8();
      if (status < 128) { if (!running) throw new Error('MIDI running status nedostaje.'); pos--; status = running; }
      if (status === 255) {
        running = 0;
        const type = u8(), length = vlq(); need(length); const start = pos;
        if (type === 3) track.name = text(length).slice(0, 100);
        else if (type === 81 && length === 3) {
          const microseconds = u8() * 65536 + u8() * 256 + u8();
          if (microseconds) tempos.push({ tick, microseconds });
        } else if (type === 88 && length >= 4) {
          const beats = u8(), power = u8();
          if (beats && power <= 7) meters.push({ tick, beats, beatUnit: 2 ** power });
        } else if (type === 47) finished = true;
        pos = start + length;
        if (finished) break;
      } else if (status === 240 || status === 247) { running = 0; const length = vlq(); need(length); pos += length; }
      else if (status >= 128 && status <= 239) {
        running = status;
        const kind = status & 240, first = u8(), second = kind === 192 || kind === 208 ? 0 : u8();
        if (first >= 128 || second >= 128) throw new Error('Neispravan MIDI podatak.');
        if (kind === 144 && second > 0) { notes.push({ tick, note: first, velocity: second, channel: (status & 15) + 1, track: track.index }); track.notes++; }
      } else throw new Error('Nepodržan MIDI status u fajlu.');
    }
    if (!finished) throw new Error('MIDI traka nema završni događaj.');
    tracks.push(track); pos = chunkEnd;
  }
  notes.sort((a, b) => a.tick - b.tick);
  tempos.sort((a, b) => a.tick - b.tick); meters.sort((a, b) => a.tick - b.tick);
  return { format, ppq, notes, tracks, tempos, meters };
}

export const fileDrumMap = () => ({ ...Object.fromEntries(INSTRUMENTS.flatMap(i => i.midiIn.map(n => [n, i.id]))), 35: 'kick', 41: 'tom3' });
export function metadataAt(file, quarter = 0) {
  const tick = quarter * file.ppq;
  const tempo = file.tempos.filter(e => e.tick <= tick).at(-1)?.microseconds || 500000;
  const meter = file.meters.filter(e => e.tick <= tick).at(-1) || { beats: 4, beatUnit: 4 };
  return { bpm: Math.round(60000000 / tempo), beats: meter.beats, beatUnit: meter.beatUnit };
}

export function midiToPattern(file, options = {}) {
  const start = Math.max(0, Number(options.startQuarter) || 0), meta = metadataAt(file, start);
  const beats = options.beats ?? meta.beats, beatUnit = options.beatUnit ?? meta.beatUnit;
  if (![4, 8].includes(beatUnit) || beats < 2 || beats > 7) throw new Error('Za uvoz izaberi meru od 2 do 7 doba, sa jedinicom /4 ili /8.');
  const p = blankPattern({ name: options.name || 'Uvezeni MIDI', bars: options.bars || 1, beats, beatUnit,
    bpm: meta.bpm, division: options.quantize === 'triplet' ? 12 : 16 });
  const end = start + p.bars * p.beats * 4 / p.beatUnit;
  if (file.meters.some(m => m.tick > start * file.ppq && m.tick < end * file.ppq))
    throw new Error('Izabrani deo menja meru. Skrati deo ili pomeri početak posle promene.');
  const map = options.map || fileDrumMap(), spq = slotsPerBeat(p) * p.beatUnit / 4;
  const step = options.quantize === 'eighth' ? spq / 2 : 1;
  let imported = 0, ignored = 0, collisions = 0;
  for (const n of file.notes) {
    const quarter = n.tick / file.ppq;
    if (quarter < start || quarter >= end || (options.channel && n.channel !== Number(options.channel)) || (options.track != null && options.track !== '' && n.track !== Number(options.track))) continue;
    const inst = map[n.note];
    if (!Object.hasOwn(INST, inst)) { ignored++; continue; }
    const slot = Math.min(totalSlots(p) - step, Math.round((quarter - start) * spq / step) * step);
    const dyn = n.velocity >= 108 ? 3 : n.velocity <= 45 ? 1 : 2;
    if (p.steps[inst][slot]) collisions++;
    p.steps[inst][slot] = Math.max(p.steps[inst][slot], dyn); imported++;
  }
  const tempoChanges = file.tempos.some(t => t.tick > start * file.ppq && t.tick < end * file.ppq);
  return { pattern: p, imported, ignored, collisions, tempoChanges, clampedTempo: p.bpm !== meta.bpm };
}
