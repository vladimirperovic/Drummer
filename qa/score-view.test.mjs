import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMidiFile, midiToPattern } from '../js/midi-file.js';
import { smf, track, end, vlq } from './midi-fixtures.mjs';

test('MIDI import accepts redundant time signatures inside a selection', () => {
  const file = parseMidiFile(smf([track([
    [0, 255, 88, 4, 4, 2, 24, 8], [0, 153, 38, 90],
    [...vlq(480), 255, 88, 4, 4, 2, 24, 8], [0, 153, 36, 90], end,
  ])]));
  const result = midiToPattern(file);
  assert.equal(result.imported, 2);
  assert.equal(result.pattern.steps.snare[0], 2);
  assert.equal(result.pattern.steps.kick[4], 2);
});

test('MIDI import still rejects an actual signature change after redundant metadata', () => {
  const file = parseMidiFile(smf([track([
    [0, 255, 88, 4, 4, 2, 24, 8], [0, 153, 38, 90],
    [...vlq(240), 255, 88, 4, 4, 2, 24, 8],
    [...vlq(240), 255, 88, 4, 3, 2, 24, 8], end,
  ])]));
  assert.throws(() => midiToPattern(file), /menja meru/);
  assert.equal(midiToPattern(file, { startQuarter: 1 }).pattern.beats, 3);
});
