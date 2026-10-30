import test from 'node:test';
import assert from 'node:assert/strict';
import { DRUM_SEPARATOR_MODEL, SEPARATOR_FRAMES, SEPARATOR_OVERLAP, SEPARATOR_RATE, segmentStarts, transitionWindow, accumulateDrums, normalizeDrums, validateSeparatorAudio } from '../js/drum-separator-core.js';
import { SCNET_MODEL, SCNET_SMALL_MODEL, SEPARATOR_MODELS } from '../js/drum-separator-core.js';
import { createDrumSeparator, getSeparatorModelInfo } from '../js/drum-separator.js';
import { SCNET_SAMPLES, SCNET_FRAMES, scnetReflect, scnetNormalization, scnetPlan, scnetSegment, scnetSpectrogram, scnetDrums, accumulateScnet } from '../js/scnet-dsp.js';

test('Demucs descriptor pins the opt-in model bytes and hash, with no bundled weights', () => {
  assert.equal(DRUM_SEPARATOR_MODEL.bytes, 165612636); assert.match(DRUM_SEPARATOR_MODEL.sha256, /^[a-f0-9]{64}$/);
  assert.match(DRUM_SEPARATOR_MODEL.url, /\/55f929d333054c69ae0e829b15e8f8826a39d6eb\//);
  assert.equal(DRUM_SEPARATOR_MODEL.sampleRate, 44100); assert.equal(DRUM_SEPARATOR_MODEL.maxSeconds, 600);
});
test('chunk coverage avoids redundant segments and has no gaps through an uneven final chunk', () => {
  assert.deepEqual(segmentStarts(1), [0]); assert.deepEqual(segmentStarts(SEPARATOR_FRAMES), [0]);
  assert.deepEqual(segmentStarts(SEPARATOR_FRAMES + 1), [0, SEPARATOR_FRAMES - SEPARATOR_OVERLAP]);
  const length = 5 * SEPARATOR_FRAMES + 123, starts = segmentStarts(length);
  assert.ok(starts.at(-1) + SEPARATOR_FRAMES >= length); assert.ok(starts.at(-2) + SEPARATOR_FRAMES < length);
  for (let i = 1; i < starts.length; i++) assert.equal(starts[i] - starts[i - 1], SEPARATOR_FRAMES - SEPARATOR_OVERLAP);
  for (const value of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => segmentStarts(value));
});
test('overlap-add preserves stereo identity including first/last sample and partial tail', () => {
  const segment = 128, overlap = 32, window = transitionWindow(segment, overlap);
  for (const length of [1, 50, 128, 129, 200, 1000]) {
    const source = [Float32Array.from({ length }, (_, i) => Math.sin(i * .19)), Float32Array.from({ length }, (_, i) => Math.cos(i * .23))];
    const output = [new Float32Array(length), new Float32Array(length)], weight = new Float32Array(length);
    for (const start of segmentStarts(length, segment, overlap)) {
      const prediction = new Float32Array(8 * segment).fill(999);
      for (let c = 0; c < 2; c++) { prediction.fill(0, c * segment, (c + 1) * segment); prediction.set(source[c].subarray(start, start + segment), c * segment); }
      accumulateDrums(output, weight, prediction, start, window);
    }
    normalizeDrums(output, weight);
    for (let c = 0; c < 2; c++) for (let i = 0; i < length; i++) assert.ok(Math.abs(output[c][i] - source[c][i]) < 1e-6, `${length} ${c} ${i}`);
  }
});
test('audio validation bounds memory and rejects missing channels/rates/nonfinite samples', () => {
  const valid = new Float32Array(441); validateSeparatorAudio([valid], SEPARATOR_RATE); validateSeparatorAudio([valid, valid], 48000);
  for (const channels of [[], [new Float32Array()], [valid, new Float32Array(1)], [valid, valid, valid], [[0, 1]], [new Float32Array([NaN])]]) assert.throws(() => validateSeparatorAudio(channels, 44100), /SEPARATOR_INVALID_AUDIO/);
  for (const rate of [0, NaN, 1000, 999999]) assert.throws(() => validateSeparatorAudio([valid], rate), /SEPARATOR_INVALID_RATE/);
  assert.throws(() => validateSeparatorAudio([new Float32Array(8000 * 601)], 8000), /SEPARATOR_TOO_LONG/);
});
test('invalid model output is rejected and other stems are never mixed into drum audio', () => {
  const output = [new Float32Array(3), new Float32Array(3)], weight = new Float32Array(3), window = new Float32Array(3).fill(1);
  assert.throws(() => accumulateDrums(output, weight, new Float32Array(2), 0, window), /SEPARATOR_INVALID_OUTPUT/);
  assert.throws(() => accumulateDrums(output, weight, new Float32Array([NaN, 0, 0, 0, 0, 0]), 0, window), /SEPARATOR_INVALID_OUTPUT/);
  assert.throws(() => normalizeDrums(output, weight), /SEPARATOR_INVALID_OUTPUT/);
  accumulateDrums(output, weight, new Float32Array([1, 2, 3, 4, 5, 6, 100, 100, 100, 100, 100, 100]), 0, window);
  assert.deepEqual(normalizeDrums(output, weight).map(c => [...c]), [[1, 2, 3], [4, 5, 6]]);
});

test('separator registry pins the models and rejects an unknown selection', () => {
  assert.deepEqual(SEPARATOR_MODELS.map(model => model.id), [DRUM_SEPARATOR_MODEL.id, 'scnet-large-int8', 'scnet-int8']);
  assert.equal(getSeparatorModelInfo().id, DRUM_SEPARATOR_MODEL.id);
  assert.equal(getSeparatorModelInfo('scnet-large-int8').license, 'MIT');
  assert.equal(SCNET_MODEL.bytes, 45082486);
  assert.match(SCNET_MODEL.url, /\/95f22d9e68f6cab78aef358f1a0de248d4edf805\//);
  assert.equal(SCNET_MODEL.sha256, 'b2dc586a1e0e6c0afe4915e9057ea29111397b7bbf589edc3d85de91de79cd72');
  assert.equal(SCNET_SMALL_MODEL.bytes, 12900277);
  assert.match(SCNET_SMALL_MODEL.url, /\/e71bcdb42bce1d62b7fae25ba90fcbcf90f73f46\//);
  assert.equal(SCNET_SMALL_MODEL.sha256, '98228931494151762a1c4ab1ec7899a894b1f81fd4a509921a9d2f9bacc50845');
  assert.throws(() => getSeparatorModelInfo('unknown'), /SEPARATOR_INVALID_MODEL/);
  assert.throws(() => createDrumSeparator({ modelId: 'unknown' }), /SEPARATOR_INVALID_MODEL/);
});

test('SCNet centered, normalized STFT matches an independent impulse DFT and reconstructs stereo', () => {
  const left = new Float32Array(SCNET_SAMPLES), right = Float32Array.from({ length: SCNET_SAMPLES }, (_, i) => Math.sin(i * .071) * .3);
  left[0] = 1; left[SCNET_SAMPLES - 1] = -.75;
  const spectrum = scnetSpectrogram([left, right]), plane = 2049 * SCNET_FRAMES;
  // Frame zero sees the first sample at index 2048 within its 4096-sample frame.
  for (const bin of [0, 1, 3, 100, 2048]) {
    assert.ok(Math.abs(spectrum[bin * SCNET_FRAMES] - Math.cos(Math.PI * bin) / 64) < 1e-7);
    assert.ok(Math.abs(spectrum[plane + bin * SCNET_FRAMES]) < 1e-7);
  }
  const recovered = scnetDrums(spectrum);
  for (let c = 0; c < 2; c++) {
    const source = [left, right][c]; let worst = 0;
    for (let i = 0; i < source.length; i++) worst = Math.max(worst, Math.abs(source[i] - recovered[c][i]));
    assert.ok(worst < 1e-6, `channel ${c}, max error ${worst}`);
  }
  spectrum[0] = NaN; assert.throws(() => scnetDrums(spectrum), /SEPARATOR_INVALID_OUTPUT/);
});

test('SCNet reflection and segment overlap preserve timing, boundaries, and gain', () => {
  assert.deepEqual([-2, -1, 0, 1, 2, 3, 4, 5, 6].map(i => scnetReflect(i, 4)), [2, 1, 0, 1, 2, 3, 2, 1, 0]);
  assert.equal(scnetReflect(100, 1), 0);
  for (const length of [1, 1000, SCNET_SAMPLES + 1, SCNET_SAMPLES * 2 + 21]) {
    const left = Float32Array.from({ length }, (_, i) => Math.sin(i * .027) * .2 + .1), channels = [left, left];
    const plan = scnetPlan(length), normalization = scnetNormalization(channels);
    const output = [new Float32Array(length), new Float32Array(length)], weight = new Float32Array(length);
    for (let index = 0; index < plan.starts.length; index++) {
      const chunk = scnetSegment(channels, plan, plan.starts[index], normalization);
      accumulateScnet(output, weight, chunk, plan, index);
    }
    normalizeDrums(output, weight);
    for (let i = 0; i < length; i++) assert.ok(Math.abs(output[0][i] * normalization.scale - (left[i] - normalization.mean)) < 1e-6);
  }
});

test('changing separator selection replaces its worker and keeps prepared backend metadata', async () => {
  const originalWorker = globalThis.Worker, workers = [];
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage(message) {
      const result = message.type === 'separate'
        ? { channels: message.channels, model: message.modelId, backend: 'wasm', threads: 2, benchmark: { chosen: 'wasm' } }
        : { ...getSeparatorModelInfo(message.modelId), backend: 'webgpu', threads: 4 };
      queueMicrotask(() => this.onmessage({ data: { id: message.id, type: 'result', result } }));
    }
    terminate() { this.terminated = true; }
  };
  try {
    const separator = createDrumSeparator();
    assert.equal((await separator.prepare()).id, DRUM_SEPARATOR_MODEL.id);
    assert.equal((await separator.prepare()).backend, 'webgpu');
    assert.equal(workers.length, 1);
    assert.equal((await separator.prepare({ modelId: SCNET_MODEL.id })).id, SCNET_MODEL.id);
    assert.equal(workers.length, 2); assert.ok(workers[0].terminated);
    await separator.separate({ channels: [new Float32Array(4410)], sampleRate: 44100 });
    assert.equal((await separator.prepare()).backend, 'wasm', 'metadata follows a mid-inference GPU fallback');
    separator.dispose(); assert.ok(workers[1].terminated);
  } finally { globalThis.Worker = originalWorker; }
});
