import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENTS, PRESETS, blankPattern, normalize, resize, totalSlots, slotsPerBeat } from '../js/patterns.js';
import { Scorer, LEVELS } from '../js/scoring.js';
import { MidiInput, defaultMap } from '../js/midi.js';
import * as storage from '../js/storage.js';
import { AudioEngine } from '../js/audio.js';

const memory = new Map();
globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
const note = (over = {}) => ({ inst: 'snare', perf: 1000, dyn: 2, slot: 0, loop: 0, ...over });
const inputFile = value => ({ text: async () => JSON.stringify(value) });
const fixture = () => {
  memory.clear();
  const calls = [];
  const midi = new MidiInput(Object.fromEntries(['onHit', 'onNote', 'onPedal', 'onChoke', 'onStatus'].map(k => [k, (...a) => calls.push([k, ...a])])));
  return { midi, calls };
};
const message = (midi, data) => midi.onMessage({ data, timeStamp: 1234 });

for (const p of PRESETS) test(`preset: ${p.name}`, () => {
  assert.equal(Object.keys(p.steps).length, INSTRUMENTS.length);
  for (const inst of INSTRUMENTS) {
    assert.equal(p.steps[inst.id].length, totalSlots(p));
    assert.ok(p.steps[inst.id].every(v => Number.isInteger(v) && v >= 0 && v <= 3));
  }
  assert.ok(Object.values(p.steps).some(track => track.some(Boolean)));
  assert.equal(new Set(PRESETS.map(x => x.id)).size, PRESETS.length);
});

test('normalize bounds dimensions, tempo and note velocity', () => {
  const p = normalize({ bpm: 999, bars: 100, beats: -3, division: 99, steps: { snare: [-1, 0, 1, 2, 3, 4, '2', 2.4] } });
  assert.deepEqual([p.bpm, p.bars, p.beats, p.division], [260, 8, 2, 16]);
  assert.deepEqual(p.steps.snare.slice(0, 8), [0, 0, 1, 2, 3, 0, 2, 2]);
  assert.equal(normalize({ bpm: -5 }).bpm, 30);
  assert.equal(normalize({ bpm: 'bad' }).bpm, 90);
});
test('normalization copies tracks without mutating inputs', () => {
  const source = { steps: { snare: [3, 2, 1] } };
  const p = normalize(source); p.steps.snare[0] = 0;
  assert.equal(source.steps.snare[0], 3);
});
test('all 96 supported structure combinations have consistent tracks', () => {
  for (let bars = 1; bars <= 8; bars++) for (let beats = 2; beats <= 7; beats++) for (const division of [12, 16]) {
    const p = blankPattern({ bars, beats, division });
    assert.equal(totalSlots(p), bars * beats * (division === 12 ? 3 : 4));
    assert.ok(Object.values(p.steps).every(a => a.length === totalSlots(p)));
  }
});
test('resize expands and trims bars while preserving existing notes', () => {
  const p = structuredClone(PRESETS[0]);
  const q = resize(p, { bars: 2 });
  assert.deepEqual(q.steps.snare.slice(0, 16), p.steps.snare);
  assert.ok(q.steps.snare.slice(16).every(v => v === 0));
  assert.deepEqual(resize(q, { bars: 1 }).steps, p.steps);
});
test('resize converts subdivisions, preserves beats and resolves collisions by accent', () => {
  const p = blankPattern({ sticking: 'RLRL' });
  p.steps.snare[2] = 1; p.steps.snare[3] = 3; p.steps.kick[4] = 2;
  const q = resize(p, { division: 12 });
  assert.equal(slotsPerBeat(q), 3); assert.equal(q.steps.snare[2], 3); assert.equal(q.steps.kick[3], 2); assert.equal(q.sticking, '');
});
test('resize removes beats outside shortened meter', () => {
  const p = blankPattern({ bars: 2 }); p.steps.snare[12] = 3; p.steps.snare[16] = 2;
  const q = resize(p, { beats: 3 });
  assert.deepEqual(q.steps.snare.filter(Boolean), [2]); assert.equal(q.steps.snare[12], 2);
});

