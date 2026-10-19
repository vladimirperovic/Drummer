import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, INSTRUMENTS, blankPattern } from '../js/patterns.js';
import { normalizeFocus, practiceRange, acceptsInstrument, patternSignature, sessionKey,
  normalizeSession, progressFor, recommendFocus, normalizeProgram, performanceMidi } from '../js/practice.js';
import { BackingTrack } from '../js/backing.js';
import { ReplayPlayer } from '../js/replay.js';
import * as store from '../js/storage.js';

const pattern = blankPattern({ bars: 4, bpm: 120 });
const session = (over = {}) => ({ id: 's1', pattern: structuredClone(PRESETS[0]), startedAt: '2026-10-19T10:00:00Z',
  durationMs: 30000, level: 'normalno', hits: [], expected: [], timeline: [], results: [], passes: [],
  range: practiceRange(PRESETS[0]), stats: { accuracy: 90 }, ...over });

test('A-B range is inclusive in bars and maps to original slots', () => {
  const r = practiceRange(pattern, { enabled: true, from: 2, to: 3, instruments: ['snare'] });
  assert.deepEqual([r.start, r.end, r.length], [16, 48, 32]); assert.deepEqual(r.instruments, ['snare']);
});
test('disabled focus evaluates whole pattern and all instruments', () => {
  const r = practiceRange(pattern, { enabled: false, from: 2, to: 3, instruments: [] });
  assert.equal(r.length, 64); assert.equal(r.instruments.length, INSTRUMENTS.length);
});
test('focus validates reversed range and unknown instrument IDs', () => {
  const r = practiceRange(pattern, { enabled: true, from: 99, to: 1, instruments: ['snare', 'snare', 'bad', 'toString'] });
  assert.deepEqual([r.from, r.to, r.length], [4, 4, 16]); assert.deepEqual(r.instruments, ['snare']);
  assert.doesNotThrow(() => normalizeFocus(pattern, null));
});
test('an empty explicit instrument selection stays empty for UI validation', () => {
  assert.deepEqual(practiceRange(pattern, { enabled: true, instruments: [] }).instruments, []);
});
test('hi-hat articulations share a focus pad; other instruments are excluded', () => {
  const range = practiceRange(pattern, { enabled: true, instruments: ['hh'] });
  assert.equal(acceptsInstrument(range, 'hho'), true); assert.equal(acceptsInstrument(range, 'snare'), false);
});
test('triplet A-B ranges retain correct original slot positions', () => {
  const r = practiceRange({ ...pattern, division: 12 }, { enabled: true, from: 2, to: 3 });
  assert.deepEqual([r.start, r.end, r.length], [12, 36, 24]);
});
test('exercise signature ignores tempo/name and changes when notes change', () => {
  const original = structuredClone(PRESETS[0]), other = { ...original, bpm: 120, name: 'Rename' };
  assert.equal(patternSignature(original), patternSignature(other));
  other.steps = structuredClone(original.steps); other.steps.snare[0] = 3;
  assert.notEqual(patternSignature(original), patternSignature(other));
});
test('progress separates instrument selection, meter range and strictness', () => {
  const a = session(), b = session({ level: 'strogo' }); assert.notEqual(sessionKey(a), sessionKey(b));
  b.level = a.level; b.range = practiceRange(a.pattern, { enabled: true, instruments: ['snare'] });
  assert.notEqual(sessionKey(a), sessionKey(b));
});
test('daily history aggregates minutes and accuracy; best BPM requires >=90% full pass', () => {
  const a = session({ passes: [{ score: 90, bpm: 100 }] });
  const b = session({ id: 's2', durationMs: 90000, stats: { accuracy: 70 }, passes: [{ score: 89, bpm: 150 }] });
  const c = session({ id: 's3', level: 'strogo', passes: [{ score: 100, bpm: 200 }] });
  const result = progressFor([a, b, c], a);
  assert.equal(result.matching.length, 2); assert.equal(result.bestBpm, 100);
  assert.equal(result.daily[0].minutes, 2); assert.equal(result.daily[0].accuracy, 80);
});
test('unscored sessions do not falsely count as zero accuracy', () => {
  const result = progressFor([session({ stats: { accuracy: null } })]);
  assert.equal(result.daily[0].accuracy, null); assert.equal(result.bestBpm, null);
});
test('focus recommendation finds a weak bar/instrument and slows tempo', () => {
  const s = session({ pattern, bpmStart: 90, results: [{ kind: 'miss', inst: 'snare', slot: 20 }, { kind: 'ok', inst: 'kick', slot: 0 }] });
  assert.deepEqual(recommendFocus(s), { bar: 2, inst: 'snare', weight: 3, bpm: 80 });
  assert.equal(recommendFocus(session()), null);
});
test('session load validates events and preserves sub-millisecond original timing', () => {
  const s = normalizeSession(session({ hits: [{ inst: 'snare', timeMs: 123.456, note: 40, vel: 73 }, { inst: 'bad', timeMs: 1 }, { inst: 'kick', timeMs: NaN }] }));
  assert.equal(s.hits.length, 1); assert.equal(s.hits[0].timeMs, 123.456); assert.equal(s.hits[0].note, 40);
  assert.equal(normalizeSession({}), null);
});

