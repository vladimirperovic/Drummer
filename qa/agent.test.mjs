import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrummerTools, registerDrummerTools } from '../js/agent-tools.js';
import { loadFavorites, saveFavorites, setErrorHandler } from '../js/storage.js';

function fixture() {
  const s = { pattern: { id: 'basic', bars: 2, bpm: 90 }, playing: false, starting: false, unsavedPattern: false };
  const host = { instrumentIds: ['kick', 'snare'], isEnabled: () => true, getState: () => s,
    getPattern: id => !id || id === 'basic' ? s.pattern : null,
    listPatterns: args => ({ args }), loadPattern: () => true,
    setFavorite: () => true, setBpm: bpm => { s.pattern.bpm = bpm; }, setOptions: v => { s.options = v; },
    setView: async v => { s.view = v; }, setFocus: v => { s.focus = v; }, setLanguage: v => { s.language = v; },
    audioReady: () => true, start: async () => { s.playing = true; return true; }, stop: () => { s.playing = false; },
    getResults: limit => ({ limit }), lastMessage: () => 'Could not start',
  };
  const tools = createDrummerTools(host);
  return { s, host, tools, call: (name, args = {}) => tools.find(t => t.name === 'drummer_' + name).execute(args) };
}
test('WebMCP registers thirteen unique tools with read/write annotations', async () => {
  const { tools } = fixture(), registered = [];
  assert.equal(new Set(tools.map(t => t.name)).size, 13);
  assert.equal(tools.filter(t => t.annotations.readOnlyHint).length, 4);
  assert.deepEqual(await registerDrummerTools(tools, { registerTool: t => registered.push(t.name) }), { status: 'ready', count: 13 });
  assert.equal(registered.length, 13);
});
test('WebMCP gracefully handles unsupported browsers and rolls back partial registration', async () => {
  const { tools } = fixture(), removed = [];
  assert.deepEqual(await registerDrummerTools(tools), { status: 'unsupported', count: 0 });
  let calls = 0;
  assert.deepEqual(await registerDrummerTools(tools, { registerTool() { if (++calls === 3) throw Error('unavailable'); }, unregisterTool: n => removed.push(n) }), { status: 'error', count: 0 });
  assert.deepEqual(removed, tools.slice(0, 2).map(t => t.name));
});
test('disabled connector rejects reads and writes without changing state', async () => {
  const { call, host, s } = fixture(); host.isEnabled = () => false;
  for (const name of ['get_state', 'stop']) assert.equal((await call(name)).error.code, 'DISABLED');
  assert.equal((await call('set_tempo', { bpm: 100 })).error.code, 'DISABLED'); assert.equal(s.pattern.bpm, 90);
});
test('tool validation rejects extra fields, coercions, bounds, empty settings and invalid enums', async () => {
  const { call, s } = fixture();
  for (const [name, args] of [ ['set_tempo', { bpm: '120' }], ['set_tempo', { bpm: 261 }], ['set_tempo', { bpm: NaN }],
    ['set_tempo', {}], ['stop', { run: 'code' }], ['set_view', {}], ['set_view', { rows: 3 }], ['set_language', { language: 'de' }],
    ['list_patterns', { limit: 0 }], ['list_patterns', { favoritesOnly: 1 }], ['start', { durationSeconds: -1 }], ['get_state', []],
    ['set_options', { record: true }], ['set_options', {}], ['set_favorite', { id: 'basic' }], ]) {
    assert.equal((await call(name, args)).error.code, 'INVALID_ARGUMENT', JSON.stringify([name, args]));
  }
  assert.equal(s.pattern.bpm, 90);
});
test('loading never discards unsaved edits and rejects missing IDs', async () => {
  const { call, host, s } = fixture(); host.loadPattern = () => { throw Error('must not load'); };
  s.unsavedPattern = true; assert.equal((await call('load_pattern', { id: 'basic' })).error.code, 'UNSAVED_EDITS');
  s.unsavedPattern = false; assert.equal((await call('load_pattern', { id: 'missing' })).error.code, 'NOT_FOUND');
  assert.equal((await call('get_pattern', { id: 'missing' })).error.code, 'NOT_FOUND');
});
test('active playback, starting, calibration, replay and programs guard pattern/options/focus', async () => {
  for (const flag of ['playing', 'starting', 'programRunning', 'calibrating', 'replaying']) {
    const { call, s } = fixture(); s[flag] = true;
    for (const [name, args] of [['load_pattern', { id: 'basic' }], ['set_options', { metro: false }], ['set_focus', { enabled: true, from: 1, to: 2, instruments: ['snare'] }]]) {
      assert.equal((await call(name, args)).error.code, 'BUSY', flag);
    }
  }
});
test('tempo is adjustable during normal playback but locked for backing, replay and programs', async () => {
  const { call, s } = fixture(); s.playing = true;
  assert.equal((await call('set_tempo', { bpm: 120 })).ok, true);
  for (const flag of ['backingEnabled', 'starting', 'calibrating', 'replaying', 'programRunning']) {
    s[flag] = true; assert.equal((await call('set_tempo', { bpm: 130 })).error.code, 'BUSY'); s[flag] = false;
  }
  assert.equal(s.pattern.bpm, 120);
});

