import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123', channel = process.env.DRUMMER_BROWSER || '';
const artifacts = fileURLToPath(new URL(`./artifacts/editor-next/${channel || 'chromium'}/`, import.meta.url));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [], filter = process.env.DRUMMER_CASE ? new RegExp(process.env.DRUMMER_CASE) : null;
const bridge = '\nglobalThis.__editorQA = { get tools() { return editorTools; }, get pattern() { return pattern; }, get dirty() { return dirty; }, blankPattern, loadPattern, settings, play, start, stop, onHit };';
async function scenario(name, fn) {
  if (filter && !filter.test(name)) return;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept(dialog.type() === 'prompt' ? 'History saved pattern' : undefined));
  await page.addInitScript(() => {
    localStorage.setItem('drummer.language.v1', 'en');
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => ({ inputs: new Map(), outputs: new Map() }) });
  });
  await page.route('**/js/main.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + bridge }); });
  try {
    await page.goto(base); await page.locator('#presets .load').first().waitFor({ state: 'attached' });
    await page.waitForFunction(() => globalThis.__editorQA?.tools);
    await page.locator('#appNav [data-section=editor]').click();
    await page.evaluate(() => __editorQA.loadPattern(__editorQA.blankPattern({ bars: 2, name: 'Editor test' })));
    await fn(page); assert.deepEqual(errors, []);
    results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`);
  } catch (error) {
    await page.screenshot({ path: artifacts + `failure-${results.length + 1}.png` }).catch(() => {});
    results.push({ name, status: 'FAIL', error: error.stack, errors }); console.log(`FAIL ${name}: ${error.message}`);
  } finally { await context.close(); }
}
const cell = (page, slot, inst = 'snare') => page.locator(`#grid .cell[data-inst="${inst}"][data-slot="${slot}"]`);
const state = page => page.evaluate(() => structuredClone(__editorQA.pattern));

await scenario('Editor: undo/redo, save-as reset and ordinary save keep a correct dirty marker', async page => {
  await cell(page, 0).click(); assert.equal((await state(page)).steps.snare[0], 2);
  await page.keyboard.press('Control+z'); assert.equal((await state(page)).steps.snare[0], 0);
  await page.keyboard.press('Control+Shift+z'); assert.equal((await state(page)).steps.snare[0], 2);
  await page.locator('#quickSave').click(); assert.equal(await page.evaluate(() => __editorQA.dirty), false);
  assert.equal(await page.locator('#quickSave').isVisible(), false);
  assert.equal(await page.locator('#editorUndo').isEnabled(), false);
  await cell(page, 0).click(); assert.equal((await state(page)).steps.snare[0], 3);
  await page.locator('#appNav [data-section=library]').click(); await page.locator('#saveBtn').click(); await page.locator('#appNav [data-section=editor]').click(); assert.equal(await page.evaluate(() => __editorQA.dirty), false);
  await page.locator('#editorUndo').click(); assert.equal((await state(page)).steps.snare[0], 2); assert.ok(await page.evaluate(() => __editorQA.dirty));
  await page.locator('#editorRedo').click(); assert.equal((await state(page)).steps.snare[0], 3); assert.equal(await page.evaluate(() => __editorQA.dirty), false);
});

await scenario('Editor: pointer drag is one undo, individual clicks are separate and Escape cancels a stroke', async page => {
  await cell(page, 0).scrollIntoViewIfNeeded();
  const start = await cell(page, 0).boundingBox(), end = await cell(page, 4).boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 }); await page.mouse.up();
  assert.deepEqual((await state(page)).steps.snare.slice(0, 5), [2, 2, 2, 2, 2]);
  assert.equal(await page.evaluate(() => __editorQA.tools.history.past.length), 1);
  await page.locator('#editorUndo').click(); assert.equal((await state(page)).steps.snare.some(Boolean), false);
  await page.locator('#editorRedo').click(); await cell(page, 8).click();
  assert.equal(await page.evaluate(() => __editorQA.tools.history.past.length), 2);
  await cell(page, 1).click({ button: 'right' }); assert.equal((await state(page)).steps.snare[1], 0);
  const cancel = await cell(page, 10).boundingBox(); await page.mouse.move(cancel.x + cancel.width / 2, cancel.y + cancel.height / 2); await page.mouse.down();
  await page.keyboard.press('Escape'); await page.mouse.up(); assert.equal((await state(page)).steps.snare[10], 0);
});