for (const [level, [good, ok]] of Object.entries(LEVELS)) test(`scoring boundaries, both early and late: ${level}`, () => {
  for (const sign of [-1, 1]) for (const [offset, kind] of [[0, 'good'], [good, 'good'], [good + .01, 'ok'], [ok, 'ok'], [ok + .01, 'extra']]) {
    const s = new Scorer(); s.level = level; s.expect(note());
    assert.equal(s.hit('snare', 1000 + sign * offset, 92).kind, kind);
  }
});
test('a note is matched once and then an additional strike is extra', () => {
  const s = new Scorer(); s.expect(note());
  assert.equal(s.hit('snare', 1000, 92).kind, 'good'); assert.equal(s.hit('snare', 1000, 92).kind, 'extra');
  assert.equal(s.sweep(2000).length, 0);
});
test('nearest expected note wins', () => {
  const s = new Scorer(); s.expect(note()); s.expect(note({ perf: 1100, slot: 1 }));
  assert.equal(s.hit('snare', 1080, 92).note.slot, 1);
});
test('wrong instruments and distinct crash cymbals are not interchangeable', () => {
  const s = new Scorer(); s.expect(note({ inst: 'crash2' }));
  assert.equal(s.hit('crash', 1000, 92).kind, 'extra'); assert.equal(s.hit('crash2', 1000, 92).kind, 'good');
});
test('open and closed hi-hat match one physical pad', () => {
  const s = new Scorer(); s.expect(note({ inst: 'hho' }));
  assert.equal(s.hit('hh', 1000, 92).kind, 'good');
});
test('misses respect late window and calibration and are counted only once', () => {
  const s = new Scorer(); s.calib = 30; s.expect(note());
  assert.equal(s.sweep(1119).length, 0); assert.equal(s.sweep(1121).length, 1); assert.equal(s.sweep(2000).length, 0);
});
test('positive and negative calibration compensate timing', () => {
  for (const calib of [-50, 50]) { const s = new Scorer(); s.calib = calib; s.expect(note()); assert.equal(s.hit('snare', 1000 + calib, 92).err, 0); }
});
test('ghost, regular and accented dynamics have independent assessment', () => {
  for (const [dyn, velocity, expected] of [[1, 40, true], [1, 92, false], [2, 92, true], [2, 122, false], [3, 122, true], [3, 40, false]]) {
    const s = new Scorer(); s.expect(note({ dyn })); const r = s.hit('snare', 1000, velocity);
    assert.equal(r.kind, 'good'); assert.equal(r.dynOk, expected);
  }
});
test('weighted accuracy includes near hits, misses and extra hits', () => {
  const s = new Scorer();
  for (let i = 0; i < 3; i++) s.expect(note({ perf: 1000 + i * 1000 }));
  s.hit('snare', 1000, 92); s.hit('snare', 2050, 92); s.hit('kick', 2500, 92); s.sweep(4000);
  assert.equal(s.stats().accuracy, 43); assert.equal(s.loopScore(0), 43);
  assert.deepEqual(s.stats().all, { good: 1, ok: 1, miss: 1, extra: 1 });
});
test('timing mean and standard deviation report early/late spread', () => {
  const s = new Scorer(); s.expect(note()); s.expect(note({ perf: 2000 }));
  s.hit('snare', 990, 92); s.hit('snare', 2010, 92);
  assert.equal(s.stats().per.snare.mean, 0); assert.equal(s.stats().per.snare.spread, 10);
});
test('empty score and reset do not retain completed results', () => {
  const s = new Scorer(); assert.equal(s.stats().accuracy, null); assert.equal(s.loopScore(0), null);
  s.expect(note()); s.hit('snare', 1000, 92); s.reset();
  assert.equal(s.results.length, 0); assert.equal(s.pending.length, 0); assert.equal(s.loops.size, 0);
});

