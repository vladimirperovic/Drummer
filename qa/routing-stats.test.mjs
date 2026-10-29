import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiInput, defaultMap } from '../js/midi.js';
import { normalizeRouting, resolveRoute, ROUTING_KEY } from '../js/midi-routing.js';
import { normalizeProfile } from '../js/profiles.js';
import { Scorer } from '../js/scoring.js';

const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
const rule = (device, channel, inst, note = 38) => ({ device, deviceName: device, channel, note, inst });
function fixture() {
  memory.clear(); const calls = [];
  const midi = new MidiInput({ onHit: (...args) => calls.push(['hit', ...args]), onNote: (...args) => calls.push(['note', ...args]), onChoke: (...args) => calls.push(['choke', ...args]), onStatus() {} });
  const a = { id: 'kit-a', name: 'Identical controller' }, b = { id: 'kit-b', name: 'Identical controller' };
  const sentA = [], sentB = [];
  const outA = { send: (...args) => sentA.push(args), clear: () => sentA.push(['clear']) }, outB = { send: (...args) => sentB.push(args), clear: () => sentB.push(['clear']) };
  midi.access = { inputs: new Map([[a.id, a], [b.id, b]]), outputs: new Map([['out-a', outA], ['out-b', outB]]) }; midi.bind();
  return { midi, calls, a, b, sentA, sentB };
}
const hit = (port, channel, note = 38) => port.onmidimessage({ data: [0x90 | channel - 1, note, 92], timeStamp: 1234 });

test('two identically named MIDI devices distinguish the same note and source channel', () => {
  const { midi, calls, a, b } = fixture();
  midi.setRouting({ inputs: [rule('kit-a', 10, 'snare'), rule('kit-b', 10, 'kick'), rule('kit-a', 2, 'crash2')] });
  hit(a, 10); hit(b, 10); hit(a, 2); hit(b, 2);
  const hits = calls.filter(call => call[0] === 'hit');
  assert.deepEqual(hits.map(call => call[1]), ['snare', 'kick', 'crash2', 'snare']);
  assert.deepEqual(hits[2].slice(2), [92, 1234, 'midi', 38, { deviceId: 'kit-a', deviceName: 'Identical controller', channel: 2 }]);
  assert.equal(calls.find(call => call[0] === 'note')[3].deviceId, 'kit-a');
});

test('routing precedence is exact device/channel, device, channel, wildcard, legacy', () => {
  const inputs = [rule('*', 0, 'tom1'), rule('*', 2, 'tom2'), rule('kit-a', 0, 'kick'), rule('kit-a', 2, 'crash2')];
  for (const ordered of [inputs, inputs.toReversed()]) {
    const routes = normalizeRouting({ inputs: ordered });
    assert.equal(resolveRoute(routes, defaultMap(), 38, { deviceId: 'kit-a', channel: 2 }), 'crash2');
    assert.equal(resolveRoute(routes, defaultMap(), 38, { deviceId: 'kit-a', channel: 3 }), 'kick');
    assert.equal(resolveRoute(routes, defaultMap(), 38, { deviceId: 'kit-b', channel: 2 }), 'tom2');
    assert.equal(resolveRoute(routes, defaultMap(), 38, { deviceId: 'kit-b', channel: 3 }), 'tom1');
    assert.equal(resolveRoute(routes, defaultMap(), 57, { deviceId: 'kit-a', channel: 2 }), 'crash2');
  }
});

test('scoped learning captures actual source, consumes one hit, persists, leaves legacy map alone', () => {
  const { midi, calls, b } = fixture(); let learned;
  midi.startLearn('kick2', (...args) => learned = args, { scoped: true }); hit(b, 4);
  assert.equal(learned[0], 38); assert.equal(learned[1].deviceId, 'kit-b'); assert.equal(learned[1].channel, 4); assert.equal(learned[2], true);
  assert.equal(midi.map[38], 'snare'); assert.equal(calls.filter(c => c[0] === 'hit').length, 0);
  const loaded = new MidiInput({}); assert.equal(loaded.resolve(38, { deviceId: 'kit-b', channel: 4 }), 'kick2');
  assert.equal(loaded.resolve(38, { deviceId: 'kit-a', channel: 4 }), 'snare');
  hit(b, 4); assert.equal(calls.at(-1)[1], 'kick2'); assert.equal(midi.learn, null);
});