test('capture and restore lock all mutations while state reads and emergency stop remain available', async () => {
  for (const flag of ['capturing', 'restoring', 'aiBusy']) {
    const { call, s } = fixture(); s[flag] = true;
    for (const [name, args] of [['set_tempo', { bpm: 130 }], ['set_language', { language: 'en' }], ['set_favorite', { id: 'basic', favorite: true }], ['set_view', { view: 'editor' }], ['start', {}]]) assert.equal((await call(name, args)).error.code, 'BUSY', flag);
    assert.equal((await call('get_state')).ok, true); assert.equal((await call('stop')).ok, true); assert.equal(s.pattern.bpm, 90);
  }
});
test('start requires audio activation, reports failures and avoids restarting playback', async () => {
  const { call, host, s } = fixture(); host.audioReady = () => false;
  assert.equal((await call('start')).error.code, 'AUDIO_LOCKED'); host.audioReady = () => true;
  host.start = async () => false; assert.equal((await call('start')).error.code, 'START_FAILED');
  s.playing = true; host.start = async () => { throw Error('must not restart'); };
  assert.equal((await call('start')).playing, true); assert.equal((await call('stop')).playing, false);
});
test('A–B ranges must fit the pattern with distinct known instruments', async () => {
  const { call } = fixture(), args = { enabled: true, from: 1, to: 2, instruments: ['snare'] };
  assert.equal((await call('set_focus', args)).ok, true);
  assert.equal((await call('set_focus', { ...args, to: 3 })).error.code, 'INVALID_RANGE');
  assert.equal((await call('set_focus', { ...args, from: 2, to: 1 })).error.code, 'INVALID_RANGE');
  for (const instruments of [[], ['snare', 'snare'], ['unknown']]) assert.equal((await call('set_focus', { ...args, instruments })).error.code, 'INVALID_ARGUMENT');
});
test('concurrent writes are serialized while reads and emergency stop remain available', async () => {
  const { call, host, s } = fixture(); let release;
  host.setView = () => new Promise(resolve => { release = resolve; }); s.playing = true;
  const pending = call('set_view', { kitView: '3d' });
  assert.equal((await call('set_tempo', { bpm: 100 })).error.code, 'BUSY');
  assert.equal((await call('get_state')).playing, true); assert.equal((await call('stop')).playing, false);
  release(); assert.equal((await pending).ok, true); assert.equal((await call('set_tempo', { bpm: 100 })).ok, true);
});
test('tool results are detached from application data and failures release the write lock', async () => {
  const { call, s, host } = fixture(), result = await call('get_pattern'); result.pattern.bpm = 200;
  assert.equal(s.pattern.bpm, 90);
  host.setView = async () => { throw Error('No graphics'); };
  assert.equal((await call('set_view', { kitView: '3d' })).error.code, 'OPERATION_FAILED');
  assert.equal((await call('set_tempo', { bpm: 100 })).ok, true);
});
test('favorite tool validates IDs and storage failure; searches pass favorites and pagination', async () => {
  const { call, host } = fixture();
  assert.equal((await call('set_favorite', { id: 'missing', favorite: true })).error.code, 'NOT_FOUND');
  assert.equal((await call('set_favorite', { id: 'basic', favorite: true })).favorite, true);
  host.setFavorite = () => false; assert.equal((await call('set_favorite', { id: 'basic', favorite: false })).error.code, 'STORAGE_FAILED');
  assert.deepEqual((await call('list_patterns', { favoritesOnly: true, offset: 12, limit: 12 })).args,
    { category: 'all', source: 'all', query: '', favoritesOnly: true, offset: 12, limit: 12 });
});
test('favorites storage round-trips unique IDs and rejects corrupted structures', () => {
  let value = null; globalThis.localStorage = { getItem: () => value, setItem: (key, v) => { value = v; } };
  assert.equal(saveFavorites(['basic', 'basic', 'jazz', 3, null, {}, '', 'x'.repeat(201)]), true);
  assert.deepEqual(loadFavorites(), ['basic', 'jazz']);
  for (const malformed of ['{', '{}', 'null', 'false', '4']) { value = malformed; assert.deepEqual(loadFavorites(), []); }
});
test('favorites storage reports quota failure without deleting previous data', () => {
  let errors = 0; globalThis.localStorage = { getItem: () => '["basic"]', setItem: () => { throw Error('Quota'); } };
  setErrorHandler(() => errors++); assert.equal(saveFavorites(['jazz']), false);
  assert.equal(errors, 1); assert.deepEqual(loadFavorites(), ['basic']); setErrorHandler(() => {});
});
