import test from 'node:test';
import assert from 'node:assert/strict';
import { INST, PRESETS, padKey } from '../js/patterns.js';
import { Scorer } from '../js/scoring.js';
import { defaultMap, withRimshot } from '../js/midi.js';
import { patternSignature, compactStats, normalizeSession } from '../js/practice.js';
import { analyzeTriggers, physicalPad, toJsonLines, velocitySummary } from '../js/trigger-check-model.js';
import { instrumentFromName, instrumentFromMidi, instrumentFromDisplay } from '../js/score-drums.js';

test('rimshot is TD-17 note 40, shares the snare pad and keeps preset journal signatures', () => {
  assert.equal(defaultMap()[40], 'rimshot'); assert.equal(defaultMap()[38], 'snare');
  assert.equal(INST.rimshot.midiOut, 40); assert.deepEqual(INST.rimshot.keys, ['KeyX']);
  assert.equal(padKey('rimshot'), 'snare'); assert.equal(padKey('hho'), 'hh'); assert.equal(padKey('xstick'), 'xstick');
  // Signatures computed before rimshot existed (git b9199e0..3bd7263).
  assert.deepEqual(PRESETS.slice(0, 3).map(patternSignature), ['1z06mxa', 'y0xaxa', '1x820ys']);
  assert.deepEqual(withRimshot({ 38: 'snare', 40: 'snare' }), { 38: 'snare', 40: 'rimshot' });
  const custom = { 40: 'tom1' }; assert.equal(withRimshot(custom), custom);
});

test('rimshot and snare hits match each other; articulation is checked only when requested', () => {
  const run = articulation => {
    const s = new Scorer(); s.articulation = articulation;
    s.expect({ inst: 'rimshot', perf: 1000, dyn: 2, slot: 0, loop: 0 }); s.expect({ inst: 'snare', perf: 2000, dyn: 2, slot: 4, loop: 0 });
    return [s.hit('snare', 1005, 100), s.hit('rimshot', 2003, 100), s.stats()];
  };
  const [a, b, stats] = run(true);
  assert.equal(a.kind, 'good'); assert.equal(a.inst, 'rimshot'); assert.equal(a.artOk, false); assert.equal(a.played, 'snare');
  assert.equal(b.inst, 'snare'); assert.equal(b.artOk, false); assert.equal(stats.all.extra, 0); assert.equal(stats.accuracy, 100);
  assert.deepEqual([stats.per.rimshot.artOk, stats.per.rimshot.artChecked], [0, 1]);
  const compact = compactStats(stats); assert.equal(compact.per.rimshot.articulation, 0);
  const [plain] = run(false); assert.equal(plain.artOk, undefined);
  assert.equal(compactStats(run(false)[2]).per.snare.articulation, null);
});

test('journal sessions keep articulation and older sessions without it stay valid', () => {
  const base = { id: 's1', pattern: PRESETS[0], hits: [], stats: { accuracy: 90, per: { snare: { good: 1, articulation: 75 }, kick: { good: 2 } } } };
  const session = normalizeSession(base);
  assert.equal(session.stats.per.snare.articulation, 75); assert.equal('articulation' in session.stats.per.kick, false);
});

