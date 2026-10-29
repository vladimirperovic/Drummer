import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { blankPattern } from '../js/patterns.js';

const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const artifacts = process.env.DRUMMER_ARTIFACTS || fileURLToPath(new URL('./artifacts/studio-next/', import.meta.url));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.DRUMMER_BROWSER ? { channel: process.env.DRUMMER_BROWSER } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
const pattern = blankPattern({ id: 'rhythm-1', name: 'Backup rhythm', bpm: 120 }); pattern.steps.snare[0] = 2;
const session = (id = 's1', n = 2) => ({ id, pattern, startedAt: `2026-10-29T12:${String(Number(id.replace(/\D/g, '')) % 60 || 0).padStart(2, '0')}:00.000Z`, durationMs: 1800000,
  bpmStart: 120, bpmEnd: 120, level: 'normalno', calib: 0, range: { from: 1, to: 1, instruments: ['snare'] },
  hits: Array.from({ length: n }, (_, i) => ({ inst: 'snare', timeMs: i * 20 - 10, vel: 92, note: 38, loop: i >> 4, slot: i % 16, kind: 'good', err: -10, source: 'midi', adjustedVelocity: 92 })),
  expected: [], timeline: [], results: [], passes: [], stats: { accuracy: 100, expected: n, all: { good: n, ok: 0, miss: 0, extra: 0 }, per: {} } });

async function scenario(name, fn, initial = null, beforeLoad = null) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await page.addInitScript(initial => {
    localStorage.setItem('drummer.language.v1', 'en');
    if (initial && !sessionStorage.getItem('qa-seeded')) { localStorage.setItem('drummer.sessions.v1', JSON.stringify(initial)); sessionStorage.setItem('qa-seeded', '1'); }
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => ({ inputs: new Map(), outputs: new Map() }) });
  }, initial);
  if (beforeLoad) await page.addInitScript(beforeLoad);
  await page.route('**/js/main.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nglobalThis.__qa={studio,audio,settings,start,stop,play,onHit,loadPattern};' }); });
  try {
    await page.goto(base); await page.waitForFunction(() => !!globalThis.__qa); await page.evaluate(() => __qa.studio.journalReady);
    await fn(page); assert.deepEqual(errors, []); results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.stack, errors }); console.log(`FAIL ${name}: ${error.message}`);
    await page.screenshot({ path: `${artifacts}/failure-${results.length}.png`, fullPage: true }).catch(() => {});
  } finally { await context.close(); }
}

await scenario('Journal: transactional legacy migration, 12-row pages and lazy full-session loading survive reload', async page => {
  const data = await page.evaluate(async () => ({ legacy: localStorage.getItem('drummer.sessions.v1'), count: __qa.studio.sessions.length,
    rawInList: __qa.studio.sessions.some(s => 'hits' in s), cache: __qa.studio.sessionCache.size, firstHit: (await __qa.studio.loadSession('s1')).hits[0].timeMs }));
  assert.equal(data.legacy, null); assert.equal(data.count, 15); assert.equal(data.rawInList, false); assert.ok(data.cache <= 3); assert.equal(data.firstHit, -10);
  await page.evaluate(() => __qa.studio.show('journal')); assert.equal(await page.locator('#sessionList tr').count(), 12);
  await page.locator('#journalNext').click(); assert.equal(await page.locator('#sessionList tr').count(), 3);
  await page.locator('#sessionList [data-session="s1"]').click(); assert.ok(await page.evaluate(() => __qa.studio.selected.hits.length === 2));
  await page.reload(); await page.waitForFunction(() => !!globalThis.__qa); await page.evaluate(() => __qa.studio.journalReady);
  assert.equal(await page.evaluate(() => __qa.studio.sessions.length), 15);
}, Array.from({ length: 15 }, (_, i) => session(`s${i + 1}`)));

