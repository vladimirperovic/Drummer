import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPattern, normalize, resize, slotsPerBeat, slotsPerBar, slotOffsetMs, slotAtMs, slotDurationMs, barMs, groupStarts } from '../js/patterns.js';
import { parseMidiFile, metadataAt, midiToPattern, fileDrumMap } from '../js/midi-file.js';
import { normalizeProfile, velocityFor } from '../js/profiles.js';
import { normalizeMidiMap } from '../js/midi.js';
import { BackingTrack } from '../js/backing.js';
import { patternSignature, practiceRange } from '../js/practice.js';
import { printRows } from '../js/printing.js';
import { t } from '../js/i18n.js';
import { fixture, smf, track, end, vlq } from './midi-fixtures.mjs';

test('legacy 4/4 data retains 16 steps and two seconds at 120 quarter BPM', () => {
  const p = normalize({ bpm: 120, steps: {} }); assert.equal(slotsPerBar(p), 16); assert.equal(barMs(p), 2000); assert.equal(p.swing, 50);
});
test('6/8 and 7/8 have correct duration, sixteenth grid and accent groups', () => {
  const a = blankPattern({ beats: 6, beatUnit: 8, bpm: 120 }), b = blankPattern({ beats: 7, beatUnit: 8, bpm: 120 });
  assert.deepEqual([slotsPerBar(a), barMs(a), slotsPerBar(b), barMs(b)], [12, 1500, 14, 1750]);
  assert.deepEqual(groupStarts(a), [0, 3]); assert.deepEqual(groupStarts(b), [0, 2, 4]);
});
test('swing changes offbeat positions without changing bar duration', () => {
  const p = blankPattern({ bpm: 120, swing: 67 });
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => slotOffsetMs(p, i)), [0, 167.5, 335, 417.5, 500]);
  assert.equal(slotOffsetMs(p, 16), 2000); assert.equal(slotOffsetMs(p, -16), -2000);
});
test('swing time/slot conversion is inverse for negative count-in and fractional positions', () => {
  for (const unit of [4, 8]) for (const division of [12, 16]) for (const swing of [50, 60, 67, 75]) {
    const p = blankPattern({ bpm: 137, beats: 7, beatUnit: unit, division, swing });
    for (let n = -32; n < 180; n += .23) assert.ok(Math.abs(slotAtMs(p, slotOffsetMs(p, n)) - n) < 1e-9);
  }
});
test('triplets ignore swing and /8 triplets divide an eighth into three', () => {
  const p = blankPattern({ bpm: 120, beatUnit: 8, division: 12, swing: 75 });
  assert.equal(p.swing, 50); assert.equal(slotsPerBeat(p), 3); assert.ok(Math.abs(slotDurationMs(p, 0) - 250 / 3) < 1e-9);
});
test('meter and grouping normalization rejects invalid values', () => {
  const p = normalize({ beatUnit: 32, swing: Infinity, groups: [0, 4] });
  assert.equal(p.beatUnit, 4); assert.deepEqual(p.groups, [4]);
  assert.deepEqual(blankPattern({ beats: 7, beatUnit: 8, groups: '3+2+2' }).groups, [3, 2, 2]);
});
test('resizing beat unit preserves numbered beat onsets and strongest collisions', () => {
  const p = blankPattern(); p.steps.snare[4] = 3; p.steps.kick[2] = 2;
  const q = resize(p, { beats: 6, beatUnit: 8 }); assert.equal(q.steps.snare[2], 3); assert.equal(q.steps.kick[1], 2); assert.equal(q.steps.kick.length, 12);
});
test('journal signatures distinguish swing, beat units and grouping', () => {
  const p = blankPattern();
  for (const change of [{ swing: 67 }, { beatUnit: 8 }, { groups: [2, 2] }]) assert.notEqual(patternSignature(p), patternSignature({ ...p, ...change }));
});
test('6/8 A-B backing uses quarter BPM and the same duration as notation', () => {
  const p = blankPattern({ bars: 4, beats: 6, beatUnit: 8, bpm: 60 }), backing = new BackingTrack({}); backing.bpm = 120;
  assert.deepEqual(backing.segment(p, practiceRange(p, { enabled: true, from: 2, to: 3 })), { offset: 1.5, duration: 3, rate: .5 });
});
test('SMF type 1 parser handles conductor metadata, running status and channels', () => {
  const file = parseMidiFile(fixture()); assert.equal(file.format, 1); assert.equal(file.ppq, 480); assert.equal(file.tracks.length, 3);
  assert.equal(file.tracks[1].name, 'Drums'); assert.equal(file.notes.length, 7);
  assert.deepEqual(metadataAt(file), { bpm: 120, beats: 6, beatUnit: 8 });
  assert.equal(file.notes.filter(n => n.channel === 10).length, 5);
});
test('SMF type 0 handles one-byte channel events and SysEx', () => {
  const file = parseMidiFile(smf([track([[0, 192, 1], [0, 208, 34], [0, 240, 2, 1, 247], [0, 153, 35, 80], end])]));
  assert.equal(file.notes.length, 1); assert.equal(file.notes[0].note, 35);
});
test('MIDI import selects drum channel, maps notes and retains ghost/accent dynamics', () => {
  const result = midiToPattern(parseMidiFile(fixture()), { channel: 10, track: 1, bars: 1 });
  assert.equal(result.imported, 4); assert.equal(result.ignored, 1); assert.equal(result.pattern.beatUnit, 8);
  assert.equal(result.pattern.steps.kick[0], 3); assert.equal(result.pattern.steps.snare[2], 1); assert.equal(result.pattern.steps.crash2[6], 3);
});
test('MIDI selection starts in quarter notes and excludes hits at the ending boundary', () => {
  const r = midiToPattern(parseMidiFile(fixture()), { channel: 10, startQuarter: .5, bars: 1 });
  assert.equal(r.pattern.steps.snare[0], 1); assert.equal(r.pattern.steps.kick.some(Boolean), false);
});
test('MIDI eighth quantization rounds to eighth grid and merges stronger hits', () => {
  const f = parseMidiFile(smf([track([[0, 153, 38, 30], [10, 38, 125], [...vlq(300), 36, 90], end])]));
  const r = midiToPattern(f, { quantize: 'eighth' });
  assert.equal(r.collisions, 1); assert.equal(r.pattern.steps.snare[0], 3); assert.equal(r.pattern.steps.kick[2], 2);
});
test('MIDI mapping may skip known notes or assign unknown notes', () => {
  const map = { ...fileDrumMap(), 36: '', 60: 'tom1' };
  const r = midiToPattern(parseMidiFile(fixture()), { channel: 10, map }); assert.equal(r.imported, 4); assert.equal(r.pattern.steps.tom1[8], 2);
});
test('MIDI tempo changes use section initial tempo and warn about flattening', () => {
  const f = parseMidiFile(smf([track([[0, 255, 81, 3, 7, 161, 32], [...vlq(480), 255, 81, 3, 15, 66, 64], [0, 153, 38, 90], end])]));
  assert.equal(midiToPattern(f).tempoChanges, true); assert.equal(midiToPattern(f, { startQuarter: 1 }).pattern.bpm, 60);
});
test('MIDI rejects a section crossing a time signature change', () => {
  const f = parseMidiFile(smf([track([[0, 153, 38, 90], [...vlq(480), 255, 88, 4, 7, 3, 24, 8], end])]));
  assert.throws(() => midiToPattern(f), /menja meru/); assert.equal(midiToPattern(f, { startQuarter: 1 }).pattern.beats, 7);
});
test('MIDI rejects unsupported type 2 and SMPTE timing with explanations', () => {
  assert.throws(() => parseMidiFile(smf([track([end])], { format: 2 })), /tip 2/);
  assert.throws(() => parseMidiFile(smf([track([end])], { ppq: 0xe728 })), /SMPTE/);
});
test('MIDI parser bounds every truncated prefix of a valid file', () => {
  const bytes = fixture(); for (let n = 0; n < bytes.length - 1; n++) assert.throws(() => parseMidiFile(bytes.slice(0, n)), `prefix ${n}`);
});
test('MIDI rejects missing running status, overlong VLQ, data bytes and missing end', () => {
  for (const events of [[[0, 38, 80], end], [[255, 255, 255, 255, 0, 153, 38, 80], end], [[0, 153, 200, 80], end], [[0, 153, 38, 80]]]) assert.throws(() => parseMidiFile(smf([track(events)])));
});
test('profile validation bounds calibration and curve/gain and filters map entries', () => {
  const p = normalizeProfile({ name: ' Test ', calib: 9000, gain: 9, curve: 'bad', map: { 38: 'snare', 999: 'kick', 10: 'bad' } });
  assert.equal(p.name, 'Test'); assert.equal(p.calib, 1000); assert.equal(p.gain, 2); assert.equal(p.curve, 'linear'); assert.deepEqual(p.map, {38: 'snare'});
});
test('velocity curves are monotonic, bounded and linear default is exact', () => {
  for (const curve of ['linear', 'soft', 'hard']) for (const gain of [.5, 1, 2]) {
    let last = 0; for (let v = 1; v <= 127; v++) { const next = velocityFor(v, curve, gain); assert.ok(next >= last && next <= 127 && next >= 1); last = next; }
  }
  for (let v = 1; v <= 127; v++) assert.equal(velocityFor(v), v);
  assert.ok(velocityFor(40, 'soft') > 40); assert.ok(velocityFor(40, 'hard') < 40);
});
test('corrupt MIDI map falls back; intentionally empty map stays empty', () => {
  assert.ok(Object.keys(normalizeMidiMap('bad')).length > 0); assert.deepEqual(normalizeMidiMap({}), {});
});
test('print layout repeats patterns, numbers bars and splits lines without modifying data', () => {
  const p = blankPattern({ bars: 2, beats: 7, beatUnit: 8, sticking: 'RL' }); p.steps.snare[0] = 3;
  const before = JSON.stringify(p), rows = printRows(p, { barsPerLine: 3, repeats: 4 });
  assert.deepEqual(rows.map(r => [r.offset, r.pattern.bars, r.final]), [[0, 3, false], [3, 3, false], [6, 2, true]]);
  assert.equal(rows[0].pattern.steps.snare[28], 3); assert.equal(JSON.stringify(p), before);
});
test('print can hide sticking independently and clamps layout controls', () => {
  const rows = printRows(blankPattern({ sticking: 'RL' }), { barsPerLine: 99, repeats: 99, sticking: false });
  assert.equal(rows.length, 2); assert.ok(rows.every(r => r.pattern.sticking === ''));
});
test('English translates static labels and preserves Serbian when selected', () => {
  assert.equal(t('Vežbanje', 'en'), 'Practice'); assert.equal(t('Vežbanje', 'sr'), 'Vežbanje'); assert.equal(t('My custom groove čć', 'en'), 'My custom groove čć');
});
test('English translates dynamic scoring, errors, meter and instrument strings', () => {
  assert.equal(t('Dobos · jačina 92 · 12 ms kasno', 'en'), 'Snare · velocity 92 · 12 ms late');
  assert.equal(t('7/8 · 2 takta · šesnaestine · 90 BPM', 'en'), '7/8 · 2 bars · sixteenths · 90 BPM');
  assert.equal(t('Prolaz 95%: tempo podignut na 102 BPM', 'en'), 'Pass 95%: tempo increased to 102 BPM');
  assert.equal(t('MIDI fajl je prekinut ili oštećen.', 'en'), 'The MIDI file is truncated or corrupt.');
});
