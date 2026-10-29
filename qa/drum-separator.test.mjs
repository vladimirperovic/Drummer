import test from 'node:test';
import assert from 'node:assert/strict';
import { DRUM_SEPARATOR_MODEL, SEPARATOR_FRAMES, SEPARATOR_OVERLAP, SEPARATOR_RATE, segmentStarts, transitionWindow, accumulateDrums, normalizeDrums, validateSeparatorAudio } from '../js/drum-separator-core.js';

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
