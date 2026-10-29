import test from 'node:test';
import assert from 'node:assert/strict';
import { activationEvents, estimateDrumTempo, transcriptionMidi, ADTOF_MODEL } from '../js/ai-transcription-model.js';
import { encodeAiWav } from '../js/ai-audio.js';
import { parseMidiFile, metadataAt } from '../js/midi-file.js';
import { AI_WASM_ASSET, getAiAsset } from '../js/ai-model-cache.js';

test('AI peaks preserve raw timing/group/confidence and allow independent group mapping', () => {
  const values = new Float32Array(100 * 5); values[10 * 5] = .9; values[10 * 5 + 1] = .8; values[40 * 5 + 2] = .95; values[70 * 5 + 4] = .9;
  const events = activationEvents(values, { mapping: { toms: 'tom3', cymbals: '' } });
  assert.deepEqual(events.map(e => [e.timeSeconds, e.inst, e.velocity]), [[.1, 'kick', 92], [.1, 'snare', 92], [.4, 'tom3', 92]]);
  assert.equal(events[2].group, 'toms'); assert.ok(events[0].confidence > .89);
  assert.equal(activationEvents(values, { durationSeconds: .2 }).length, 2);
});
test('AI peak picking rejects sustained plateaus, invalid tensors and nearby duplicate peaks', () => {
  assert.equal(activationEvents(new Float32Array(1000).fill(.1)).length, 0);
  const values = new Float32Array(200 * 5); values[50 * 5] = .9; values[52 * 5] = .8;
  assert.equal(activationEvents(values).length, 1);
  assert.throws(() => activationEvents(new Float32Array([NaN, 0, 0, 0, 0])));
});
test('AI MIDI preserves unquantized onsets while exporting chosen tempo and meter', () => {
  const midi = parseMidiFile(transcriptionMidi([{ timeSeconds: .123, inst: 'kick', velocity: 92 }, { timeSeconds: 1.337, inst: 'ride', velocity: 92 }], { bpm: 137, beats: 7, beatUnit: 8, durationSeconds: 3 }));
  assert.deepEqual(metadataAt(midi), { bpm: 137, beats: 7, beatUnit: 8 });
  const secondsPerTick = midi.tempos[0].microseconds / 1000000 / midi.ppq;
  assert.ok(Math.abs(midi.notes[0].tick * secondsPerTick - .123) < .001);
  assert.equal(midi.notes[1].note, 51); assert.equal(midi.notes[1].channel, 10);
});
test('AI tempo estimate handles regular kick/snare events and insufficient evidence', () => {
  assert.equal(estimateDrumTempo([{ inst: 'kick', timeSeconds: 0 }]), null);
  assert.ok(Math.abs(estimateDrumTempo(Array.from({ length: 24 }, (_, i) => ({ inst: i % 2 ? 'snare' : 'kick', timeSeconds: i * .5 }))) - 120) <= 1);
});
test('WAV export writes correct stereo layout, sample rate, length and clipped PCM', () => {
  const wav = encodeAiWav([Float32Array.of(-1, .5), Float32Array.of(1, -.5)], 44100), view = new DataView(wav);
  assert.equal(wav.byteLength, 52); assert.equal(view.getUint32(24, true), 44100); assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getInt16(44, true), -32768); assert.equal(view.getInt16(46, true), 32767);
});
test('AI data never downloads without explicit permission; pinned manifests have exact sizes', async () => {
  let fetched = false; const original = globalThis.fetch; globalThis.fetch = async () => { fetched = true; throw new Error('unexpected'); };
  try { await assert.rejects(getAiAsset(ADTOF_MODEL), error => error.code === 'AI_DOWNLOAD_REQUIRED'); assert.equal(fetched, false); }
  finally { globalThis.fetch = original; }
  assert.equal(ADTOF_MODEL.bytes + AI_WASM_ASSET.bytes, 17020614); assert.match(AI_WASM_ASSET.sha256, /^[a-f0-9]{64}$/);
});
