import test from 'node:test';
import assert from 'node:assert/strict';
import { songMusicXml } from '../js/song-musicxml.js';
import { validateSongProject } from '../js/song-library-store.js';

const song = { fileName: 'A <song> & "title"', events: [{ inst: 'kick', timeSeconds: .1, velocity: 40 }, { inst: 'hh', timeSeconds: .1, velocity: 120 }, { inst: 'snare', timeSeconds: 44.9, velocity: 90 }], durationSeconds: 45, bpm: 120, meter: { beats: 4, beatUnit: 4 }, division: 16, offsetSeconds: 0 };
test('MusicXML exports the last hit beyond eight bars, simultaneous notes and escaped titles', () => {
  const source = songMusicXml(song);
  assert.equal((source.match(/<unpitched>/g) || []).length, 3);
  assert.equal((source.match(/<chord\/>/g) || []).length, 1);
  assert.ok((source.match(/<measure /g) || []).length > 8);
  assert.match(source, /A &lt;song&gt; &amp; &quot;title&quot;/);
  assert.match(source, /<midi-unpitched>37<\/midi-unpitched>/);
  assert.match(source, /parentheses="yes"/); assert.match(source, /<accent\/>/);
});
test('Every /4 and /8 measure balances in straight and triplet grids', () => {
  for (const beats of [2, 3, 4, 6, 7, 12]) for (const beatUnit of [4, 8]) for (const division of [12, 16]) {
    const source = songMusicXml({ ...song, meter: { beats, beatUnit }, division, offsetSeconds: .3 });
    for (const measure of source.matchAll(/<measure[^>]*>([\s\S]*?)<\/measure>/g)) {
      let sum = 0;
      for (const note of measure[1].matchAll(/<note(?:\s[^>]*)?>([\s\S]*?)<\/note>/g)) if (!note[1].includes('<chord/>')) sum += Number(/<duration>(\d+)<\/duration>/.exec(note[1])[1]);
      assert.equal(sum, 480 * beats * 4 / beatUnit, `${beats}/${beatUnit}, division ${division}`);
    }
  }
});
test('Quantization collisions retain the strongest hit without mutating raw timing', () => {
  const events = [{ inst: 'kick', timeSeconds: .1, velocity: 40 }, { inst: 'kick', timeSeconds: .101, velocity: 120 }];
  const before = structuredClone(events), source = songMusicXml({ ...song, events });
  assert.equal((source.match(/<unpitched>/g) || []).length, 1);
  assert.match(source, /<accent\/>/); assert.deepEqual(events, before);
});
test('MusicXML rejects unbounded durations, invalid meters and unknown instruments', () => {
  for (const change of [{ durationSeconds: Infinity }, { durationSeconds: 601 }, { bpm: 0 }, { meter: { beats: 4, beatUnit: 0 } }, { offsetSeconds: 45 }, { events: [{ inst: 'unknown', timeSeconds: 1 }] }]) assert.throws(() => songMusicXml({ ...song, ...change }));
});
const project = () => ({ ...structuredClone(song), format: 'drummer-song', version: 1, id: 'song-1', files: Object.fromEntries(['original', 'drums', 'without', 'musicxml', 'midi'].map(kind => [kind, { name: kind + '.bin', bytes: 100 }])) });
test('Project validation accepts versioned metadata and rejects unsafe or ambiguous files', () => {
  assert.equal(validateSongProject(project()).events.length, 3);
  for (const name of ['../outside', 'C:\\outside', '.', '..', 'x/y', 'x\\y']) {
    const value = project(); value.files.original.name = name; assert.throws(() => validateSongProject(value));
  }
  const value = project(); value.files.drums.name = value.files.original.name; assert.throws(() => validateSongProject(value));
});
test('Project validation rejects corrupt references, excessive assets and newer versions', () => {
  for (const change of [{ version: 2 }, { events: [] }, { events: [{ inst: '__proto__', timeSeconds: 1 }] }, { events: [{ inst: 'kick', timeSeconds: -1 }] }, { events: [{ inst: 'kick', timeSeconds: 1, velocity: NaN }] }]) assert.throws(() => validateSongProject({ ...project(), ...change }));
  const value = project(); value.files.original.bytes = 1024 ** 3; assert.throws(() => validateSongProject(value));
});