test('MIDI default map includes every instrument and both crash2 zones', () => {
  const map = defaultMap();
  for (const i of INSTRUMENTS) for (const n of i.midiIn) assert.equal(map[n], i.id);
  assert.equal(map[57], 'crash2'); assert.equal(map[52], 'crash2');
});
test('MIDI accepts note-on on all channels and preserves timestamps', () => {
  const { midi, calls } = fixture();
  for (let ch = 0; ch < 16; ch++) message(midi, [0x90 | ch, 38, 92]);
  const hits = calls.filter(x => x[0] === 'onHit'); assert.equal(hits.length, 16);
  assert.deepEqual(hits[0], ['onHit', 'snare', 92, 1234, 'midi', 38]);
});
test('MIDI ignores note-off, zero velocity and unmapped notes for scoring', () => {
  const { midi, calls } = fixture();
  for (const data of [[0x80, 38, 92], [0x90, 38, 0], [0x90, 1, 92]]) message(midi, data);
  assert.equal(calls.filter(x => x[0] === 'onHit').length, 0);
});
test('MIDI pedal CC4 and cymbal aftertouch are routed independently', () => {
  const { midi, calls } = fixture(); message(midi, [0xb9, 4, 100]); message(midi, [0xa9, 57, 127]);
  assert.deepEqual(calls, [['onPedal', 100], ['onChoke', 'crash2']]);
});
test('MIDI learning consumes one note and persists a remapping', () => {
  const { midi, calls } = fixture(); let learned;
  midi.startLearn('crash2', n => learned = n); message(midi, [0x99, 60, 120]);
  assert.equal(learned, 60); assert.equal(midi.learn, null); assert.equal(midi.map[60], 'crash2');
  assert.equal(calls.filter(x => x[0] === 'onHit').length, 0);
  assert.ok(midi.notesFor('crash2').includes(60));
  assert.equal(new MidiInput({}).map[60], 'crash2');
  midi.unassign(60); assert.equal(midi.map[60], undefined); midi.assign(60, 'kick'); midi.reset(); assert.equal(midi.map[60], undefined);
});
test('MIDI output uses channel 10, scheduled note-on and note-off', () => {
  const { midi } = fixture(); assert.equal(midi.send(38, 92, 1000), false);
  const sent = []; midi.outId = 'test'; midi.access = { outputs: new Map([['test', { send: (...a) => sent.push(a) }]]) };
  assert.equal(midi.send(38, 92, 1000), true);
  assert.deepEqual(sent, [[[0x99, 38, 92], 1000], [[0x89, 38, 0], 1080]]);
});

for (const shape of ['single', 'array', 'wrapper']) test(`JSON import roundtrip: ${shape}`, async () => {
  const p = structuredClone(PRESETS[0]); const data = shape === 'single' ? p : shape === 'array' ? [p] : { ritmovi: [p] };
  const [q] = await storage.importFile(inputFile(data));
  assert.deepEqual(q.steps, p.steps); assert.notEqual(q.id, p.id); assert.equal(q.preset, false);
});
test('JSON import rejects broken syntax', async () => { await assert.rejects(storage.importFile({ text: async () => '{bad' })); });
test('JSON import filters unrelated records', async () => { assert.deepEqual(await storage.importFile(inputFile([null, 8, {}, { name: 'bad' }])), []); });
test('library saves and loads normalized independent patterns', () => {
  memory.clear(); storage.saveLibrary([PRESETS[0]]); const list = storage.loadLibrary();
  assert.deepEqual(list[0].steps, PRESETS[0].steps); list[0].steps.snare[4] = 0; assert.equal(storage.loadLibrary()[0].steps.snare[4], 2);
});
test('corrupt JSON library recovers to empty', () => {
  memory.set('trener.ritmovi.v1', '{bad'); assert.deepEqual(storage.loadLibrary(), []);
});
test('settings retain default nested fields when loading older settings', () => {
  memory.clear(); storage.saveSettings({ vol: { click: .2 }, trainer: { on: true } });
  const q = storage.loadSettings({ vol: { click: .7, live: .9 }, trainer: { on: false, step: 2 } });
  assert.deepEqual(q, { vol: { click: .2, live: .9 }, trainer: { on: true, step: 2 } });
});
test('BUG: valid JSON of wrong library type must not prevent startup', () => {
  memory.set('trener.ritmovi.v1', '{}'); assert.doesNotThrow(() => storage.loadLibrary());
});
test('BUG: imported sticking must be safe for notation rendering', async () => {
  const [p] = await storage.importFile(inputFile({ name: 'bad sticking', sticking: 123, steps: {} }));
  assert.equal(typeof p.sticking, 'string');
});
test('BUG: imported name must be safe for JSON export', async () => {
  const [p] = await storage.importFile(inputFile({ name: 123, steps: {} })); assert.equal(typeof p.name, 'string');
});

test('sample selection respects velocity layers and cycles equivalent samples', () => {
  const a = new AudioEngine(), quiet = { lo: 1, hi: 60 }, loud1 = { lo: 61, hi: 127 }, loud2 = { lo: 61, hi: 127 };
  a.kit = { layers: { snare: [quiet, loud1, loud2] }, rr: {} };
  assert.equal(a.pickSample('snare', 40 / 127), quiet);
  assert.notEqual(a.pickSample('snare', 120 / 127), a.pickSample('snare', 120 / 127));
  assert.equal(a.pickSample('kick', 1), null);
});
test('audio timestamp maps AudioContext time onto performance time', () => {
  const a = new AudioEngine(); a.ctx = { getOutputTimestamp: () => ({ contextTime: 2, performanceTime: 3000 }) };
  assert.equal(a.ctxToPerf(2.5), 3500);
});
