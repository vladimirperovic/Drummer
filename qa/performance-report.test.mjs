import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPattern, slotOffsetMs } from '../js/patterns.js';
import { performanceBar, performancePasses, performanceTimeline } from '../js/performance-report.js';
import { normalizeSession, performanceMidi } from '../js/practice.js';
import { ReplayPlayer } from '../js/replay.js';
import { AudioEngine } from '../js/audio.js';

function session(over = {}) {
  const pattern = blankPattern({ bpm: 120, bars: 2 }); pattern.steps.snare[0] = 2; pattern.steps.snare[4] = 2; pattern.steps.snare[16] = 2;
  const expected = [0, 4, 16].map(slot => ({ id: `0:${slot}:snare`, inst: 'snare', slot, loop: 0, dyn: 2, timeMs: slotOffsetMs(pattern, slot) }));
  return { id: 'report-test', pattern, durationMs: 4000, calib: 0, range: { from: 1, to: 2 }, expected, hits: [],
    timeline: Array.from({ length: 32 }, (_, slot) => ({ slot, loop: 0, timeMs: slotOffsetMs(pattern, slot), bpm: 120 })), ...over };
}

test('performance report places early, late and extra hits at actual fractional note positions', () => {
  const s = session({ hits: [
    { inst: 'snare', loop: 0, timeMs: -10, expectedId: '0:0:snare', err: -10, kind: 'good' },
    { inst: 'snare', loop: 0, timeMs: 540, expectedId: '0:4:snare', err: 40, kind: 'ok' },
    { inst: 'kick', loop: 0, timeMs: 800, err: null, kind: 'extra' },
  ] });
  const b = performanceBar(s, 0, 1);
  assert.deepEqual(b.hits.map(h => Number(h.localSlot.toFixed(2))), [-.08, 4.32, 6.4]);
  assert.equal(b.missed.length, 0);
  assert.equal(performanceBar(s, 0, 2).missed.length, 1);
});

test('performance report uses the recorded clock for swing and live tempo changes', () => {
  const s = session(); s.pattern.swing = 67;
  s.timeline = s.timeline.map(e => ({ ...e, timeMs: slotOffsetMs(s.pattern, e.slot) }));
  const t = s.timeline[2].timeMs;
  s.hits = [{ inst: 'snare', loop: 0, timeMs: t + (s.timeline[3].timeMs - t) / 2, kind: 'extra' }];
  assert.equal(performanceBar(s, 0, 1).hits[0].localSlot, 2.5);
  const anchor = s.timeline[8].timeMs;
  s.timeline = s.timeline.map(e => e.slot >= 8 ? { ...e, bpm: 60, timeMs: anchor + (slotOffsetMs({ ...s.pattern, bpm: 60 }, e.slot) - slotOffsetMs({ ...s.pattern, bpm: 60 }, 8)) } : e);
  s.hits = [{ inst: 'snare', loop: 0, timeMs: (s.timeline[10].timeMs + s.timeline[11].timeMs) / 2, kind: 'extra' }];
  assert.ok(Math.abs(performanceBar(s, 0, 1).hits[0].localSlot - 10.5) < 1e-9);
});

test('matched early bar-boundary hits stay with their expected note and calibrated error', () => {
  const s = session({ calib: 30, hits: [{ inst: 'snare', loop: 0, timeMs: 2020, expectedId: '0:16:snare', err: -10, kind: 'good' }] });
  assert.equal(performanceBar(s, 0, 1).hits.length, 0);
  const hit = performanceBar(s, 0, 2).hits[0];
  assert.ok(hit.localSlot < 0); assert.equal(hit.adjustedTimeMs, 1990); assert.equal(hit.timeMs, 2020);
});

test('a partial final bar hides notes that were never scheduled and pass selection stays bounded', () => {
  const s = session(); s.timeline = s.timeline.slice(0, 3); s.expected = s.expected.slice(0, 1);
  assert.equal(performanceBar(s, 0, 1).pattern.steps.snare[4], 0);
  assert.deepEqual(performancePasses(s), [0]);
});