test('legacy learn remains one shared map; source-specific aftertouch follows input routing', () => {
  const { midi, a, b, calls } = fixture(); midi.startLearn('ride'); hit(a, 3, 60); hit(b, 5, 60);
  assert.equal(calls.at(-1)[1], 'ride'); assert.deepEqual(midi.routing.inputs, []);
  midi.setRouting({ inputs: [rule('kit-b', 3, 'crash2')] }); b.onmidimessage({ data: [0xa2, 38, 127], timeStamp: 5 });
  assert.deepEqual(calls.at(-1), ['choke', 'crash2']);
});

test('route normalization rejects invalid data and resolves duplicate route keys deterministically', () => {
  const value = { inputs: [rule('kit-a', 2, 'kick'), rule('kit-a', 2, 'snare'), rule('kit-a', 17, 'kick'), rule('kit-a', 1, '__proto__'), rule('kit-a', 1, 'kick', 128)], outputs: { snare: { device: 'out-a', channel: 2, note: 60 }, kick: { device: 'out-b', channel: 0, note: 36 }, '__proto__': { channel: 1, note: 1 } } };
  const normal = normalizeRouting(value); assert.equal(normal.inputs.length, 1); assert.equal(normal.inputs[0].inst, 'snare'); assert.deepEqual(Object.keys(normal.outputs), ['snare']);
  value.inputs[1].inst = 'kick'; value.outputs.snare.note = 61; assert.equal(normal.inputs[0].inst, 'snare'); assert.equal(normal.outputs.snare.note, 60);
});

test('routing persistence failure keeps previous active and saved routing', () => {
  const { midi } = fixture(); midi.setRouting({ inputs: [rule('kit-a', 2, 'kick')] }); const saved = memory.get(ROUTING_KEY), setter = localStorage.setItem;
  let error; midi.h.onStorageError = value => error = value;
  localStorage.setItem = () => { throw new Error('quota'); };
  try { assert.equal(midi.setRouting({ inputs: [rule('kit-a', 2, 'snare')] }), false); } finally { localStorage.setItem = setter; }
  assert.equal(midi.resolve(38, { deviceId: 'kit-a', channel: 2 }), 'kick'); assert.equal(memory.get(ROUTING_KEY), saved); assert.equal(error.message, 'quota');
});

test('independent output maps preserve device/channel/note for scheduled on and off', () => {
  const { midi, sentA, sentB } = fixture(); midi.outId = 'out-a';
  midi.setRouting({ outputs: { snare: { device: 'out-b', channel: 3, note: 60 } } }); sentA.length = 0;
  assert.equal(midi.sendInstrument('snare', 92, 1000), true); assert.equal(midi.sendInstrument('kick', 100, 1100), true);
  assert.deepEqual(sentB, [[[0x92, 60, 92], 1000], [[0x82, 60, 0], 1080]]);
  assert.deepEqual(sentA, [[[0x99, 36, 100], 1100], [[0x89, 36, 0], 1180]]);
  midi.outId = ''; assert.equal(midi.sendInstrument('snare', 92, 1200), true); assert.equal(midi.sendInstrument('kick', 92, 1200), false);
});

test('panic clears queued notes and stops original ports/channels after selected output changes', () => {
  const { midi, sentA, sentB } = fixture(); midi.outId = 'out-a';
  midi.setRouting({ outputs: { snare: { device: 'out-b', channel: 16, note: 0 } } }); sentA.length = 0;
  midi.sendInstrument('snare', 127, 5000); midi.sendInstrument('kick', 127, 5000); midi.outId = ''; midi.stopOutput();
  assert.deepEqual(sentB.slice(2), [['clear'], [[0x8f, 0, 0]], [[0xbf, 123, 0]]]);
  assert.deepEqual(sentA.slice(2), [['clear'], [[0x89, 36, 0]], [[0xb9, 123, 0]]]); assert.equal(midi.activeOutputs.size, 0);
});

test('changing output routing stops old destinations before new events and failed note-off panics', () => {
  const { midi, sentA } = fixture(); midi.outId = 'out-a'; midi.sendInstrument('kick', 92, 1000);
  midi.setRouting({ outputs: { kick: { device: 'out-b', channel: 1, note: 60 } } }); assert.deepEqual(sentA.slice(2), [['clear'], [[0x89, 36, 0]], [[0xb9, 123, 0]]]);
  const events = []; const broken = { clear() { events.push('clear'); }, send(data, time) { events.push(data); if (time === 1080) throw new Error('failed note-off'); } };
  assert.equal(midi.sendTo(broken, 2, 50, 90, 1000), false); assert.ok(events.includes('clear')); assert.ok(events.some(data => Array.isArray(data) && data[0] === 0x81 && data[1] === 50));
});

