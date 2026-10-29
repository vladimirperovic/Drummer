import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPattern, barMs } from '../js/patterns.js';
import { normalizeArrangement, compileArrangement } from '../js/arrangements.js';
import { validateBackup, planRestore, backupStorageValues } from '../js/backup-restore.js';
import { JournalStore, sessionSummary } from '../js/journal-store.js';

const pattern = blankPattern({ id: 'p1', name: 'Pattern', bpm: 137, bars: 2, beats: 7, beatUnit: 8 });
const session = { id: 's1', pattern, startedAt: '2026-10-29T12:00:00Z', durationMs: 1000,
  hits: [{ inst: 'snare', timeMs: -10, vel: 90, loop: 0 }], expected: [], timeline: [], results: [], stats: { accuracy: 90 } };
const backup = () => ({ version: 2, ritmovi: [pattern], sessions: [session], programs: [], profiles: [], arrangements: [], favorites: ['p1'], podesavanja: { current: pattern }, trenutni: pattern, language: 'en' });

test('arrangements preserve independent section patterns, meter and exact musical repeat counts', () => {
  const arrangement = normalizeArrangement({ name: 'Song', sections: [
    { name: 'Verse', pattern, repeats: 3, bpm: 137 },
    { name: 'Chorus', pattern: blankPattern({ beats: 6, beatUnit: 8, bars: 1 }), repeats: 4, bpm: 93 },
  ] });
  const entries = compileArrangement(arrangement);
  assert.deepEqual(entries.map(e => e.bars), [6, 4]);
  assert.equal(entries[0].durationSeconds, 6 * barMs(pattern) / 1000);
  assert.equal(entries[1].durationSeconds, 4 * 6 * 60000 / 93 / 2 / 1000);
  entries[0].pattern.steps.snare[0] = 3; assert.equal(arrangement.sections[0].pattern.steps.snare[0], 0);
});
test('arrangement bounds prevent invalid tempos, repeat counts and unbounded sections', () => {
  const value = normalizeArrangement({ sections: [{ pattern, bpm: 999, repeats: -3 }] });
  assert.equal(value.sections[0].bpm, 260); assert.equal(value.sections[0].repeats, 1);
  assert.equal(normalizeArrangement({ sections: Array.from({ length: 200 }, () => ({ pattern })) }).sections.length, 128);
});
test('full backup validation preserves negative hits and rejects malformed and duplicate records', () => {
  assert.equal(validateBackup(backup()).sessions[0].hits[0].timeMs, -10);
  assert.throws(() => validateBackup({ ...backup(), sessions: [{ ...session, hits: [{ inst: 'not-a-pad', timeMs: 10 }] }] }));
  assert.throws(() => validateBackup({ ...backup(), ritmovi: [pattern, pattern] }));
  assert.throws(() => validateBackup(JSON.parse('{"version":2,"ritmovi":[],"__proto__":{"polluted":true}}')));
  assert.throws(() => validateBackup({ ...backup(), profiles: [null] }));
});
test('merge keep/replace/both conflicts are explicit and original objects are unchanged', () => {
  const current = backup(), incoming = validateBackup({ ...backup(), ritmovi: [{ ...pattern, name: 'Imported' }] });
  assert.equal(planRestore(current, incoming).snapshot.ritmovi[0].name, 'Pattern');
  assert.equal(planRestore(current, incoming, { conflicts: 'replace' }).snapshot.ritmovi[0].name, 'Imported');
  const both = planRestore(current, incoming, { conflicts: 'both' });
  assert.equal(both.snapshot.ritmovi.length, 2); assert.equal(both.counts.ritmovi.conflicts, 1);
  assert.ok(both.snapshot.favorites.includes(both.snapshot.ritmovi[1].id));
  assert.equal(current.ritmovi[0].name, 'Pattern');
});
test('replace preview counts removals and replacements and settings are opt-in', () => {
  const current = { ...backup(), ritmovi: [pattern, { ...pattern, id: 'old' }] };
  const incoming = validateBackup({ ...backup(), language: 'sr' });
  const plan = planRestore(current, incoming, { mode: 'replace' });
  assert.equal(plan.counts.ritmovi.removed, 1); assert.equal(plan.counts.ritmovi.replaced, 1); assert.equal(plan.snapshot.language, 'en');
  assert.equal(planRestore(current, incoming, { mode: 'replace', settings: true }).snapshot.language, 'sr');
  assert.ok(!Object.hasOwn(backupStorageValues(plan.snapshot), 'drummer.sessions.v1'));
});
test('journal summaries never duplicate raw performance event arrays', () => {
  const summary = sessionSummary(session);
  assert.equal(summary.hitCount, 1); assert.equal(summary.rawStored, true);
  for (const key of ['hits', 'expected', 'timeline', 'results']) assert.equal(key in summary, false);
  assert.equal(session.hits.length, 1);
});

test('full backup includes MIDI device/channel routing and both editable drafts', () => {
  const imported = validateBackup({ ...backup(), midiRouting: { inputs: [{ device: 'td17', channel: 10, note: 38, inst: 'snare' }], outputs: { snare: { device: '*', channel: 10, note: 40 } } },
    programDraft: { name: 'Unfinished routine', entries: [{ pattern }] }, arrangementDraft: { name: 'Unfinished song', sections: [{ pattern, repeats: 2, bpm: 137 }] } });
  const restored = planRestore(backup(), imported, { settings: true }).snapshot, values = backupStorageValues(restored);
  assert.equal(JSON.parse(values['drummer.midiRouting.v1']).inputs[0].device, 'td17');
  assert.equal(JSON.parse(values['drummer.midiRouting.v1']).outputs.snare.note, 40);
  assert.equal(JSON.parse(values['drummer.programDraft.v1']).name, 'Unfinished routine');
  assert.equal(JSON.parse(values['drummer.arrangementDraft.v1']).sections[0].repeats, 2);
  assert.throws(() => validateBackup({ ...backup(), programDraft: { entries: [null] } }));
  assert.throws(() => validateBackup({ ...backup(), arrangementDraft: { sections: [null] } }));
});

test('journal fallback uses the supplied storage and reports quota without losing the previous raw performance', async () => {
  const memory = new Map(), failures = [];
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const journal = new JournalStore({ indexedDB: null, storage, onFailure: error => failures.push(error.message) });
  await journal.put(session); assert.equal((await journal.list())[0].hitCount, 1); assert.equal((await journal.get('s1')).hits[0].timeMs, -10);
  storage.setItem = () => { throw new Error('quota'); };
  await assert.rejects(journal.put({ ...session, id: 's2' }), /quota/);
  assert.equal((await journal.list()).length, 1); assert.deepEqual(failures, ['quota']);
});
