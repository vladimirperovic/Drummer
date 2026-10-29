import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PRESETS } from '../js/patterns.js';

const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123', channel = process.env.DRUMMER_BROWSER || '';
const artifacts = fileURLToPath(new URL(`./artifacts/library/${channel || 'chromium'}/`, import.meta.url));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}), args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
const results = [], filter = process.env.DRUMMER_CASE ? new RegExp(process.env.DRUMMER_CASE) : null;
const bridge = '\nglobalThis.__qa = { agentTools, audio, settings, play, studio, loadPattern, markDirty, get pattern() { return pattern; } };';
const call = (p, name, args = {}) => p.evaluate(async ({ name, args }) => globalThis.__registered.get('drummer_' + name).execute(args), { name, args });
async function scenario(name, fn, options = {}) {
  if (filter && !filter.test(name)) return;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: options.offline ? 'allow' : 'block' });
  const p = await context.newPage(), errors = [], networkErrors = []; p.setDefaultTimeout(8000);
  p.on('pageerror', e => errors.push(e.message));
  p.on('requestfailed', r => networkErrors.push({ url: r.url(), error: r.failure()?.errorText }));
  p.on('console', message => { if (message.type() === 'error') networkErrors.push({ console: message.text() }); });
  await p.addInitScript(({ initial, unsupported, rejectRegistration }) => {
    if (localStorage.getItem('drummer.language.v1') == null) localStorage.setItem('drummer.language.v1', 'sr');
    if (!sessionStorage.getItem('qa-seeded')) {
      for (const [key, value] of Object.entries(initial || {})) localStorage.setItem(key, key === 'drummer.language.v1' ? value : JSON.stringify(value));
      sessionStorage.setItem('qa-seeded', 'yes');
    }
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => ({ inputs: new Map(), outputs: new Map() }) });
    globalThis.__registered = new Map();
    Object.defineProperty(document, 'modelContext', { configurable: true, value: unsupported ? undefined : {
      registerTool(tool) { if (rejectRegistration) throw Error('registration denied'); __registered.set(tool.name, tool); },
      unregisterTool(name) { __registered.delete(name); },
    } });
    if (unsupported) Object.defineProperty(navigator, 'modelContext', { configurable: true, value: undefined });
  }, options);
  if (!options.offline) await p.route('**/js/main.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + bridge }); });
  try {
    await p.goto(base); await p.locator('#presets .load').first().waitFor({ state: 'attached' });
    // A click unlocks browser audio, so scenarios about the locked state start on the home screen.
    if (!options.home) await openLibrary(p);
    await fn(p, context); assert.deepEqual(errors, [], 'uncaught page errors');
    results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`);
  } catch (e) {
    const screenshot = `failure-${results.length + 1}.png`; await p.screenshot({ path: artifacts + screenshot }).catch(() => {});
    results.push({ name, status: 'FAIL', error: e.stack, errors, networkErrors, screenshot }); console.log(`FAIL ${name}: ${e.message}`);
  } finally { await context.close(); }
}
const star = (p, id) => p.locator(`.favorite[data-pattern-id="${id}"]`);
const openLibrary = async p => { await p.locator('#appNav [data-section=library]').click(); await p.locator('.subtabs [data-pane=library]').click(); };
const firstId = PRESETS[0].id;

await scenario('Library: pagination reaches all 94 unique presets; category and search reset pages', async p => {
  const ids = [];
  for (let page = 1; page <= 5; page++) {
    assert.match(await p.locator('#presetsPageInfo').innerText(), new RegExp(`${page} / 5`));
    ids.push(...await p.locator('#presets .load').evaluateAll(nodes => nodes.map(n => n.dataset.presetId)));
    if (page < 5) await p.locator('#presetsNext').click();
  }
  assert.deepEqual(ids, PRESETS.map(p => p.id)); assert.ok(await p.locator('#presetsNext').isDisabled());
  assert.equal(await p.locator('#presets .load').count(), 14);
  await p.locator('#presetCategory').selectOption('jazz'); assert.match(await p.locator('#presetsPageInfo').innerText(), /1 \/ 1/);
  assert.equal(await p.locator('#presets .load').count(), 20); assert.ok(await p.locator('#presetsPager').isHidden());
  await p.locator('#presetSearch').fill('offbeat'); assert.equal(await p.locator('#presets .load').count(), 1); assert.ok(await p.locator('#presetsPager').isHidden());
  await p.locator('#presetSearch').fill('no match'); assert.match(await p.locator('#presetCount').innerText(), /0–0 \/ 0/);
  await p.locator('#presetSearch').fill(''); assert.match(await p.locator('#presetsPageInfo').innerText(), /1 \/ 1/);
});
await scenario('Library: starring does not load or edit a rhythm; favorites and filter survive reload', async p => {
  const before = await call(p, 'get_pattern'), id = PRESETS[2].id;
  await star(p, id).click(); assert.equal(await star(p, id).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await call(p, 'get_pattern'), before); assert.equal((await call(p, 'get_state')).unsavedPattern, false);
  await p.locator('#favoritesOnly').click(); assert.equal(await p.locator('#presets .load').count(), 1);
  await p.waitForTimeout(250); await p.reload(); await openLibrary(p); await star(p, id).waitFor();
  assert.equal(await p.locator('#favoritesOnly').getAttribute('aria-pressed'), 'true'); assert.equal(await p.locator('#favoriteCount').innerText(), '1');
  await star(p, id).click(); assert.equal(await p.locator('#presets .load').count(), 0); assert.ok(await p.locator('#favoritesEmpty').isVisible());
  assert.equal(await p.evaluate(() => document.activeElement.id), 'favoritesOnly');
  await p.locator('#favoritesOnly').click(); assert.equal(await p.locator('#presets .load').count(), 20);
});
await scenario('Library: saved favorites retain IDs through renaming; copies are separate and deletion clears favorite', async p => {
  await star(p, 'saved-0').click();
  await p.locator('#mine .load').first().click(); await p.locator('#appNav [data-section=editor]').click();
  await p.locator('#edName').fill('Ritam Favorite Rock'); await p.locator('#edName').dispatchEvent('change'); await openLibrary(p); await p.locator('#saveBtn').click();
  assert.equal(await star(p, 'saved-0').getAttribute('aria-pressed'), 'true');
  await p.locator('#mine .item').first().getByRole('button', { name: 'Dupliraj', exact: true }).click();
  assert.equal(await p.locator('#favoriteCount').innerText(), '1'); assert.equal(await p.locator('#mine .favorite').nth(1).getAttribute('aria-pressed'), 'false');
  p.once('dialog', d => d.accept()); await p.locator('#mine .item').first().getByRole('button', { name: 'Obriši', exact: true }).click();
  assert.equal(await p.locator('#favoriteCount').innerText(), '0');
  assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('drummer.favorites.v1'))), []);
}, { initial: { 'trener.ritmovi.v1': [{ ...PRESETS[0], id: 'saved-0', name: 'My pattern', preset: false }] } });
await scenario('Library: favorites pagination clamps after removal and saved patterns paginate independently', async p => {
  await p.locator('#mineNext').click(); assert.equal(await p.locator('#mine .load').count(), 1);
  await p.locator('#favoritesOnly').click(); assert.match(await p.locator('#minePageInfo').innerText(), /1 \/ 2/);
  await p.locator('#presetsNext').click(); await p.locator('#presetsNext').click();
  assert.equal(await p.locator('#presets .favorite').count(), 1); await p.locator('#presets .favorite').click();
  assert.match(await p.locator('#presetsPageInfo').innerText(), /2 \/ 2/); assert.equal(await p.locator('#presets .load').count(), 20);
  assert.ok(await p.locator('#presetsNext').isDisabled()); assert.match(await p.locator('#minePageInfo').innerText(), /1 \/ 2/);
}, { initial: { 'trener.ritmovi.v1': Array.from({ length: 21 }, (_, i) => ({ ...PRESETS[0], id: `saved-${i}`, name: `Saved ${i}`, preset: false })),
  'drummer.favorites.v1': [...PRESETS.slice(0, 41).map(p => p.id), ...Array.from({ length: 21 }, (_, i) => `saved-${i}`)] } });
await scenario('Library: keyboard stars do not start playback; SR/EN labels and mobile layout fit', async p => {
  await star(p, firstId).focus(); await star(p, firstId).press('Space');
  assert.equal(await star(p, firstId).getAttribute('aria-pressed'), 'true'); assert.equal((await call(p, 'get_state')).playing, false);
  await p.locator('#languageSelect').selectOption('en');
  assert.match(await star(p, firstId).getAttribute('aria-label'), /Remove from favorites/);
  assert.match(await p.locator('#presetsPageInfo').innerText(), /Page 1 \/ 5/);
  await p.locator('#panel-library').screenshot({ path: artifacts + 'library-en.png' });
  for (const width of [768, 390, 360]) { await p.setViewportSize({ width, height: 844 }); assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
  await p.locator('#panel-library').screenshot({ path: artifacts + 'library-phone.png' });
  await p.locator('#languageSelect').selectOption('sr'); assert.match(await star(p, firstId).getAttribute('aria-label'), /Ukloni iz favorita/);
});
await scenario('Library: failed storage leaves favorite unchanged and reports an actionable warning', async p => {
  await p.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (k === 'drummer.favorites.v1') throw Error('Quota'); return original.call(this, k, v); }; });
  await star(p, firstId).click(); assert.equal(await star(p, firstId).getAttribute('aria-pressed'), 'false');
  assert.equal(await p.locator('#favoriteCount').innerText(), '0'); assert.ok(await p.locator('#storageWarning').isVisible());
  assert.equal((await call(p, 'set_favorite', { id: firstId, favorite: true })).error.code, 'STORAGE_FAILED');
});
await scenario('MCP: all tools register; live catalog pagination, favorites and note reads agree with UI', async p => {
  assert.equal(await p.evaluate(() => __registered.size), 13);
  const list = await call(p, 'list_patterns', { category: 'latin', offset: 12, limit: 12 }); assert.equal(list.total, 20); assert.equal(list.patterns.length, 8);
  assert.equal((await call(p, 'set_favorite', { id: firstId, favorite: true })).ok, true);
  assert.equal(await star(p, firstId).getAttribute('aria-pressed'), 'true');
  const fav = await call(p, 'list_patterns', { favoritesOnly: true }); assert.equal(fav.total, 1); assert.equal(fav.patterns[0].favorite, true);
  assert.deepEqual((await call(p, 'get_pattern', { id: firstId })).pattern.steps, PRESETS[0].steps);
  await p.locator('#appNav [data-section=settings]').click(); await p.locator('.subtabs [data-pane=app]').click();
  assert.match(await p.locator('#mcpStatus').innerText(), /spreman/); assert.equal(await p.locator('#mcpToolCount').innerText(), '13');
  await p.locator('#tool-mcp').screenshot({ path: artifacts + 'mcp-panel.png' });
});
await scenario('MCP: pattern, tempo, options, focus, view and language update real application controls', async p => {
  const id = PRESETS.find(p => p.category === 'three-eight').id;
  assert.equal((await call(p, 'load_pattern', { id })).pattern.id, id);
  assert.equal((await call(p, 'set_tempo', { bpm: 112 })).pattern.bpm, 112); assert.equal(await p.locator('#bpm').inputValue(), '112');
  assert.equal((await call(p, 'set_options', { metro: false, countIn: false, playPattern: true })).ok, true); assert.equal(await p.locator('#metro').isChecked(), false);
  assert.equal((await call(p, 'set_focus', { enabled: true, from: 1, to: 1, instruments: ['snare'] })).focus.enabled, true);
  assert.equal((await call(p, 'set_view', { view: 'editor', panel: 'stats', rows: 2, notesOnly: true })).view.notesOnly, true);
  assert.ok(await p.locator('.lower').isHidden()); await call(p, 'set_view', { notesOnly: false, kitView: '3d', view: 'kit' });
  assert.ok(await p.locator('#kit3dHost canvas').isVisible());
  await call(p, 'set_language', { language: 'en' }); assert.equal(await p.locator('#languageSelect').inputValue(), 'en');
  assert.equal(await p.locator('#kitReset').innerText(), 'Reset view');
});
await scenario('MCP: bounded playback creates one journal entry; stop and repeated start are safe', async p => {
  assert.equal((await call(p, 'start')).error.code, 'AUDIO_LOCKED');
  await p.evaluate(async () => __qa.audio.ensure()); await call(p, 'set_options', { countIn: false, playPattern: true });
  assert.equal((await call(p, 'start', { durationSeconds: 1 })).playing, true);
  assert.equal((await call(p, 'start')).playing, true); assert.equal((await call(p, 'set_options', { loop: false })).error.code, 'BUSY');
  await p.waitForFunction(() => !__qa.play.on && __qa.studio.sessions.length === 1);
  const result = await call(p, 'get_results', { limit: 1 }); assert.equal(result.sessionCount, 1); assert.equal(result.recent.length, 1);
  assert.ok(!('hits' in result.recent[0]) && !('timeline' in result.recent[0]));
  await call(p, 'stop'); assert.equal((await call(p, 'get_results')).sessionCount, 1);
}, { home: true });
await scenario('MCP: dirty edits stay intact, invalid calls do not mutate and disabling survives reload', async p => {
  await p.locator('#appNav [data-section=editor]').click(); await p.locator('#edName').fill('Unsaved test'); await p.locator('#edName').dispatchEvent('change');
  assert.equal((await call(p, 'load_pattern', { id: PRESETS[1].id })).error.code, 'UNSAVED_EDITS');
  assert.equal(await p.locator('#edName').inputValue(), 'Unsaved test');
  assert.equal((await call(p, 'set_tempo', { bpm: 999 })).error.code, 'INVALID_ARGUMENT');
  await p.locator('#appNav [data-section=settings]').click(); await p.locator('.subtabs [data-pane=app]').click(); await p.locator('#mcpEnabled').uncheck();
  assert.equal((await call(p, 'get_state')).error.code, 'DISABLED'); await p.waitForTimeout(250);
  p.on('dialog', d => d.accept()); await p.reload(); await p.locator('#presets .load').first().waitFor({ state: 'attached' }); await openLibrary(p);
  assert.equal((await call(p, 'set_tempo', { bpm: 100 })).error.code, 'DISABLED');
});
await scenario('MCP: unsupported browser keeps ordinary controls usable and displays guidance', async p => {
  await star(p, firstId).click(); await p.locator('#presetsNext').click();
  await p.locator('#appNav [data-section=settings]').click(); await p.locator('.subtabs [data-pane=app]').click();
  assert.match(await p.locator('#mcpStatus').innerText(), /nema podršku/); assert.equal(await p.locator('#favoriteCount').innerText(), '1');
}, { unsupported: true });
await scenario('MCP: registration failure is shown without breaking the rhythm library', async p => {
  await p.locator('#appNav [data-section=settings]').click(); await p.locator('.subtabs [data-pane=app]').click();
  assert.match(await p.locator('#mcpStatus').innerText(), /nije mogao/); await openLibrary(p); await p.locator('#presetsNext').click();
  assert.match(await p.locator('#presetsPageInfo').innerText(), /2 \/ 5/);
}, { rejectRegistration: true });
await scenario('Library: favorites and pagination work offline and survive offline reload', async (p, context) => {
  await p.evaluate(async () => navigator.serviceWorker.ready); await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true); await p.reload(); await openLibrary(p); await star(p, firstId).click();
  await p.locator('#presetsNext').click(); assert.match(await p.locator('#presetsPageInfo').innerText(), /2 \/ 5/);
  await p.reload(); await openLibrary(p); await star(p, firstId).waitFor(); assert.equal(await star(p, firstId).getAttribute('aria-pressed'), 'true');
  await p.locator('#favoritesOnly').click(); assert.equal(await p.locator('#presets .load').count(), 1);
  assert.equal((await call(p, 'list_patterns', { favoritesOnly: true })).total, 1);
}, { offline: true });

const report = { browser: channel || 'Chromium', browserVersion: browser.version(), generatedAt: new Date().toISOString(), passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length, results };
await browser.close(); await writeFile(artifacts + 'results.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, failed: report.failed })); process.exitCode = report.failed ? 1 : 0;
