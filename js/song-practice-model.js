// Sviranje uz pesmu: udarci se porede sa stvarnim vremenima bubnja u snimku (AI analiza),
// bez mreže i fiksnog tempa, pa pesma snimljena bez klika ne "beži".

// AI razlikuje pet grupa, pa se i udarci porede po grupama: bilo koji tom za tomove, bilo koja činela za činele.
const FAMILY = { kick: 'kick', kick2: 'kick', snare: 'snare', rimshot: 'snare', xstick: 'snare', snare2: 'snare', xstick2: 'snare',
  tom1: 'toms', tom2: 'toms', tom3: 'toms', tom4: 'toms', floor2: 'toms', hh: 'hihat', hho: 'hihat', hhp: 'pedal',
  crash: 'cymbals', crash2: 'cymbals', crash3: 'cymbals', ride: 'cymbals', bell: 'cymbals' };
export const songFamily = inst => FAMILY[inst] || inst;
export const FAMILIES = [['kick', 'Bas bubanj'], ['snare', 'Doboš'], ['toms', 'Tomovi'], ['hihat', 'Hi-hat'], ['cymbals', 'Činele'], ['pedal', 'Hi-hat nogom']];

// Plavo = rano, ljubičasto = tačno, crveno = kasno. scale je odstupanje (ms) pri kome boja postaje puna.
const BLUE = [47, 111, 237], PURPLE = [142, 68, 173], RED = [217, 48, 37];
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
export function timingColor(err, scale = 40) {
  if (!Number.isFinite(err)) return 'rgb(154, 154, 154)';
  const k = Math.max(-1, Math.min(1, err / scale));
  const [r, g, b] = k < 0 ? mix(PURPLE, BLUE, -k) : mix(PURPLE, RED, k);
  return `rgb(${r}, ${g}, ${b})`;
}

export function prepareReference(events, { from = 0, to = Infinity } = {}) {
  return events.filter(e => Number.isFinite(e.timeSeconds) && e.timeSeconds >= from && e.timeSeconds <= to)
    .map((e, index) => ({ index, t: e.timeSeconds, inst: e.inst, family: songFamily(e.inst), matched: null }))
    .sort((a, b) => a.t - b.t);
}

// Uparuje udarac (vreme u sekundama pesme) sa najbližim neuparenim udarcem iste grupe u prozoru ±windowMs.
export function matchSongHit(reference, hit, { windowMs = 70, goodMs = 25 } = {}) {
  const family = songFamily(hit.inst), win = windowMs / 1000;
  let lo = 0, hi = reference.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (reference[mid].t < hit.t - win) lo = mid + 1; else hi = mid; }
  let best = null;
  for (let i = lo; i < reference.length && reference[i].t <= hit.t + win; i++) {
    const ref = reference[i];
    if (ref.matched || ref.family !== family) continue;
    if (!best || Math.abs(hit.t - ref.t) < Math.abs(hit.t - best.t)) best = ref;
  }
  if (!best) return { kind: 'extra', inst: hit.inst, t: hit.t, vel: hit.vel };
  const err = (hit.t - best.t) * 1000;
  best.matched = { err, inst: hit.inst };
  return { kind: Math.abs(err) <= goodMs ? 'good' : 'ok', inst: hit.inst, t: hit.t, vel: hit.vel, err, ref: best.index };
}

// Klizni prosek odstupanja za indikator uživo: noviji udarci imaju veću težinu.
export function smoothError(previous, err, weight = .25) { return previous == null ? err : previous + (err - previous) * weight; }

const mean = list => list.reduce((a, b) => a + b, 0) / (list.length || 1);
const spread = list => list.length > 1 ? Math.sqrt(mean(list.map(v => (v - mean(list)) ** 2))) : null;

// Izveštaj: ukupno, po grupama i kroz vreme (prozori od windowSeconds, ili po taktu kad je tempo poznat).
export function songReport(reference, hits, { durationSeconds, windowSeconds = 4, bpm = null, beats = 4, beatUnit = 4, offsetSeconds = 0 } = {}) {
  const matched = hits.filter(h => h.err != null), errs = matched.map(h => h.err);
  const good = hits.filter(h => h.kind === 'good').length, ok = hits.filter(h => h.kind === 'ok').length, extra = hits.filter(h => h.kind === 'extra').length;
  const expected = reference.length, missed = reference.filter(r => !r.matched).length;
  const families = FAMILIES.map(([id, label]) => {
    const refs = reference.filter(r => r.family === id), own = matched.filter(h => songFamily(h.inst) === id).map(h => h.err);
    return { id, label, expected: refs.length, hit: refs.filter(r => r.matched).length, mean: own.length ? mean(own) : null, spread: spread(own) };
  }).filter(f => f.expected);
  const barSeconds = bpm ? beats * 4 / beatUnit * 60 / bpm : null, size = barSeconds || windowSeconds;
  const start = barSeconds ? offsetSeconds : 0, count = Math.max(1, Math.ceil(((durationSeconds ?? (reference.at(-1)?.t || 0)) - start) / size));
  const windows = Array.from({ length: Math.min(count, 2000) }, (_, i) => {
    const from = start + i * size, to = from + size;
    const refs = reference.filter(r => r.t >= from && r.t < to), own = matched.filter(h => h.t >= from && h.t < to).map(h => h.err);
    return { index: i, from, to, bar: barSeconds ? i + 1 : null, expected: refs.length, missed: refs.filter(r => !r.matched).length, mean: own.length ? mean(own) : null, hits: own.length };
  });
  const weakest = windows.filter(w => w.expected >= 3)
    .map(w => ({ ...w, score: (w.mean == null ? 0 : Math.abs(w.mean)) + 25 * w.missed / w.expected }))
    .sort((a, b) => b.score - a.score).slice(0, 3).filter(w => w.score >= 12);
  return { expected, good, ok, missed, extra, accuracy: expected ? Math.round(100 * (good + .5 * ok) / expected) : null,
    mean: errs.length ? mean(errs) : null, spread: spread(errs), families, windows, weakest, barSeconds };
}
