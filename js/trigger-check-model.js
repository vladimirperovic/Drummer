// Provera trigera iz sirovih MIDI poruka: dinamika po zoni, dupli okidači, crosstalk i hi-hat pedala.
// Pravila i pragovi su isti kao u alati/analiza.py, samo rade uživo u browseru.
import { INST, INSTRUMENTS } from './patterns.js';

export const DOUBLE_MS = 30;      // isti pad ponovo u ovom roku, a znatno tiše -> verovatno dupli okidač
export const CROSSTALK_MS = 10;   // drugi pad u ovom roku, a vrlo tiho -> verovatno crosstalk
export const SEGMENT_GAP_MS = 1500;
export const MAX_EVENTS = 6000;

// Obod doboša i zvono ride-a su zone istog fizičkog pada.
const PHYSICAL = { rim: 'snare', rim2: 'snare2', bell: 'ride' };
export const PAD_LABELS = { kick: 'Kick', kick2: 'Kick 2', snare: 'Dobos', snare2: 'Dobos 2', tom1: 'Tom 1', tom2: 'Tom 2', tom4: 'Tom 3',
  tom3: 'Floor tom', floor2: 'Floor tom 2', hihat: 'Hi-hat', hhpedal: 'Hi-hat pedala', crash: 'Crash', crash2: 'Crash 2', crash3: 'Crash 3', ride: 'Ride' };
const PAD_ORDER = Object.keys(PAD_LABELS);
// Fabričke TD-17 note za ivice i obode, da se zone istog pada razlikuju u tabeli.
const ZONE = { 22: 'ivica', 26: 'ivica', 55: 'ivica', 52: 'ivica', 59: 'ivica', 50: 'obod', 47: 'obod', 58: 'obod' };

export const physicalPad = (inst, note) => INST[inst] ? PHYSICAL[INST[inst].target] || INST[inst].target : `note-${note}`;
export const padLabel = pad => PAD_LABELS[pad] || `Nota ${pad.replace('note-', '')}`;
export const zoneName = note => ZONE[note] || '';

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
export function velocitySummary(values) {
  const v = [...values].sort((a, b) => a - b);
  const hist = Array(8).fill(0);
  for (const x of v) hist[Math.min(7, Math.floor((x - 1) / 16))]++;
  return { count: v.length, min: v[0], p10: quantile(v, .1), median: quantile(v, .5), p90: quantile(v, .9), max: v.at(-1),
    saturated: v.filter(x => x >= 127).length / v.length, hist };
}
const padSort = (a, b) => (PAD_ORDER.indexOf(a) + 1 || 99) - (PAD_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b);

// hits: [{ t (ms), note, vel, inst }], pedal: [{ t, value }] (CC4)
export function analyzeTriggers(hits, pedal = []) {
  hits = hits.filter(h => Number.isFinite(h.t) && h.vel > 0).map(h => ({ ...h, pad: physicalPad(h.inst, h.note) })).sort((a, b) => a.t - b.t);
  const result = { hits: hits.length, durationMs: hits.length ? hits.at(-1).t - hits[0].t : 0, zones: [], pads: [], doubles: [], crosstalk: [], segments: [], hihat: null, unmapped: [], advice: [] };
  if (!hits.length && !pedal.length) return result;

  const byZone = new Map(), byPad = new Map();
  for (const h of hits) {
    const zone = byZone.get(h.note) || { note: h.note, inst: h.inst || null, pad: h.pad, vels: [] };
    zone.vels.push(h.vel); byZone.set(h.note, zone);
    (byPad.get(h.pad) || byPad.set(h.pad, []).get(h.pad)).push(h.vel);
  }
  result.zones = [...byZone.values()].map(({ vels, ...zone }) => ({ ...zone, ...velocitySummary(vels) }))
    .sort((a, b) => padSort(a.pad, b.pad) || b.count - a.count);
  result.pads = [...byPad].map(([pad, vels]) => ({ pad, ...velocitySummary(vels) })).sort((a, b) => padSort(a.pad, b.pad));
  result.unmapped = result.zones.filter(z => !z.inst).map(z => ({ note: z.note, count: z.count }));

  // Dupli okidač: isti pad brzo ponovo i znatno tiše. Hi-hat pedala ("chick") se ne računa.
  const last = new Map(), doubles = new Map(), doubleHits = new Set();
  for (const h of hits) {
    if (h.pad === 'hhpedal') continue;
    const prev = last.get(h.pad);
    if (prev && h.t - prev.t < DOUBLE_MS && h.vel < .6 * prev.vel) {
      (doubles.get(h.pad) || doubles.set(h.pad, []).get(h.pad)).push({ dt: h.t - prev.t, first: prev.vel, second: h.vel });
      doubleHits.add(h);
    }
    last.set(h.pad, h);
  }
  result.doubles = [...doubles].map(([pad, items]) => ({ pad, count: items.length, examples: items.slice(0, 5) })).sort((a, b) => b.count - a.count);

  // Crosstalk: vrlo tih udarac na drugom padu skoro istovremeno sa jakim udarcem.
  const cross = new Map(), crossHits = new Set();
  hits.forEach((h, i) => {
    if (h.vel >= 25 || doubleHits.has(h)) return;
    let source = null;
    for (let j = Math.max(0, i - 8); j < Math.min(hits.length, i + 9); j++) {
      const other = hits[j];
      if (other.pad !== h.pad && Math.abs(other.t - h.t) <= CROSSTALK_MS && (!source || other.vel > source.vel)) source = other;
    }
    if (!source || source.vel < 60 || h.vel >= .3 * source.vel) return;
    const key = `${source.pad}>${h.pad}`;
    (cross.get(key) || cross.set(key, { source: source.pad, victim: h.pad, items: [] }).get(key)).items.push({ source: source.vel, victim: h.vel });
    crossHits.add(h);
  });
  result.crosstalk = [...cross.values()].map(({ items, ...pair }) => ({ ...pair, count: items.length, examples: items.slice(0, 5) })).sort((a, b) => b.count - a.count);

  // Serije odvojene pauzom, za test "8 tiho / 8 srednje / 8 jako" na jednom padu.
  let segment = [];
  const closeSegment = () => {
    if (!segment.length) return;
    const counts = new Map(); for (const h of segment) counts.set(h.pad, (counts.get(h.pad) || 0) + 1);
    const pad = [...counts].sort((a, b) => b[1] - a[1])[0][0], own = segment.filter(h => h.pad === pad);
    const gaps = own.slice(1).map((h, i) => h.t - own[i].t), mean = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1);
    const spread = gaps.length >= 3 && mean > 0 ? Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length) / mean : null;
    result.segments.push({ startMs: segment[0].t - hits[0].t, pad, others: segment.length - own.length, evenness: spread == null ? null : Math.round(100 * spread), ...velocitySummary(own.map(h => h.vel)) });
    segment = [];
  };
  for (const h of hits) { if (segment.length && h.t - segment.at(-1).t > SEGMENT_GAP_MS) closeSegment(); segment.push(h); }
  closeSegment();

  const hihatHits = hits.filter(h => h.pad === 'hihat');
  if (pedal.length || hihatHits.length) {
    const values = pedal.map(e => e.value);
    result.hihat = { messages: values.length, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null,
      distinct: new Set(values).size, closed: hihatHits.filter(h => h.inst === 'hh').length, open: hihatHits.filter(h => h.inst === 'hho').length,
      chick: hits.filter(h => h.pad === 'hhpedal').length };
  }

  const faint = new Map();
  for (const h of hits) if (h.vel <= 8 && !doubleHits.has(h) && !crossHits.has(h) && h.pad !== 'hhpedal') faint.set(h.pad, (faint.get(h.pad) || 0) + 1);
  result.advice = advise(result, faint);
  return result;
}

