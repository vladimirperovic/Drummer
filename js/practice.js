// Model vežbanja: opseg, dnevnik, programi i standardni MIDI izvoz.
import { INSTRUMENTS, INST, normalize, slotsPerBar } from './patterns.js';

export const bounded = (value, low, high, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : fallback;
};
export const padKey = id => id === 'hho' ? 'hh' : id;

export function normalizeFocus(pattern, value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const from = Math.round(bounded(value.from, 1, pattern.bars, 1));
  return {
    enabled: value.enabled === true,
    from,
    to: Math.round(bounded(value.to, from, pattern.bars, pattern.bars)),
    instruments: Array.isArray(value.instruments)
      ? [...new Set(value.instruments.filter(id => typeof id === 'string' && Object.hasOwn(INST, id)))]
      : INSTRUMENTS.map(i => i.id),
  };
}

export function practiceRange(pattern, value) {
  const focus = normalizeFocus(pattern, value), spBar = slotsPerBar(pattern);
  const from = focus.enabled ? focus.from : 1, to = focus.enabled ? focus.to : pattern.bars;
  return {
    start: (from - 1) * spBar, end: to * spBar, length: (to - from + 1) * spBar, from, to,
    instruments: focus.enabled ? focus.instruments : INSTRUMENTS.map(i => i.id),
  };
}

export const acceptsInstrument = (range, inst) => range.instruments.some(id => padKey(id) === padKey(inst));

export function patternSignature(pattern) {
  const p = normalize(pattern);
  const tracks = INSTRUMENTS.filter(i => !i.optional).map(i => p.steps[i.id]);
  const extra = INSTRUMENTS.filter(i => i.optional && p.steps[i.id].some(Boolean)).map(i => [i.id, p.steps[i.id]]);
  const text = JSON.stringify([p.bars, p.beats, p.beatUnit, p.division, p.swing, p.groups, extra.length ? [...tracks, ...extra] : tracks]);
  let hash = 2166136261;
  for (const ch of text) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

export function sessionKey(session) {
  const range = session.range || practiceRange(session.pattern);
  return [patternSignature(session.pattern), range.from, range.to,
    [...new Set(range.instruments.filter(id => !INST[id]?.optional || session.pattern.steps?.[id]?.some(Boolean)).map(padKey))].sort().join(','), session.level || 'normalno'].join('/');
}

export function compactStats(stats) {
  const per = {};
  for (const [id, s] of Object.entries(stats.per)) {
    per[id] = { good: s.good, ok: s.ok, miss: s.miss, extra: s.extra, expected: s.expected,
      mean: s.mean, spread: s.spread, dynamics: s.errs.length ? Math.round(100 * s.dynOk / s.errs.length) : null };
  }
  return { accuracy: stats.accuracy, all: { ...stats.all }, expected: stats.expected, per };
}

export function normalizeSession(value) {
  if (!value || typeof value.id !== 'string' || !value.pattern?.steps || !Array.isArray(value.hits)) return null;
  const pattern = normalize(value.pattern);
  const validEvent = e => e && Object.hasOwn(INST, e.inst) && Number.isFinite(e.timeMs) && e.timeMs >= 0;
  const integer = (n, max = 10000000) => Math.round(bounded(n, 0, max, 0));
  const nullableNumber = n => Number.isFinite(n) ? n : null;
  const position = e => ({ slot: integer(e.slot, pattern.bars * slotsPerBar(pattern) - 1), loop: integer(e.loop) });
  const kind = value => ['good', 'ok', 'miss', 'extra', 'free'].includes(value) ? value : 'free';
  const counts = s => Object.fromEntries(['good', 'ok', 'miss', 'extra', 'expected'].map(k => [k, integer(s?.[k])]));
  const accuracy = n => Number.isFinite(n) ? bounded(n, 0, 100, 0) : null;
  const stats = { accuracy: accuracy(value.stats?.accuracy), expected: integer(value.stats?.expected),
    all: counts(value.stats?.all), per: {} };
  for (const [id, s] of Object.entries(value.stats?.per || {})) {
    if (!Object.hasOwn(INST, id) || !s || typeof s !== 'object') continue;
    stats.per[id] = { ...counts(s), mean: nullableNumber(s.mean), spread: nullableNumber(s.spread), dynamics: accuracy(s.dynamics) };
  }
  const hits = value.hits.filter(validEvent).map(e => ({ ...e,
    ...position(e), kind: kind(e.kind), err: nullableNumber(e.err),
    vel: Math.round(bounded(e.vel, 1, 127, 92)), note: Math.round(bounded(e.note, 0, 127, INST[e.inst].midiOut)) }));
  return { ...value, pattern, hits, stats,
    bpmStart: Math.round(bounded(value.bpmStart, 30, 260, pattern.bpm)),
    bpmEnd: Math.round(bounded(value.bpmEnd, 30, 260, pattern.bpm)),
    level: ['strogo', 'normalno', 'lagano'].includes(value.level) ? value.level : 'normalno',
    expected: (Array.isArray(value.expected) ? value.expected : []).filter(validEvent).map(e => ({ ...e, ...position(e), dyn: Math.round(bounded(e.dyn, 1, 3, 2)) })),
    timeline: (Array.isArray(value.timeline) ? value.timeline : []).filter(e => e && Number.isFinite(e.timeMs) && e.timeMs >= 0).map(e => ({ ...e, ...position(e), bpm: Math.round(bounded(e.bpm, 30, 260, pattern.bpm)) })),
    results: (Array.isArray(value.results) ? value.results : []).filter(e => e && Object.hasOwn(INST, e.inst)).map(e => ({ ...e, ...position(e), kind: kind(e.kind), err: nullableNumber(e.err) })),
    passes: (Array.isArray(value.passes) ? value.passes : []).filter(e => Number.isFinite(e?.score) && Number.isFinite(e?.bpm)).map(e => ({ loop: integer(e.loop), score: bounded(e.score, 0, 100, 0), bpm: bounded(e.bpm, 30, 260, pattern.bpm) })),
    range: practiceRange(pattern, { enabled: true, from: value.range?.from, to: value.range?.to, instruments: value.range?.instruments }),
    durationMs: hits.reduce((max, h) => Math.max(max, h.timeMs), bounded(value.durationMs, 0, 86400000, 0)),
    startedAt: Number.isFinite(Date.parse(value.startedAt)) ? value.startedAt : new Date(0).toISOString(),
  };
}

export function progressFor(sessions, selected) {
  const key = selected && sessionKey(selected);
  const matching = sessions.filter(s => !key || sessionKey(s) === key).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const daily = new Map();
  let bestBpm = null;
  for (const s of matching) {
    const d = new Date(s.startedAt);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const bin = daily.get(day) || { day, minutes: 0, count: 0, sum: 0, scored: 0 };
    bin.minutes += s.durationMs / 60000; bin.count++;
    if (s.stats?.accuracy != null) { bin.sum += s.stats.accuracy; bin.scored++; }
    daily.set(day, bin);
    for (const pass of s.passes || []) if (pass.score >= 90) bestBpm = Math.max(bestBpm || 0, pass.bpm);
  }
  return { matching, bestBpm, daily: [...daily.values()].map(d => ({ ...d, accuracy: d.scored ? Math.round(d.sum / d.scored) : null })) };
}

export function recommendFocus(session) {
  if (!session) return null;
  const scores = new Map(), spBar = slotsPerBar(session.pattern);
  for (const result of session.results || []) {
    const weight = result.kind === 'miss' ? 3 : result.kind === 'ok' || result.kind === 'extra' ? 1 : 0;
    if (!weight || !Number.isFinite(result.slot)) continue;
    const bar = Math.floor(result.slot / spBar) + 1, key = `${bar}/${result.inst}`;
    const entry = scores.get(key) || { bar, inst: result.inst, weight: 0 };
    entry.weight += weight; scores.set(key, entry);
  }
  const worst = [...scores.values()].sort((a, b) => b.weight - a.weight)[0];
  return worst ? { ...worst, bpm: Math.max(30, (session.bpmStart || session.pattern.bpm) - 10) } : null;
}

export function normalizeProgram(value) {
  const name = typeof value?.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 100) : 'Moj program';
  return { id: typeof value?.id === 'string' ? value.id : null, name,
    entries: (Array.isArray(value?.entries) ? value.entries : []).filter(e => e?.pattern?.steps).map(e => {
      const pattern = normalize(e.pattern);
      return { pattern, focus: normalizeFocus(pattern, e.focus),
        bpm: Math.round(bounded(e.bpm, 30, 260, pattern.bpm)),
        seconds: Math.round(bounded(e.seconds, 1, 3600, 60)),
        rest: Math.round(bounded(e.rest, 0, 600, 5)), target: Math.round(bounded(e.target, 0, 100, 90)) };
    }) };
}

