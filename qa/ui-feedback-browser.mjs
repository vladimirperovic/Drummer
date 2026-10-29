import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const lib = async page => { await page.locator('#appNav [data-section=library]').click(); await page.locator('.subtabs [data-pane=library]').click(); };

const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const bridge = `;globalThis.__feedbackQA = { kit, play, settings, scorer, studio, start, stop, onHit, showLastHit, get pattern() { return pattern; }, get dirty() { return dirty; } };`;
let failures = 0;
async function scenario(name, run) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (localStorage.getItem('drummer.language.v1') == null) localStorage.setItem('drummer.language.v1', 'sr');
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => ({ inputs: new Map(), outputs: new Map() }) });
  });
  await page.route('**/js/main.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + bridge });
  });
  try {
    await page.goto(base); await page.waitForFunction(() => !!globalThis.__feedbackQA);
    await run(page); assert.deepEqual(errors, []); console.log('PASS ' + name);
  } catch (error) { failures++; console.error('FAIL ' + name + ': ' + error.stack); }
  finally { await context.close(); }
}

await scenario('Tempo controls, top hit feedback and score picker work at desktop and phone widths', async page => {
  const before = Number(await page.locator('#bpm').inputValue());
  for (const step of [1, 5, -1, -5]) await page.locator(`[data-bpm="${step}"]`).click();
  assert.equal(Number(await page.locator('#bpm').inputValue()), before);
  await page.keyboard.press('KeyU');
  assert.match(await page.locator('.bar #lastHit').textContent(), /Crash 2 · jačina 92/);
  await page.evaluate(() => __feedbackQA.showLastHit('crash2', 92, { kind: 'extra' }));
  assert.match(await page.locator('#lastHit').textContent(), /višak/);
  assert.equal(await page.locator('#lastHit').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 19), true);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#importSong').click();
  const chooser = await chooserPromise;
  assert.equal(await chooser.element().getAttribute('id'), 'scoreFile');
  assert.equal(await chooser.element().getAttribute('accept'), '.musicxml,.xml,.mxl');
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no overflow at ${width}`);
    assert.ok(await page.locator('.tbtn').evaluateAll(nodes => nodes.every(el => el.getBoundingClientRect().width >= 44 && el.getBoundingClientRect().height >= 44)));
  }
});

await scenario('Search: Ctrl+K finds settings, toggles header options and loads patterns', async page => {
  await page.keyboard.press('Control+k'); await page.locator('#commandSearchInput').fill('kalib');
  await page.keyboard.press('Enter'); await page.locator('#calib').waitFor();
  assert.equal(await page.locator('#commandSearch').evaluate(dialog => dialog.open), false);
  await page.locator('#searchOpen').click(); await page.locator('#commandSearchInput').fill('metronom');
  const before = await page.locator('#metro').isChecked(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#metro').isChecked(), !before);
  await page.keyboard.press('Control+k'); await page.locator('#commandSearchInput').fill('bossa nova'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Bossa nova/.test(document.querySelector('#patternName').textContent));
  await page.setViewportSize({ width: 375, height: 812 }); assert.ok(await page.locator('#searchOpen').isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
});

await scenario('Editor stays locked after opening during playback; first early note is scored', async page => {
  await page.locator('#countIn').uncheck(); await page.locator('#metro').uncheck();
  await page.locator('#playBtn').click();
  await page.waitForFunction(() => __feedbackQA.scorer.pending.length > 0);
  const early = await page.evaluate(() => {
    const qa = __feedbackQA;
    qa.onHit('kick', 92, qa.play.firstPerf - 10);
    return qa.scorer.results.find(r => r.inst === 'kick');
  });
  assert.equal(early.kind, 'good'); assert.ok(Math.abs(early.err + 10) < .01);
  await page.locator('#appNav [data-section=editor]').click();
  const cell = page.locator('#grid .cell[data-inst=snare][data-slot="0"]');
  assert.equal(await cell.isDisabled(), true);
  const before = await cell.getAttribute('data-v');
  await cell.dispatchEvent('click'); await cell.dispatchEvent('contextmenu');
  assert.equal(await cell.getAttribute('data-v'), before);
  assert.equal(await page.locator('#importSong').isDisabled(), true);
  await page.locator('#playBtn').click();
  assert.equal(await cell.isEnabled(), true);
  assert.equal(await page.locator('#importSong').isEnabled(), true);
});

await scenario('Unsaved draft remains dirty across reload and cannot be silently replaced', async page => {
  await page.locator('#appNav [data-section=editor]').click();
  await page.locator('#grid .cell[data-inst=snare][data-slot="0"]').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('trener.podesavanja.v1'))?.currentDirty === true);
  await page.reload(); await page.waitForFunction(() => !!globalThis.__feedbackQA);
  assert.equal(await page.evaluate(() => __feedbackQA.dirty), true);
  assert.equal(await page.evaluate(() => __feedbackQA.pattern.steps.snare[0]), 2);
  await page.locator('#appNav [data-section=library]').click(); await page.locator('.subtabs [data-pane=library]').click();
  const dialogPromise = page.waitForEvent('dialog');
  const click = page.locator('#presets .load').first().click();
  const dialog = await dialogPromise; assert.match(dialog.message(), /nesačuvan/);
  await dialog.dismiss(); await click;
  assert.equal(await page.evaluate(() => __feedbackQA.pattern.steps.snare[0]), 2);
});

await scenario('Stopping notes-only practice reveals its notation report', async page => {
  await page.locator('#countIn').uncheck(); await page.locator('#metro').uncheck();
  await page.locator('#playBtn').click();
  await page.waitForFunction(() => __feedbackQA.play.cur?.n >= 0);
  await page.locator('#scoreOnly').check();
  assert.equal(await page.locator('body').evaluate(node => node.classList.contains('notes-only')), true);
  await page.locator('#playBtn').click();
  assert.equal(await page.locator('body').evaluate(node => node.classList.contains('notes-only')), false);
  assert.equal(await page.locator('#performanceReport').isVisible(), true);
});

await scenario('2D hit paint remains confined to each pad even without the image mask', async page => {
  const areas = await page.evaluate(async () => {
    const { KIT_ART } = await import('/js/kit-art-data.js');
    const overlays = [...document.querySelectorAll('#kit2dHost .overlay')];
    return overlays.map(node => {
      // Simulate a lost SVG image mask: the geometry itself must stay bounded.
      node.removeAttribute('mask');
      const box = node.getBBox();
      return { id: node.dataset.pad, ratio: box.width * box.height / (KIT_ART.width * KIT_ART.height) };
    });
  });
  assert.equal(areas.length, 12);
  for (const area of areas) assert.ok(area.ratio < .1, `${area.id} paints only its own surface: ${area.ratio}`);
  await page.evaluate(() => { for (let i = 0; i < 100; i++) { __feedbackQA.kit.hit('crash2', 'extra'); __feedbackQA.kit.pulse('snare'); } });
  assert.ok(await page.locator('.overlay').evaluateAll(nodes => nodes.every(node => node.getAnimations().length <= 1)));
  await page.waitForTimeout(500);
  assert.ok(await page.locator('.overlay').evaluateAll(nodes => nodes.every(node => node.getAnimations().length === 0)));
});

await browser.close();
if (failures) process.exitCode = 1;
