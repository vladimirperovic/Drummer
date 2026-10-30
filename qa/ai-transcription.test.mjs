import test from 'node:test';
import assert from 'node:assert/strict';
import { activationEvents, estimateDrumTempo, transcriptionMidi, ADTOF_MODEL } from '../js/ai-transcription-model.js';
import { encodeAiWav } from '../js/ai-audio.js';
import { parseMidiFile, metadataAt } from '../js/midi-file.js';
import { AI_WASM_ASSET, getAiAsset } from '../js/ai-model-cache.js';
import { ADT_STR_MODEL, ADT_STR_CLASSES, decodeAdtStrTokens, ADT_STR_CHUNK } from '../js/adt-str-model.js';
import { TRANSCRIBER_MODELS, getTranscriptionClasses, transcriptionEvents } from '../js/ai-transcription-model.js';
import { getTranscriberModelInfo } from '../js/ai-transcriber.js';
import { resampleAdtStr, logmel } from '../js/adt-str-dsp.js';

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

test('transcriber registry preserves ADTOF default and pins both licensed ADT_STR graph files', () => {
  assert.equal(TRANSCRIBER_MODELS[0].id, ADTOF_MODEL.id);
  assert.equal(getTranscriberModelInfo().id, ADTOF_MODEL.id);
  const model = getTranscriberModelInfo('adt-str');
  assert.equal(model.id, ADT_STR_MODEL.id); assert.equal(model.downloadBytes, 72913936);
  assert.equal(model.totalDownloadBytes, 87762788); assert.equal(model.license, 'CC BY-SA 4.0');
  assert.equal(model.backendPreference, 'wasm'); assert.equal(model.assets.length, 2);
  for (const asset of model.assets) { assert.match(asset.sha256, /^[a-f0-9]{64}$/); assert.match(asset.url, /resolve\/89a917875e272bb492311624d7536b5e27604a64\//); }
  assert.equal(getTranscriptionClasses(model.id), ADT_STR_CLASSES);
  assert.throws(() => getTranscriberModelInfo('unknown'));
});

test('ADT_STR token decoding preserves articulation, velocity, timestamps and optional percussion mapping', () => {
  // Custom pitch 43 is pedal hi-hat (GM44); custom44 is open (GM46), not GM43/44.
  const events = decodeAdtStrTokens([2, 14, 343, 455, 54, 344, 510, 74, 339, 480, 104, 348, 400, 3, 154, 338, 490], { offsetSeconds: 2.56, durationSeconds: 4 });
  assert.deepEqual(events.map(e => [e.timeSeconds, e.inst, e.velocity, e.midi]), [[2.66, 'hhp', 55, 44], [3.06, 'hho', 110, 46], [3.26, '', 80, 39], [3.56, 'ride', 1, 51]]);
  const result = { modelId: ADT_STR_MODEL.id, durationSeconds: 4, events };
  assert.equal(transcriptionEvents(result).length, 3, 'aux percussion is not silently reassigned');
  const mapped = transcriptionEvents(result, { mapping: { clap: 'xstick', 'hihat-open': '' } });
  assert.deepEqual(mapped.map(e => e.inst), ['hhp', 'xstick', 'ride']);
  assert.equal(transcriptionEvents(result, { durationSeconds: 3 }).length, 1);
});

test('ADT_STR malformed, duplicate and padded-tail tokens cannot shift notes or extend the source audio', () => {
  const events = decodeAdtStrTokens([2, 4, 14, 338, 490, 14, 338, 490, 99, 399, 470, 204, 342, 420, 3], { durationSeconds: 1 });
  assert.equal(events.length, 1); assert.equal(events[0].timeSeconds, .1); assert.equal(events[0].inst, 'snare');
  assert.equal(decodeAdtStrTokens([2, 14, 338, 3])[0].velocity, 100, 'missing dynamics use a declared default');
});

test('ADT_STR frontend keeps silence stable and applies antialiasing when resampling to 24 kHz', () => {
  const silence = logmel(new Float32Array(ADT_STR_CHUNK));
  assert.equal(silence.length, 246 * 128); assert.ok(silence.every(value => value === 0));
  assert.throws(() => logmel(new Float32Array(10)));
  const samples = 44100, tone = frequency => Float32Array.from({ length: samples }, (_, i) => Math.sin(2 * Math.PI * frequency * i / 44100));
  const rms = audio => Math.sqrt(audio.subarray(100, audio.length - 100).reduce((sum, value) => sum + value * value, 0) / (audio.length - 200));
  const pass = resampleAdtStr(tone(1000)), stop = resampleAdtStr(tone(18000));
  assert.equal(pass.length, 24000); assert.ok(rms(pass) > .69 && rms(pass) < .72);
  assert.ok(rms(stop) < .01, 'frequencies above target Nyquist must be suppressed');
});

test('AI MIDI export keeps pedal, side stick, rimshot and expanded-kit articulations', () => {
  const events = ['hhp', 'xstick', 'rimshot', 'bell', 'kick2', 'floor2', 'snare2', 'tom4', 'crash3'].map((inst, i) => ({ inst, timeSeconds: i / 10, velocity: 20 + i * 10 }));
  const notes = parseMidiFile(transcriptionMidi(events)).notes;
  assert.deepEqual(notes.map(note => note.note), [44, 37, 40, 53, 35, 41, 40, 47, 52]);
  assert.deepEqual(notes.map(note => note.velocity), events.map(event => event.velocity));
});
