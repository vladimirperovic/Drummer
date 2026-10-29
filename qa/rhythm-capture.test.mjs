import test from 'node:test';
import assert from 'node:assert/strict';
import { quantizeTake } from '../js/rhythm-capture-model.js';
const hit = (timeMs, inst = 'snare', vel = 92) => ({ timeMs, inst, vel });
const options = { bpm: 120, bars: 1, beats: 4, beatUnit: 4, quantize: '16' };

test('capture selects nearest notes, retains raw times and applies calibration once', () => {
  const hits = [hit(-10), hit(140), hit(255)];
  const result = quantizeTake(hits, { ...options, calib: 15 });
  assert.deepEqual(result.accepted.map(h => h.slot), [0, 1, 2]);
  assert.deepEqual(result.accepted.map(h => h.timeMs), [-10, 140, 255]);
  assert.deepEqual(result.accepted.map(h => h.errorMs), [-25, 0, -10]);
  assert.equal(hits[0].slot, undefined);
});
test('automatic capture chooses eighths for simple beats and triplets for triplet timing', () => {
  assert.equal(quantizeTake([hit(0), hit(250), hit(500), hit(750)], { ...options, quantize: 'auto' }).mode, '8');
  const triplets = quantizeTake(Array.from({ length: 9 }, (_, i) => hit(i * 500 / 3)), { ...options, quantize: 'auto' });
  assert.equal(triplets.mode, '12'); assert.equal(triplets.pattern.division, 12); assert.ok(triplets.meanErrorMs < 1e-8);
});
test('swing uses musical clock distances when choosing the nearest note', () => {
  const result = quantizeTake([hit(167), hit(335), hit(418)], { ...options, swing: 67 });
  assert.deepEqual(result.accepted.map(h => h.slot), [1, 2, 3]); assert.ok(result.meanErrorMs < 1);
});
test('simultaneous drums remain distinct and repeated hits retain their strongest dynamic', () => {
  const result = quantizeTake([hit(0, 'snare', 30), hit(3, 'kick', 92), hit(9, 'snare', 120)], options);
  assert.equal(result.pattern.steps.snare[0], 3); assert.equal(result.pattern.steps.kick[0], 2);
  assert.equal(result.accepted.length, 3); assert.equal(result.collisions, 1);
});
test('end-of-take hits never wrap to bar one and invalid instruments cannot alter prototypes', () => {
  const result = quantizeTake([hit(1990), hit(2000), hit(2050), hit(-100), hit(0, '__proto__'), null], options);
  assert.equal(result.accepted.length, 0); assert.equal(result.rejected.length, 6); assert.equal(Object.prototype[0], undefined);
  assert.equal(result.pattern.steps.snare[0], 0);
});
test('capture respects 7/8 meter and multiple bars', () => {
  const result = quantizeTake([hit(0), hit(1750), hit(3375)], { ...options, beats: 7, beatUnit: 8, bars: 2 });
  assert.deepEqual(result.accepted.map(h => h.slot), [0, 14, 27]); assert.equal(result.pattern.steps.snare.length, 28);
});