test('trigger check groups zones by physical pad and finds doubles, crosstalk, saturation and pedal range', () => {
  assert.equal(physicalPad('rimshot', 40), 'snare'); assert.equal(physicalPad('xstick', 37), 'snare'); assert.equal(physicalPad('bell', 53), 'ride');
  assert.equal(physicalPad('hho', 46), 'hihat'); assert.equal(physicalPad(null, 27), 'note-27');
  const hits = [];
  let t = 0;
  for (let i = 0; i < 10; i++) hits.push({ t: t += 200, note: 38, vel: 127, inst: 'snare' });
  hits.push({ t: t + 10, note: 40, vel: 40, inst: 'rimshot' }, { t: t + 300, note: 38, vel: 90, inst: 'snare' }, { t: t + 315, note: 38, vel: 30, inst: 'snare' });
  hits.push({ t: t + 3000, note: 36, vel: 110, inst: 'kick' }, { t: t + 3006, note: 43, vel: 12, inst: 'tom3' });
  hits.push({ t: t + 3400, note: 36, vel: 110, inst: 'kick' }, { t: t + 3404, note: 43, vel: 9, inst: 'tom3' });
  const pedal = Array.from({ length: 12 }, (_, i) => ({ t: i * 10, value: 30 + i }));
  const r = analyzeTriggers(hits, pedal);
  assert.equal(r.hits, hits.length);
  assert.deepEqual(r.doubles.map(d => [d.pad, d.count]), [['snare', 2]], 'rim after head counts as the same pad');
  assert.deepEqual(r.crosstalk.map(c => [c.source, c.victim, c.count]), [['kick', 'tom3', 2]]);
  const kinds = r.advice.map(a => a.kind);
  assert.ok(kinds.includes('double')); assert.ok(kinds.includes('crosstalk')); assert.ok(kinds.includes('hot')); assert.ok(kinds.includes('pedalRange'));
  assert.equal(kinds.includes('clean'), false);
  assert.deepEqual([...new Set(r.zones.map(z => z.pad))], ['kick', 'snare', 'tom3'], 'zones follow kit order');
  assert.equal(r.segments.length, 2);
});

test('trigger check reports clean pads, unmapped notes and exports midirec JSON lines', () => {
  const hits = Array.from({ length: 40 }, (_, i) => ({ t: 5000 + i * 150, note: i % 2 ? 38 : 36, vel: 70 + i, inst: i % 2 ? 'snare' : 'kick', channel: 10 }));
  const clean = analyzeTriggers(hits);
  assert.deepEqual(clean.advice.map(a => a.kind), ['clean']);
  const withAux = analyzeTriggers([...hits, { t: 20000, note: 27, vel: 60, inst: null }]);
  assert.deepEqual(withAux.unmapped, [{ note: 27, count: 1 }]); assert.ok(withAux.advice.some(a => a.kind === 'unmapped'));
  const lines = toJsonLines(hits.slice(0, 2), [{ t: 4900, value: 64 }]).trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines, [{ type: 'cc', t: 0, cc: 4, val: 64 }, { type: 'on', t: .1, note: 36, vel: 70, ch: 10 }, { type: 'on', t: .25, note: 38, vel: 71, ch: 10 }]);
  const v = velocitySummary([1, 16, 17, 64, 127, 127]);
  assert.deepEqual(v.hist, [2, 1, 0, 1, 0, 0, 0, 2]); assert.equal(v.saturated, 2 / 6); assert.equal(v.median, 64);
  assert.equal(analyzeTriggers([]).hits, 0);
});

test('MusicXML drum instruments map by name, GM number and staff position', () => {
  assert.equal(instrumentFromName('Acoustic Snare'), 'snare'); assert.equal(instrumentFromName('Side Stick'), 'xstick');
  assert.equal(instrumentFromName('Pedal Hi-Hat'), 'hhp'); assert.equal(instrumentFromName('Open Hi-Hat'), 'hho'); assert.equal(instrumentFromName('Closed Hi-Hat'), 'hh');
  assert.equal(instrumentFromName('Ride Bell'), 'bell'); assert.equal(instrumentFromName('Ride Cymbal 1'), 'ride'); assert.equal(instrumentFromName('Crash Cymbal 2'), 'crash2');
  assert.equal(instrumentFromName('High Floor Tom'), 'tom3'); assert.equal(instrumentFromName('Hi-Mid Tom'), 'tom1'); assert.equal(instrumentFromName('Low Tom'), 'tom2');
  assert.equal(instrumentFromName('Bass Drum 1'), 'kick'); assert.equal(instrumentFromName('Cowbell'), ''); assert.equal(instrumentFromName('Drumset'), null);
  assert.equal(instrumentFromMidi(40), 'snare', 'GM 40 is an electric snare, not a TD-17 rimshot');
  assert.equal(instrumentFromMidi(56), ''); assert.equal(instrumentFromMidi(36), 'kick'); assert.equal(instrumentFromMidi(null), null);
  assert.equal(instrumentFromDisplay('C', 5), 'snare'); assert.equal(instrumentFromDisplay('C', 5, 'x'), 'xstick');
  assert.equal(instrumentFromDisplay('G', 5, 'x'), 'hh'); assert.equal(instrumentFromDisplay('F', 5, 'diamond'), 'bell');
  assert.equal(instrumentFromDisplay('F', 4), 'kick'); assert.equal(instrumentFromDisplay('D', 4, 'x'), 'hhp'); assert.equal(instrumentFromDisplay('A', 4), 'tom3');
});

