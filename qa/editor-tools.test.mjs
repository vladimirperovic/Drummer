import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPattern, INSTRUMENTS, totalSlots, slotsPerBar } from '../js/patterns.js';
import { PatternHistory, copyBars, pasteBars, generatePattern } from '../js/editor-model.js';

test('history groups a recording or paint gesture into one undo with independent snapshots', () => {
  const p = blankPattern({ id: 'saved', bars: 2 }), history = new PatternHistory(p);
  history.begin(p, 'record');
  for (let i = 0; i < 32; i++) { p.steps.snare[i] = i % 3 + 1; history.capture(p); }
  assert.equal(history.past.length, 0); history.end(p); assert.equal(history.past.length, 1);
  const edited = structuredClone(p), original = history.undo();
  assert.equal(original.steps.snare.some(Boolean), false); original.steps.kick[0] = 3;
  assert.deepEqual(history.redo(), edited);
});
test('ordinary save retains undo and recognizes returning to the saved state', () => {
  const p = blankPattern({ id: 'saved' }), history = new PatternHistory(p);
  p.name = 'Renamed'; p.steps.snare[0] = 3; history.capture(p); history.markSaved(p);
  assert.equal(history.isDirty(), false); assert.equal(history.canUndo, true);
  assert.equal(history.isDirty(history.undo()), true); assert.equal(history.isDirty(history.redo()), false);
  p.steps.kick[0] = 2; history.capture(p); assert.equal(history.isDirty(), true);
  assert.equal(history.isDirty(history.undo()), false);
});
test('Save As and document loading reset identities while branching invalidates redo', () => {
  const p = blankPattern({ id: 'one' }), history = new PatternHistory(p);
  p.bpm = 120; history.capture(p); history.undo(); p.bpm = 100; history.capture(p);
  assert.equal(history.canRedo, false);
  history.markSaved({ ...p, id: 'two' }); assert.equal(history.canUndo, false); assert.equal(history.isDirty(), false);
  history.reset(blankPattern(), { saved: false }); assert.equal(history.isDirty(), true);
});
test('cancelled and no-op gestures leave no history entry, nested transactions remain atomic', () => {
  const p = blankPattern(), history = new PatternHistory(p);
  history.begin(p); history.end(p); assert.equal(history.canUndo, false);
  history.begin(p); p.steps.snare[0] = 3; history.begin(p); history.end(p);
  assert.equal(history.canUndo, false); history.end(p); assert.equal(history.past.length, 1);
  history.begin(p); p.name = 'Cancelled'; assert.notEqual(history.cancel().name, 'Cancelled'); assert.equal(history.depth, 0);
});
test('bounded history retains only the newest entries', () => {
  const p = blankPattern(), history = new PatternHistory(p, { limit: 3 });
  for (let i = 0; i < 20; i++) { p.bpm++; history.capture(p); }
  assert.equal(history.past.length, 3); assert.equal(history.undo().bpm, p.bpm - 1);
});
test('selected-bar copy/paste preserves dynamics and sticking, extends bars and leaves source independent', () => {
  const p = blankPattern({ bars: 3, sticking: 'R'.repeat(16) + 'LR'.repeat(8) + 'L'.repeat(16) });
  p.steps.snare[16] = 1; p.steps.kick[20] = 3; p.steps.tom1[33] = 2;
  const clipboard = copyBars(p, 2, 3), result = pasteBars(p, clipboard, 4);
  assert.equal(result.bars, 5); assert.equal(result.steps.snare[48], 1); assert.equal(result.steps.kick[52], 3); assert.equal(result.steps.tom1[65], 2);
  assert.equal(result.sticking.slice(48), p.sticking.slice(16)); assert.deepEqual(result.steps.snare.slice(0, 48), p.steps.snare);
  result.steps.snare[48] = 3; assert.equal(clipboard.steps.snare[0], 1); assert.equal(p.bars, 3);
});
test('paste replaces target silence too and rejects mismatched meter, swing, division or overflow', () => {
  const p = blankPattern({ bars: 2 }); p.steps.snare.fill(2); p.steps.kick[0] = 3;
  const empty = copyBars(blankPattern(), 1, 1), result = pasteBars(p, empty, 2);
  assert.equal(result.steps.snare.slice(16).some(Boolean), false); assert.equal(result.steps.kick[0], 3);
  for (const changes of [{ beats: 3 }, { beatUnit: 8 }, { division: 12 }, { swing: 67 }]) assert.throws(() => pasteBars({ ...p, ...changes }, empty, 1), /uskladi/);
  assert.throws(() => pasteBars(p, copyBars(p, 1, 2), 8), /osam/); assert.throws(() => copyBars(p, 2, 1), /opseg/);
});
test('rudiment generator builds sticking and accents without altering the original', () => {
  const source = blankPattern({ bars: 1, bpm: 105, swing: 60, name: 'Original' }), original = JSON.stringify(source);
  const result = generatePattern(source, { rudiment: 'paradiddle', lead: 'L', accent: 'cycle', bars: 2 });
  assert.equal(result.sticking.slice(0, 8), 'LRLLRLRR'); assert.equal(result.steps.snare[0], 3); assert.equal(result.steps.snare[1], 2);
  assert.equal(result.steps.snare[8], 3); assert.equal(result.swing, 60); assert.equal(result.bpm, 105); assert.equal(result.bars, 2);
  assert.equal(JSON.stringify(source), original);
});
test('generator obeys chosen hands, active instruments and dynamics while variants change content', () => {
  const source = blankPattern({ beats: 7, beatUnit: 8, bars: 2 });
  const split = generatePattern(source, { sticking: 'RLLR', orchestration: 'split', right: 'ride', left: 'snare', instruments: ['ride', 'snare'], accent: 'right' });
  assert.equal(split.steps.ride[0], 3); assert.equal(split.steps.snare[1], 2); assert.equal(split.steps.snare[2], 2);
  for (const inst of INSTRUMENTS.filter(inst => !['ride', 'snare'].includes(inst.id))) assert.equal(split.steps[inst.id].some(Boolean), false);
  assert.notDeepEqual(generatePattern(source).steps, generatePattern(source, { variant: 1 }).steps);
  assert.throws(() => generatePattern(source, { sticking: 'RX' }), /R\/L/); assert.throws(() => generatePattern(source, { instruments: ['kick'] }), /ručni/);
});
test('fill density/orchestration are generated across both meters and divisions with at most one event per slot', () => {
  for (const beatUnit of [4, 8]) for (const division of [12, 16]) for (const kind of ['rudiment', 'fill']) {
    const source = blankPattern({ beatUnit, division, beats: 7, bars: 3 });
    const easy = generatePattern(source, { kind, difficulty: 'easy', orchestration: 'around' });
    const hard = generatePattern(source, { kind, difficulty: 'hard', orchestration: 'linear', variant: 2 });
    const count = p => Object.values(p.steps).flat().filter(Boolean).length;
    assert.ok(count(hard) > count(easy)); assert.equal(hard.steps.snare.length, totalSlots(source));
    for (let slot = 0; slot < totalSlots(source); slot++) assert.ok(INSTRUMENTS.filter(inst => hard.steps[inst.id][slot]).length <= 1);
    assert.equal(hard.bars * slotsPerBar(hard), totalSlots(source));
  }
});