await scenario('Editor: recording enabled during playback groups all recorded hits into one undo', async page => {
  await page.evaluate(async () => { __editorQA.settings.countIn = false; await __editorQA.start(); });
  await page.waitForFunction(() => __editorQA.play.cur && __editorQA.play.cur.n >= 0);
  await page.locator('#record').check();
  await page.evaluate(() => {
    const first = __editorQA.play.firstPerf;
    for (let index = 0; index < 5; index++) __editorQA.onHit('snare', index % 2 ? 40 : 122, first + index * 180, 'midi', 38);
    __editorQA.stop();
  });
  assert.ok((await state(page)).steps.snare.filter(Boolean).length > 1);
  assert.equal(await page.evaluate(() => __editorQA.tools.history.past.length), 1);
  await page.locator('#appNav [data-section=editor]').click();
  await page.locator('#editorUndo').click(); assert.equal((await state(page)).steps.snare.some(Boolean), false);
});

await scenario('Editor: metadata focus groups typing and structure/clear can be undone', async page => {
  const original = (await state(page)).name;
  await page.locator('#edName').fill(''); await page.locator('#edName').pressSequentially('Renamed practice');
  await page.locator('#editorUndo').click(); assert.equal((await state(page)).name, original);
  await page.locator('#editorRedo').click(); assert.equal((await state(page)).name, 'Renamed practice');
  await page.locator('#edBars').selectOption('3'); assert.equal((await state(page)).bars, 3);
  await page.locator('#editorUndo').click(); assert.equal((await state(page)).bars, 2);
  await cell(page, 0).click(); await page.locator('#edClear').click(); assert.equal((await state(page)).steps.snare[0], 0);
  await page.locator('#editorUndo').click(); assert.equal((await state(page)).steps.snare[0], 2);
});

await scenario('Editor: selected bars paste their dynamics and hands, extend the rhythm and undo together', async page => {
  await page.evaluate(() => {
    const p = __editorQA.blankPattern({ bars: 3, sticking: 'RL'.repeat(24) });
    p.steps.snare[0] = 1; p.steps.tom1[18] = 3; __editorQA.loadPattern(p);
  });
  await page.locator('#editorCopyFrom').fill('1'); await page.locator('#editorCopyTo').fill('2'); await page.locator('#editorCopySelection').click();
  await page.locator('#editorPasteAt').fill('4'); await page.locator('#editorPasteSelection').click();
  const pasted = await state(page); assert.equal(pasted.bars, 5); assert.equal(pasted.steps.snare[48], 1); assert.equal(pasted.steps.tom1[66], 3); assert.equal(pasted.sticking.slice(48), 'RL'.repeat(16));
  await page.locator('#editorUndo').click(); assert.equal((await state(page)).bars, 3);
  await page.locator('#edBeats').selectOption('3'); const before = JSON.stringify(await state(page)); await page.locator('#editorPasteSelection').click();
  assert.equal(JSON.stringify(await state(page)), before);
});

await scenario('Editor: configurable generator previews without edits, applies one undo and locks during playback', async page => {
  const original = await state(page); await page.locator('#exerciseGenerator summary').click();
  await page.locator('#generatorKind').selectOption('fill'); await page.locator('#generatorSticking').fill('RLRRLRLL');
  await page.locator('#generatorOrchestration').selectOption('around'); await page.locator('#generatorDifficulty').selectOption('hard'); await page.locator('#generatorBars').fill('2');
  await page.locator('#generatorVariation').click(); assert.ok(await page.locator('#generatorPreview svg').count());
  assert.deepEqual(await state(page), original); await page.locator('#generatorApply').click();
  const generated = await state(page); assert.equal(generated.bars, 2); assert.ok(Object.values(generated.steps).flat().filter(Boolean).length > 8);
  assert.ok(generated.steps.tom1.some(Boolean)); await page.locator('#editorUndo').click(); assert.deepEqual(await state(page), original);
  await page.evaluate(async () => { __editorQA.settings.countIn = false; await __editorQA.start(); });
  assert.equal(await page.locator('#generatorApply').isEnabled(), false); assert.equal(await page.locator('#editorPasteSelection').isEnabled(), false);
  await page.evaluate(() => __editorQA.stop());
});

await scenario('Editor: English/Serbian controls and generator fit a phone viewport', async page => {
  assert.equal(await page.locator('#editorUndo').textContent(), 'Undo');
  await page.locator('#languageSelect').selectOption('sr'); await page.waitForFunction(() => document.querySelector('#editorUndo').textContent === 'Poništi');
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#exerciseGenerator summary').click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.locator('#editorNextTools').screenshot({ path: artifacts + 'editor-phone.png' });
});

await browser.close(); await writeFile(artifacts + 'results.json', JSON.stringify({ results }, null, 2));
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