test('corrupt journal values cannot break replay or turn statistics into HTML', () => {
  const s = normalizeSession(session({ bpmStart: '<img>', bpmEnd: {}, level: {},
    hits: [{ inst: 'snare', timeMs: 123.456, err: 'bad', loop: '<img>', vel: 999 }],
    timeline: [{ timeMs: 0, loop: '<img>' }],
    stats: { accuracy: '<img>', per: { snare: null, kick: { mean: {}, dynamics: 900 } } } }));
  assert.equal(s.hits[0].err, null); assert.equal(s.hits[0].timeMs, 123.456); assert.equal(s.hits[0].vel, 127);
  assert.equal(s.bpmStart, s.pattern.bpm); assert.equal(s.timeline[0].loop, 0);
  assert.equal(s.stats.accuracy, null); assert.equal(s.stats.per.kick.dynamics, 100);
  assert.equal(s.stats.per.kick.mean, null); assert.equal(s.level, 'normalno');
});
test('program saves snapshots and bounds every duration, tempo, rest and target', () => {
  const p = normalizeProgram({ name: ' Test ', entries: [{ pattern, seconds: -3, bpm: 999, target: 300, rest: 1000, focus: null }] });
  assert.equal(p.name, 'Test'); assert.deepEqual([p.entries[0].seconds, p.entries[0].bpm, p.entries[0].target, p.entries[0].rest], [1, 260, 100, 600]);
  p.entries[0].pattern.steps.snare[0] = 3; assert.equal(pattern.steps.snare[0], 0);
});
test('invalid program entries are dropped without crashing startup', () => {
  assert.equal(normalizeProgram({ entries: [null, {}, { pattern: null }] }).entries.length, 0);
});
test('storage failures return false and notify without replacing earlier data', () => {
  let error; const memory = new Map(); globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
  store.setErrorHandler(e => error = e); assert.equal(store.saveSessions([session()]), true);
  globalThis.localStorage.setItem = () => { throw new Error('quota'); };
  assert.equal(store.saveSessions([]), false); assert.equal(store.loadSessions().length, 1); assert.equal(error.message, 'quota');
});