// Preporuke za podešavanje trigera na modulu (TD-17 trigger parametri). Tekst pravi prikaz, na izabranom jeziku.
function advise(r, faint) {
  const tips = [];
  for (const d of r.doubles) if (d.count >= 2) tips.push({ level: 'warn', kind: 'double', pad: d.pad, count: d.count, ms: Math.round(d.examples[0].dt) });
  for (const c of r.crosstalk) if (c.count >= 2) tips.push({ level: 'warn', kind: 'crosstalk', pad: c.victim, source: c.source, count: c.count });
  for (const z of r.zones) if (z.inst && z.count >= 6 && z.saturated > .15) tips.push({ level: 'warn', kind: 'hot', pad: z.pad, zone: z, percent: Math.round(100 * z.saturated) });
  for (const p of r.pads) if (p.count >= 8 && p.max < 90 && p.pad !== 'hhpedal') tips.push({ level: 'info', kind: 'weak', pad: p.pad, max: p.max });
  for (const [pad, count] of faint) if (count >= 3) tips.push({ level: 'info', kind: 'faint', pad, count });
  if (r.hihat?.messages >= 10 && r.hihat.max - r.hihat.min < 100) tips.push({ level: 'warn', kind: 'pedalRange', pad: 'hihat', min: r.hihat.min, max: r.hihat.max });
  else if (r.hihat && !r.hihat.messages && r.hihat.closed + r.hihat.open >= 4) tips.push({ level: 'info', kind: 'pedalMissing', pad: 'hihat' });
  for (const u of r.unmapped) tips.push({ level: 'info', kind: 'unmapped', pad: `note-${u.note}`, note: u.note, count: u.count });
  if (!tips.some(t => t.level === 'warn') && r.hits >= 30) tips.push({ level: 'ok', kind: 'clean', pad: null });
  return tips;
}

// Isti format kao alati/midirec (JSON po redu, vreme u sekundama), da snimak može i u analiza.py.
export function toJsonLines(hits, pedal) {
  const start = Math.min(hits[0]?.t ?? Infinity, pedal[0]?.t ?? Infinity);
  const rows = [...hits.map(h => ({ type: 'on', t: (h.t - start) / 1000, note: h.note, vel: h.vel, ch: h.channel || 10 })),
    ...pedal.map(e => ({ type: 'cc', t: (e.t - start) / 1000, cc: 4, val: e.value }))].sort((a, b) => a.t - b.t);
  return rows.map(row => JSON.stringify({ ...row, t: Math.round(row.t * 1e6) / 1e6 })).join('\n') + '\n';
}

export const instrumentsForPad = pad => INSTRUMENTS.filter(i => physicalPad(i.id) === pad);