// 1000 PPQ uz tempo 1.000.000 μs: jedan MIDI tick = jedna milisekunda.
// Izvoz koristi originalne note i jačinu, bez kvantizacije ili promene tempa.
export function performanceMidi(session) {
  const events = [];
  for (const hit of session.hits) {
    if (!INST[hit.inst] || !Number.isFinite(hit.timeMs) || hit.timeMs < 0) continue;
    const note = Math.round(bounded(hit.note, 0, 127, INST[hit.inst].midiOut));
    const vel = Math.round(bounded(hit.vel, 1, 127, 92)), tick = Math.round(hit.timeMs);
    events.push({ tick, bytes: [0x99, note, vel], off: false }, { tick: tick + 80, bytes: [0x89, note, 0], off: true });
  }
  events.sort((a, b) => a.tick - b.tick || Number(b.off) - Number(a.off));
  const vlq = n => { const bytes = [n & 127]; while ((n = Math.floor(n / 128)) > 0) bytes.unshift((n & 127) | 128); return bytes; };
  const track = [0, 0xff, 0x51, 3, 0x0f, 0x42, 0x40];
  let previous = 0;
  for (const event of events) { track.push(...vlq(event.tick - previous), ...event.bytes); previous = event.tick; }
  track.push(...vlq(Math.max(0, Math.round(session.durationMs || 0) - previous)), 0xff, 0x2f, 0);
  const size = track.length;
  return new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 3, 232,
    77, 84, 114, 107, (size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...track]);
}