test('chronological report assigns early and late hits to their actual bar and pass', () => {
  const s = session({ durationMs: 8000 });
  s.timeline.push(...s.timeline.map(e => ({ ...e, loop: 1, timeMs: e.timeMs + 4000 })));
  s.expected.push({ ...s.expected[0], id: '1:0:snare', loop: 1, timeMs: 4000 });
  s.hits = [
    { inst: 'snare', loop: 0, timeMs: 1990, expectedId: '0:16:snare', err: -10 },
    { inst: 'snare', loop: 1, timeMs: 3990, expectedId: '1:0:snare', err: -10 },
    { inst: 'kick', loop: 0, timeMs: 4010, kind: 'extra' },
  ];
  const models = performanceTimeline(s);
  assert.deepEqual(models.map(m => [m.loop, m.bar, m.startMs]), [[0, 1, 0], [0, 2, 2000], [1, 1, 4000], [1, 2, 6000]]);
  assert.equal(models[0].hits[0].timeMs, 1990); assert.equal(models[1].hits[0].timeMs, 3990);
  assert.equal(models[2].hits[0].timeMs, 4010); assert.ok(Math.abs(models[2].hits[0].localSlot - .08) < 1e-8);
  assert.equal(models[1].missed.length, 0); // A hit can be drawn in the preceding bar without becoming a miss.
});

test('legacy recordings without a slot clock retain absolute loop timing and silent bars', () => {
  const s = session({ timeline: [], durationMs: 8000, hits: [
    { inst: 'snare', loop: 1, slot: 0, timeMs: 4020, kind: 'extra' },
  ] });
  s.expected.push({ id: '1:16:snare', inst: 'snare', slot: 16, loop: 1, dyn: 2, timeMs: 6000 });
  const models = performanceTimeline(s);
  assert.deepEqual(models.map(m => m.startMs), [0, 2000, 4000, 6000]);
  assert.ok(Math.abs(models[2].hits[0].localSlot - .16) < 1e-8);
  assert.equal(models[3].endMs, 8000);
  s.expected = []; s.range = { from: 2, to: 2 }; s.durationMs = 4000;
  assert.equal(performanceBar(s, 1, 2).startMs, 2000);
});

test('long reports preserve chronological bar order without duplicating raw events', () => {
  const s = session({ durationMs: 100000, timeline: [], expected: [], hits: [] });
  for (let loop = 0; loop < 25; loop++) {
    s.timeline.push(...Array.from({ length: 32 }, (_, slot) => ({ loop, slot, timeMs: loop * 4000 + slot * 125, bpm: 120 })));
    s.hits.push({ inst: 'snare', loop, slot: 0, timeMs: loop * 4000 + 20, kind: 'extra' });
  }
  const models = performanceTimeline(s);
  assert.equal(models.length, 50); assert.equal(models.reduce((n, m) => n + m.hits.length, 0), 25);
  assert.deepEqual(models.map(m => m.startMs), Array.from({ length: 50 }, (_, i) => i * 2000));
});

test('session loading, replay and MIDI retain the early first hit instead of dropping it', async () => {
  const s = normalizeSession(session({ hits: [{ inst: 'snare', loop: 0, timeMs: -10.25, vel: 80 }, { inst: 'kick', loop: 0, timeMs: 100.25, vel: 90 }] }));
  assert.equal(s.hits[0].timeMs, -10.25);
  const calls = [], audio = { time: 1, ensure: async () => {}, stopScheduled() {}, play: (...args) => calls.push(args) };
  const replay = new ReplayPlayer(audio, () => {}, () => {});
  await replay.start(s); replay.pause();
  assert.equal(calls[0][0], 'snare'); assert.equal(calls[0][1], 1.08);
  const bytes = performanceMidi(s);
  assert.equal([...bytes].filter((v, i) => v === 0x99 && [38, 36].includes(bytes[i + 1])).length, 2);
});

test('choke does not silence a voice that starts in the future', () => {
  const a = new AudioEngine(); a.ctx = { currentTime: .1 };
  const choked = [];
  a.voices = [0, .2].map(start => ({ start, end: 1, instId: 'hho', out: { gain: { setTargetAtTime: () => choked.push(start) } } }));
  a.choke('hho', .1);
  assert.deepEqual(choked, [0]); assert.equal(a.voices[1].end, 1);
});

test('a stale WAV kit load cannot overwrite a later synth selection', async () => {
  const a = new AudioEngine(); a.ensure = async () => {};
  const oldFetch = globalThis.fetch; let complete;
  globalThis.fetch = async () => ({ json: () => new Promise(resolve => { complete = () => resolve({ name: 'old', instruments: {} }); }) });
  try {
    const loading = a.loadKit('/old'); await Promise.resolve(); await Promise.resolve();
    a.useSynth(); complete(); assert.equal(await loading, null); assert.equal(a.kit, null);
  } finally { globalThis.fetch = oldFetch; }
});