test('old profiles default to shared map, new profiles round-trip independent routes without aliasing', () => {
  const legacy = normalizeProfile({ name: 'Old kit', map: { 38: 'snare' } }); assert.deepEqual(legacy.routing, { inputs: [], outputs: {} });
  const profile = normalizeProfile({ name: 'New kit', map: {}, routing: { inputs: [rule('kit-a', 2, 'kick')], outputs: { kick: { device: 'out-a', channel: 5, note: 60 } } } });
  const copy = normalizeProfile(JSON.parse(JSON.stringify(profile))); assert.deepEqual(copy, profile);
  copy.routing.inputs[0].inst = 'snare'; assert.equal(profile.routing.inputs[0].inst, 'kick');
});

function referenceStats(results) {
  const per = {}, all = { good: 0, ok: 0, miss: 0, extra: 0 };
  for (const r of results) {
    const s = per[r.inst] ||= { good: 0, ok: 0, miss: 0, extra: 0, errs: [], vels: [], dynOk: 0 }; s[r.kind]++; all[r.kind]++;
    if (r.err != null) { s.errs.push(r.err); s.vels.push(r.vel); if (r.dynOk) s.dynOk++; }
  }
  for (const s of Object.values(per)) {
    s.expected = s.good + s.ok + s.miss; s.mean = s.errs.length ? s.errs.reduce((a, b) => a + b, 0) / s.errs.length : null;
    s.spread = s.errs.length > 1 ? Math.sqrt(s.errs.reduce((a, e) => a + (e - s.mean) ** 2, 0) / s.errs.length) : null;
  }
  const expected = all.good + all.ok + all.miss;
  return { per, all, expected, accuracy: expected ? Math.round(100 * (all.good + .5 * all.ok) / (expected + .5 * all.extra)) : null };
}
test('incremental long-session statistics match the previous full scan including all raw samples', () => {
  const scorer = new Scorer();
  for (let i = 0; i < 100000; i++) { const kind = ['good', 'ok', 'miss', 'extra'][i % 4]; scorer.record({ kind, inst: ['snare', 'kick', 'hh'][i % 3], ...(i % 4 < 2 ? { err: (i * 31 % 141) - 70 + .25, vel: i % 127 + 1, dynOk: i % 3 === 0 } : {}) }, Math.floor(i / 16)); }
  const current = scorer.stats(), expected = referenceStats(scorer.results);
  assert.deepEqual(current.all, expected.all); assert.equal(current.accuracy, expected.accuracy); assert.equal(current.expected, expected.expected);
  for (const [inst, s] of Object.entries(current.per)) {
    assert.equal(s.sampleCount, expected.per[inst].errs.length); assert.ok(Math.abs(s.mean - expected.per[inst].mean) < 1e-10); assert.ok(Math.abs(s.spread - expected.per[inst].spread) < 1e-10);
    for (const key of ['good', 'ok', 'miss', 'extra', 'errs', 'vels', 'dynOk', 'expected']) assert.deepEqual(s[key], expected.per[inst][key]);
  }
});

test('statistics do not scan history or copy samples until requested, and snapshots survive recording/reset', () => {
  const scorer = new Scorer(); scorer.record({ kind: 'good', inst: 'snare', err: -10, vel: 92, dynOk: true }, 0);
  const history = scorer.results; scorer.results = new Proxy(history, { get() { throw new Error('history scan'); } });
  const state = scorer.instrumentStats.get('snare'), originalSlice = state.errs.slice; state.errs.slice = () => { throw new Error('eager sample copy'); };
  const before = scorer.stats(); assert.equal(before.per.snare.sampleCount, 1); assert.equal(before.per.snare.mean, -10);
  state.errs.slice = originalSlice; scorer.results = history; scorer.record({ kind: 'ok', inst: 'snare', err: 30, vel: 105, dynOk: true }, 0); scorer.reset();
  assert.deepEqual(before.per.snare.errs, [-10]); assert.deepEqual(before.per.snare.vels, [92]); assert.equal(before.per.snare.good, 1); assert.equal(before.per.snare.ok, 0);
  assert.deepEqual(structuredClone(before).per.snare.errs, [-10]); before.per.snare.errs.push(999); assert.equal(state.errs.length, 2);
  assert.deepEqual(scorer.stats(), { per: {}, all: { good: 0, ok: 0, miss: 0, extra: 0 }, expected: 0, accuracy: null });
});