await scenario('Journal: a failed migration retains local data and Retry safely completes migration', async page => {
  assert.equal(await page.evaluate(() => __qa.studio.journalError), true);
  assert.ok(await page.evaluate(() => localStorage.getItem('drummer.sessions.v1')));
  assert.equal(await page.evaluate(() => __qa.studio.flushJournal()), true);
  const result = await page.evaluate(async () => {
    __qa.studio.sessionCache.clear(); const [first, second] = await Promise.all([__qa.studio.loadSession('legacy'), __qa.studio.loadSession('legacy')]);
    return { legacy: localStorage.getItem('drummer.sessions.v1'), a: first.hits[0].timeMs, b: second.hits[0].timeMs };
  });
  assert.deepEqual(result, { legacy: null, a: -10, b: -10 });
}, [session('legacy')], () => {
  const original = IDBObjectStore.prototype.put; let fail = true;
  IDBObjectStore.prototype.put = function(...args) { const request = original.apply(this, args); if (fail && this.name === 'events') { fail = false; this.transaction.abort(); } return request; };
});

await scenario('Journal: a retained old legacy copy never overwrites newer IndexedDB audio on reload or export', async page => {
  await page.evaluate(async seed => {
    await __qa.studio.journal.put({ ...seed, hits: [{ ...seed.hits[0], timeMs: 123.456 }] });
    localStorage.setItem('drummer.sessions.v1', JSON.stringify([seed]));
  }, session('existing'));
  await page.reload(); await page.waitForFunction(() => !!globalThis.__qa); await page.evaluate(() => __qa.studio.journalReady);
  const result = await page.evaluate(async () => ({ displayed: (await __qa.studio.loadSession('existing')).hits[0].timeMs, exported: (await __qa.studio.exportSessions())[0].hits[0].timeMs }));
  assert.deepEqual(result, { displayed: 123.456, exported: 123.456 });
});

await scenario('Journal: two long performances exceed localStorage capacity and roundtrip through IndexedDB', async page => {
  const result = await page.evaluate(async seed => {
    const first = { ...seed, id: 'long1' }, second = { ...seed, id: 'long2' };
    await __qa.studio.journal.put(first); await __qa.studio.journal.put(second);
    const list = await __qa.studio.journal.list(), recovered = await __qa.studio.journal.get('long2');
    return { bytes: JSON.stringify([first, second]).length, legacy: localStorage.getItem('drummer.sessions.v1'), list: list.map(s => ({ id: s.id, raw: 'hits' in s, hits: s.hitCount })), last: recovered.hits.at(-1).timeMs };
  }, session('long', 40000));
  assert.ok(result.bytes > 5 * 1024 * 1024); assert.equal(result.legacy, null); assert.equal(result.list.length, 2);
  assert.ok(result.list.every(s => !s.raw && s.hits === 40000)); assert.equal(result.last, 39999 * 20 - 10);
});

await scenario('Restore: failed IDB transaction rolls back local settings and keeps previous raw sessions', async page => {
  const result = await page.evaluate(async seed => {
    const journal = __qa.studio.journal; await journal.put(seed);
    localStorage.setItem('trener.ritmovi.v1', 'old-library'); localStorage.setItem('drummer.favorites.v1', '["old"]');
    const oldPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { const request = oldPut.apply(this, args); if (this.name === 'events') this.transaction.abort(); return request; };
    let failed = false;
    try { await journal.restore([{ ...seed, id: 'new' }], { 'trener.ritmovi.v1': 'new-library', 'drummer.favorites.v1': '["new"]' }); }
    catch { failed = true; } finally { IDBObjectStore.prototype.put = oldPut; }
    return { failed, library: localStorage.getItem('trener.ritmovi.v1'), favorites: localStorage.getItem('drummer.favorites.v1'), sessions: (await journal.list()).map(s => s.id), oldHits: (await journal.get(seed.id)).hits.length };
  }, session('original'));
  assert.deepEqual(result, { failed: true, library: 'old-library', favorites: '["old"]', sessions: ['original'], oldHits: 2 });
});

await scenario('Restore: interrupted cross-store commit is recovered at next initialization', async page => {
  const result = await page.evaluate(async () => {
    const { JournalStore } = await import('/js/journal-store.js'); const name = 'qa-recovery';
    const before = new JournalStore({ name }); await before.ready;
    const transaction = before.db.transaction('meta', 'readwrite');
    transaction.objectStore('meta').put({ key: 'restorePending', previous: { 'drummer.favorites.v1': '["old"]' } });
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = reject; });
    localStorage.setItem('drummer.favorites.v1', '["interrupted"]'); before.db.close();
    const after = new JournalStore({ name }); await after.ready;
    const value = localStorage.getItem('drummer.favorites.v1'); after.db.close(); return value;
  });
  assert.equal(result, '["old"]');
});

