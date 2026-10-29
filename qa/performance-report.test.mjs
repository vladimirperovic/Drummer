import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPattern, slotOffsetMs } from '../js/patterns.js';
import { performanceBar, performancePasses } from '../js/performance-report.js';
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