function parseMidi(bytes) {
  assert.equal(Buffer.from(bytes.slice(0, 4)).toString(), 'MThd'); assert.equal(bytes[13], 232);
  const trackSize = new DataView(bytes.buffer, bytes.byteOffset).getUint32(18);
  assert.equal(trackSize, bytes.length - 22);
  let index = 22, ticks = 0; const events = [];
  const variable = () => { let value = 0, b; do { b = bytes[index++]; value = value * 128 + (b & 127); } while (b & 128); return value; };
  while (index < bytes.length) {
    ticks += variable(); const status = bytes[index++];
    if (status === 255) { const type = bytes[index++], len = variable(); const data = [...bytes.slice(index, index + len)]; index += len; events.push({ ticks, status, type, data }); }
    else events.push({ ticks, status, note: bytes[index++], velocity: bytes[index++] });
  }
  return events;
}
test('MIDI export is a valid type-0 track with 1ms timing and original MIDI notes', () => {
  const events = parseMidi(performanceMidi(session({ hits: [{ inst: 'snare', note: 40, vel: 63, timeMs: 123.4 }, { inst: 'crash2', note: 52, vel: 121, timeMs: 456.7 }] })));
  assert.deepEqual(events[0].data, [15, 66, 64]);
  assert.deepEqual(events.filter(e => e.status === 153).map(e => [e.ticks, e.note, e.velocity]), [[123, 40, 63], [457, 52, 121]]);
  assert.equal(events.at(-1).type, 47); assert.equal(events.at(-1).ticks, 30000);
});
test('MIDI export preserves long rests and simultaneous strikes', () => {
  const events = parseMidi(performanceMidi(session({ durationMs: 100000, hits: [
    { inst: 'kick', note: 36, vel: 92, timeMs: 90000 }, { inst: 'snare', note: 38, vel: 92, timeMs: 90000 }] })));
  assert.deepEqual(events.filter(e => e.status === 153).map(e => e.ticks), [90000, 90000]);
});
test('empty MIDI performance still has valid tempo and end-of-track', () => {
  const events = parseMidi(performanceMidi(session())); assert.equal(events.length, 2);
});
test('backing maps A-B bars and slowdown onto source-file time', () => {
  const backing = new BackingTrack({}); backing.bpm = 120; backing.offset = .5;
  const p = { ...pattern, bpm: 60 }, range = practiceRange(p, { enabled: true, from: 2, to: 3 });
  assert.deepEqual(backing.segment(p, range), { offset: 2.5, duration: 4, rate: .5 });
});
test('backing refuses a segment beyond the file duration', () => {
  const backing = new BackingTrack({}); backing.enabled = true; backing.bpm = 120; backing.buffer = { duration: 1 };
  assert.throws(() => backing.validate(pattern, practiceRange(pattern)), /izlaze/);
  backing.enabled = false; assert.doesNotThrow(() => backing.validate(pattern, practiceRange(pattern)));
});

test('pending backing load blocks playback and removing it cancels the stale decode', async () => {
  let release;
  const backing = new BackingTrack({ ensure: async () => {}, ctx: { decodeAudioData: () => new Promise(resolve => release = resolve) } });
  const pending = backing.load({ name: 'song.wav', arrayBuffer: async () => new ArrayBuffer(1) });
  assert.throws(() => backing.validate(pattern, practiceRange(pattern)), /učita/);
  await new Promise(resolve => setImmediate(resolve)); backing.clear(); release({ duration: 10 });
  assert.equal(await pending, false); assert.equal(backing.buffer, null); assert.equal(backing.loading, false);
});
test('backing schedules a source at exactly the rhythm audio timestamp', () => {
  const calls = []; const source = { playbackRate: {}, connect() { return { connect() {} }; }, start: (...args) => calls.push(args) };
  const backing = new BackingTrack({ ctx: { destination: {}, createBufferSource: () => source, createGain: () => ({ gain: {} }) } });
  backing.buffer = { duration: 30 }; backing.enabled = true; backing.bpm = 120;
  backing.schedule(7.5, pattern, practiceRange(pattern, { enabled: true, from: 2, to: 2 }));
  assert.deepEqual(calls, [[7.5, 2, 2]]); assert.equal(source.playbackRate.value, 1);
});
test('inactive replay does not stop the exercise audio', () => {
  let stops = 0; const r = new ReplayPlayer({ stopScheduled: () => stops++ }, () => {}, () => {});
  r.stop(); assert.equal(stops, 0);
});
test('replay schedules original timing scaled by speed and cancels pending start', async () => {
  let release, calls = [], now = 10, stops = 0;
  const audio = { ensure: async () => {}, get time() { return now; }, play: (...args) => calls.push(args), stopScheduled: () => stops++ };
  const r = new ReplayPlayer(audio, () => {}, () => {});
  await r.start(session({ hits: [{ inst: 'snare', timeMs: 50, vel: 63 }] }), { speed: .5 });
  now = 10.1; r.tick(); r.pause();
  assert.equal(calls.length, 1); assert.ok(Math.abs(calls[0][1] - 10.18) < .00001); assert.equal(calls[0][2], 63 / 127);
  audio.ensure = () => new Promise(resolve => release = resolve);
  const pending = r.start(session()); r.stop(); release(); await pending; assert.equal(r.playing, false);
});