await scenario('Restore: localStorage quota failure keeps the previous library and IndexedDB session', async page => {
  const result = await page.evaluate(async seed => {
    const journal = __qa.studio.journal; await journal.put(seed);
    localStorage.setItem('trener.ritmovi.v1', 'old-library'); localStorage.setItem('drummer.favorites.v1', '["old"]');
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'drummer.favorites.v1' && value === '["new"]') throw new DOMException('quota', 'QuotaExceededError'); return original.call(this, key, value); };
    let failed = false;
    try { await journal.restore([{ ...seed, id: 'new' }], { 'trener.ritmovi.v1': 'new-library', 'drummer.favorites.v1': '["new"]' }); }
    catch { failed = true; } finally { Storage.prototype.setItem = original; }
    return { failed, library: localStorage.getItem('trener.ritmovi.v1'), favorites: localStorage.getItem('drummer.favorites.v1'), ids: (await journal.list()).map(s => s.id) };
  }, session('original'));
  assert.deepEqual(result, { failed: true, library: 'old-library', favorites: '["old"]', ids: ['original'] });
});

await scenario('Backup: preview is read-only, keep-both remaps conflicts, successful apply restores raw events and routing', async page => {
  const incoming = { version: 2, ritmovi: [pattern], sessions: [session('imported')], programs: [], profiles: [], arrangements: [], favorites: [pattern.id],
    midiMap: { 38: 'snare' }, midiRouting: { inputs: [], outputs: {} }, podesavanja: {}, trenutni: pattern, language: 'en', arrangementDraft: { name: 'Restored draft', sections: [{ name: 'Verse', pattern, repeats: 3, bpm: 120 }] } };
  await page.evaluate(pattern => {
    const original = __qa.studio.host.getBackupState;
    __qa.studio.host.getBackupState = async () => ({ ...await original(), ritmovi: [{ ...pattern, name: 'Existing rhythm' }] });
    __qa.studio.host.applyRestoredState = async snapshot => { window.__restored = snapshot; };
  }, pattern);
  await page.locator('#appNav [data-section=settings]').click(); await page.locator('.subtabs [data-pane=app]').click();
  await page.locator('#backupRestoreFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
  await page.waitForFunction(() => !!__qa.studio.backupRestore.plan);
  assert.equal(await page.evaluate(() => __qa.studio.sessions.length), 0);
  await page.locator('#backupRestoreConflicts').selectOption('both');
  await page.locator('#backupRestoreSettings').check();
  await page.locator('#backupRestoreApply').click(); await page.waitForFunction(() => !!window.__restored);
  const result = await page.evaluate(async () => ({ count: __qa.studio.sessions.length, hit: (await __qa.studio.journal.get('imported')).hits[0].timeMs,
    draft: JSON.parse(localStorage.getItem('drummer.arrangementDraft.v1')).name, routing: JSON.parse(localStorage.getItem('drummer.midiRouting.v1')), library: JSON.parse(localStorage.getItem('trener.ritmovi.v1')) }));
  assert.equal(result.count, 1); assert.equal(result.hit, -10); assert.equal(result.draft, 'Restored draft'); assert.ok(result.routing);
  assert.equal(result.library.length, 2); assert.notEqual(result.library[0].id, result.library[1].id); assert.equal(result.library[0].name, 'Existing rhythm');
  await page.locator('#backupRestore').screenshot({ path: `${artifacts}/restore.png` });
});

await scenario('Arrangements: edit sections, meter and exact repeats, save, export and recover after reload', async page => {
  await page.locator('#appNav [data-section=practice]').click(); await page.locator('.subtabs [data-pane=arrangement]').click();
  await page.locator('#arrangementName').fill('Whole song'); await page.locator('#arrangementAdd').click();
  await page.locator('#arrangementSections [data-field=name]').fill('Intro'); await page.locator('#arrangementSections [data-field=name]').press('Tab');
  await page.locator('#arrangementSections [data-field=repeats]').fill('3'); await page.locator('#arrangementSections [data-field=repeats]').press('Tab');
  await page.locator('#arrangementSections [data-field=beats]').fill('7'); await page.locator('#arrangementSections [data-field=beats]').press('Tab');
  await page.locator('#arrangementSections [data-field=beatUnit]').selectOption('8');
  await page.locator('#arrangementSave').click(); const id = await page.locator('#arrangementSelect').inputValue(); assert.ok(id);
  const download = page.waitForEvent('download'); await page.locator('#arrangementExport').click(); assert.match((await download).suggestedFilename(), /aranzman/);
  await page.reload(); await page.waitForFunction(() => !!globalThis.__qa); await page.evaluate(() => __qa.studio.journalReady);
  await page.locator('#appNav [data-section=practice]').click(); await page.locator('.subtabs [data-pane=arrangement]').click(); await page.locator('#arrangementSelect').selectOption(id);
  assert.equal(await page.locator('#arrangementSections [data-field=repeats]').inputValue(), '3'); assert.equal(await page.locator('#arrangementSections [data-field=beatUnit]').inputValue(), '8');
  assert.equal(await page.locator('#arrangementName').inputValue(), 'Whole song');
  await page.locator('#studio-arrangement').screenshot({ path: `${artifacts}/arrangement.png` });
});

await scenario('Arrangements: two different meters and tempos play exact bar counts on one gapless audio clock', async page => {
  await page.evaluate(async () => {
    const { blankPattern } = await import('/js/patterns.js');
    const first = blankPattern({ name: 'Intro', bars: 1, beats: 2, beatUnit: 4, bpm: 240 }); first.steps.snare.fill(2);
    const second = blankPattern({ name: 'Chorus', bars: 1, beats: 7, beatUnit: 8, bpm: 210 }); second.steps.hh.fill(2);
    __qa.studio.arrangements.draft = { name: 'Exact song', sections: [{ name: 'Intro', pattern: first, repeats: 2, bpm: 240 }, { name: 'Chorus', pattern: second, repeats: 1, bpm: 210 }] };
    Object.assign(__qa.settings, { countIn: true, metro: false, playPattern: true, loop: false });
    window.__arrAudio = []; window.__arrClicks = [];
    const original = __qa.audio.play.bind(__qa.audio), click = __qa.audio.click.bind(__qa.audio);
    __qa.audio.play = (...args) => { if (args[3] === 'pattern') __arrAudio.push({ inst: args[0], time: args[1] }); return original(...args); };
    __qa.audio.click = (...args) => { __arrClicks.push(args[0]); return click(...args); };
    await __qa.studio.startArrangement();
  });
  await page.waitForFunction(() => !!__qa.play.nextSection);
  await page.evaluate(() => __qa.onHit('hh', 92, __qa.play.nextSection.perf - 10, 'midi', 42));
  await page.waitForFunction(() => !__qa.play.on && !__qa.studio.run && __qa.studio.sessions.length === 2);
  const result = await page.evaluate(async () => ({ audio: __arrAudio, clicks: __arrClicks, sessions: (await __qa.studio.exportSessions()).sort((a, b) => a.routine.index - b.routine.index) }));
  assert.equal(result.clicks.length, 2, 'only the first section has count-in');
  assert.equal(result.audio.length, 30, 'no repeated or omitted transition notes');
  for (let i = 0; i < 16; i++) { assert.equal(result.audio[i].inst, 'snare'); assert.ok(Math.abs(result.audio[i].time - result.audio[0].time - i * .0625) < 1e-7); }
  for (let i = 0; i < 14; i++) { assert.equal(result.audio[i + 16].inst, 'hh'); assert.ok(Math.abs(result.audio[i + 16].time - result.audio[0].time - 1 - i / 14) < 1e-7); }
  assert.deepEqual(result.sessions.map(s => Math.round(s.durationMs)), [1000, 1000]);
  assert.deepEqual(result.sessions.map(s => s.expected.length), [16, 14]);
  assert.deepEqual(result.sessions.map(s => s.passes.length), [2, 1]);
  assert.equal(result.sessions[0].hits.length, 0);
  assert.equal(result.sessions[1].hits.length, 1); assert.equal(result.sessions[1].hits[0].kind, 'good');
  assert.ok(Math.abs(result.sessions[1].hits[0].err + 10) < 1e-7); assert.ok(Math.abs(result.sessions[1].hits[0].timeMs + 10) < 1e-7);
});

await browser.close(); await writeFile(`${artifacts}/results.json`, JSON.stringify(results, null, 2));
if (results.some(r => r.status === 'FAIL')) process.exitCode = 1;