test('song play-along matches hits by drum group, reports early/late and colors blue, purple and red', async () => {
  const { songFamily, timingColor, prepareReference, matchSongHit, smoothError, songReport } = await import('../js/song-practice-model.js');
  assert.equal(songFamily('tom3'), 'toms'); assert.equal(songFamily('ride'), 'cymbals'); assert.equal(songFamily('rimshot'), 'snare'); assert.equal(songFamily('hhp'), 'pedal');
  assert.equal(timingColor(0), 'rgb(142, 68, 173)'); assert.equal(timingColor(-40), 'rgb(47, 111, 237)'); assert.equal(timingColor(400), 'rgb(217, 48, 37)');
  const reference = prepareReference([{ timeSeconds: 1, inst: 'kick' }, { timeSeconds: 1, inst: 'hh' }, { timeSeconds: 1.5, inst: 'tom1' }, { timeSeconds: 2, inst: 'snare' }, { timeSeconds: 9, inst: 'kick' }], { from: 0, to: 5 });
  assert.equal(reference.length, 4);
  const hits = [matchSongHit(reference, { inst: 'kick', t: 1.01 }), matchSongHit(reference, { inst: 'hh', t: .98 }), matchSongHit(reference, { inst: 'tom3', t: 1.54 }),
    matchSongHit(reference, { inst: 'crash', t: 1.6 }), matchSongHit(reference, { inst: 'kick', t: 1.02 })];
  assert.deepEqual(hits.map(h => h.kind), ['good', 'good', 'ok', 'extra', 'extra'], 'any tom matches the toms group; a matched hit is not reused');
  assert.ok(Math.abs(hits[0].err - 10) < 1e-6 && Math.abs(hits[1].err + 20) < 1e-6 && Math.abs(hits[2].err - 40) < 1e-6);
  assert.equal(smoothError(null, 30), 30); assert.equal(smoothError(30, 10, .5), 20);
  const report = songReport(reference, hits, { durationSeconds: 5, bpm: 120, offsetSeconds: 1 });
  assert.deepEqual([report.expected, report.good, report.ok, report.missed, report.extra, report.accuracy], [4, 2, 1, 1, 2, 63]);
  assert.equal(report.barSeconds, 2); assert.equal(report.windows.length, 2); assert.deepEqual(report.windows.map(w => [w.expected, w.missed]), [[4, 1], [0, 0]]);
  assert.deepEqual(report.families.map(f => [f.id, f.hit, f.expected]), [['kick', 1, 1], ['snare', 0, 1], ['toms', 1, 1], ['hihat', 1, 1]]);
});

test('AI uses half of the logical cores only when the page is cross-origin isolated', async () => {
  const { aiThreadCount, hasWebGpu, AI_WEBGPU_WASM_ASSET, AI_WASM_ASSET } = await import('../js/ai-model-cache.js');
  assert.equal(aiThreadCount(false, 8), 1, 'no shared memory without COOP/COEP');
  assert.equal(aiThreadCount(true, 8), 4, 'M1: 4 threads measured fastest');
  assert.equal(aiThreadCount(true, 2), 1); assert.equal(aiThreadCount(true, 32), 8); assert.equal(aiThreadCount(true, 0), 2, 'unknown core count assumes four');
  assert.equal(await hasWebGpu(), false, 'Node has no WebGPU adapter');
  assert.match(AI_WEBGPU_WASM_ASSET.url, /onnxruntime-web@1\.31\.1\/dist\/ort-wasm-simd-threaded\.asyncify\.wasm$/);
  assert.equal(AI_WEBGPU_WASM_ASSET.bytes, 28747738); assert.notEqual(AI_WEBGPU_WASM_ASSET.sha256, AI_WASM_ASSET.sha256);
});
