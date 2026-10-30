import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const channel = process.env.DRUMMER_BROWSER || '';
const artifacts = process.env.DRUMMER_ARTIFACTS ? process.env.DRUMMER_ARTIFACTS.replace(/[\\/]?$/, '/') : fileURLToPath(new URL(`./artifacts/score-view/${channel || 'chromium'}/`, import.meta.url));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
const bridge = '\nglobalThis.__scoreQA = { settings, play, start, stop, loadPattern, workspaceView, get notation() { return notation; }, get pattern() { return pattern; } };';
async function scenario(name, fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => ({ inputs: new Map(), outputs: new Map() }) }));
  await page.route('**/js/main.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + bridge }); });
  try {
    await page.goto(base); await page.locator('#presets .load').first().waitFor({ state: 'attached' });
    await page.evaluate(async () => {
      const { blankPattern } = await import('/js/patterns.js');
      const pattern = blankPattern({ bars: 8, bpm: 180 });
      pattern.steps.snare.fill(2); pattern.steps.kick[0] = 2;
      __scoreQA.loadPattern(pattern);
    });
    await fn(page);
    assert.deepEqual(errors, []);
    results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`);
  } catch (error) {
    await page.screenshot({ path: artifacts + `failure-${results.length + 1}.png` }).catch(() => {});
    results.push({ name, status: 'FAIL', error: error.stack, errors }); console.log(`FAIL ${name}: ${error.message}`);
  } finally { await context.close(); }
}
const zoom = async (page, value) => {
  await page.locator('#scoreScale').fill(String(value));
  await page.waitForFunction(value => document.querySelector('#scoreScaleValue').textContent === `${value}%`
    && Math.abs(__scoreQA.notation.geometry.scale - value * .015) < 1e-6, value);
};
const notationSnapshot = async (page, zoom) => {
  // Resolve the current head and measure it in one browser task. A locator's
  // boundingBox can retain a head that a queued resize/RAF render has detached.
  const handle = await page.waitForFunction(zoom => {
    const head = document.querySelector('#notation .fillhead');
    if (!head || Math.abs(__scoreQA.notation.geometry.scale - zoom * .015) >= 1e-6) return null;
    const width = head.getBoundingClientRect().width;
    if (!(width > 0)) return null;
    return { width, staffCount: document.querySelectorAll('#notation .staff').length, pattern: JSON.stringify(__scoreQA.pattern) };
  }, zoom);
  try { return await handle.jsonValue(); } finally { await handle.dispose(); }
};

await scenario('Score view: size slider changes actual note size and eight rows without changing the rhythm', async page => {
  await page.locator('#scoreRows').selectOption('8');
  const pattern = await page.evaluate(() => JSON.stringify(__scoreQA.pattern));
  await page.evaluate(() => {
    // Exercise the DOM replacement that can also be scheduled by resize events.
    globalThis.__scoreRebuilds = 0;
    const refresh = () => { __scoreQA.workspaceView.render(); if (++globalThis.__scoreRebuilds < 5) requestAnimationFrame(refresh); };
    requestAnimationFrame(refresh);
  });
  const before = await notationSnapshot(page, 100);
  await zoom(page, 50);
  const after = await notationSnapshot(page, 50);
  assert.ok(Math.abs(after.width / before.width - .5) < .01);
  assert.equal(before.staffCount, 40); assert.equal(after.staffCount, 40);
  assert.equal(before.pattern, pattern); assert.equal(after.pattern, pattern);
  await page.waitForFunction(() => globalThis.__scoreRebuilds === 5);
  await page.locator('#scoreOnly').check();
  assert.equal(await page.locator('.lower').isVisible(), false);
  assert.equal(await page.locator('#scoreView').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: artifacts + 'compact-eight-rows.png' });
});

await scenario('Score view: focus, zoom, row changes and Escape preserve playback', async page => {
  await page.evaluate(async () => { __scoreQA.settings.countIn = false; await __scoreQA.start(); });
  await page.locator('#scoreOnly').check();
  await zoom(page, 60);
  await page.locator('#scoreRows').selectOption('4');
  assert.ok(await page.evaluate(() => __scoreQA.play.on));
  assert.equal(await page.locator('#notation .staff').count(), 20);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#scoreOnly').isChecked(), false);
  assert.ok(await page.locator('.lower').isVisible());
  assert.ok(await page.evaluate(() => __scoreQA.play.on));
  await page.evaluate(() => __scoreQA.stop());
});

await scenario('Score view: scale and hidden drum persist, auto layout uses separate rows, keyboard changes only zoom', async page => {
  await page.locator('#scoreOnly').check();
  assert.equal(await page.locator('#notation .staff').count(), 40);
  await zoom(page, 65);
  const bpm = await page.locator('#bpm').inputValue();
  await page.locator('#scoreScale').focus(); await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#scoreScale').inputValue(), '70');
  assert.equal(await page.locator('#bpm').inputValue(), bpm);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('trener.podesavanja.v1'))?.scoreScale === 70);
  await page.reload(); await page.locator('#presets .load').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('#scoreScale').inputValue(), '70');
  assert.ok(await page.locator('#scoreOnly').isChecked());
  assert.equal(await page.locator('.lower').isVisible(), false);
  assert.equal(await page.locator('#notation .staff').count(), 40);
});

await scenario('Score view: phone default shows the entire first staff and preserves a custom height', async page => {
  await page.evaluate(async () => {
    const { blankPattern } = await import('/js/patterns.js');
    const pattern = blankPattern({ bars: 1, bpm: 90 });
    pattern.steps.snare[4] = 2; pattern.steps.kick[0] = 2;
    __scoreQA.loadPattern(pattern);
  });
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForFunction(() => {
      const viewport = document.querySelector('#notation').getBoundingClientRect();
      const staff = document.querySelector('#notation svg').getBoundingClientRect();
      return staff.height > 0 && staff.top >= viewport.top && staff.bottom <= viewport.bottom + 1;
    });
    assert.equal(await page.locator('#scoreScale').inputValue(), '100', 'fitting the staff does not shrink notes');
  }
  await page.evaluate(() => { __scoreQA.settings.sheetHeight = 240; __scoreQA.workspaceView.apply(); });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.sheet').evaluate(node => node.getBoundingClientRect().height), 240, 'an explicit user height is retained');
});

await scenario('Score view: compact phone layout keeps controls and navigation accessible', async page => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#scoreView').click(); await zoom(page, 40);
  await page.locator('#scoreRows').selectOption('8');
  assert.ok(await page.locator('#playBtn').isVisible());
  assert.ok(await page.locator('#scoreScale').isVisible());
  assert.ok(await page.locator('#scoreOnly').isChecked());
  assert.equal(await page.locator('#scoreOnly').isVisible(), false, 'phone uses the transport notes-only button without a duplicate checkbox');
  assert.equal(await page.locator('#scoreView').getAttribute('aria-pressed'), 'true');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const before = await page.evaluate(() => {
    __scoreQA.notation.setPlayhead(112);
    const element = document.querySelector('#notation');
    return { scroll: element.scrollTop, top: __scoreQA.notation.svg.viewBox.baseVal.y + element.scrollTop / __scoreQA.notation.geometry.scale };
  });
  assert.ok(before.scroll > 0);
  // A queued resize render used to reset scrollTop between setting the
  // playhead and the following assertion (and visibly jump the user's score).
  await page.evaluate(() => new Promise(resolve => {
    let remaining = 5;
    const refresh = () => { __scoreQA.workspaceView.render(); if (--remaining) requestAnimationFrame(refresh); else resolve(); };
    requestAnimationFrame(refresh);
  }));
  assert.ok(Math.abs(await page.locator('#notation').evaluate(element => element.scrollTop) - before.scroll) <= 1);
  await zoom(page, 60);
  const afterZoom = await page.evaluate(() => __scoreQA.notation.svg.viewBox.baseVal.y + document.querySelector('#notation').scrollTop / __scoreQA.notation.geometry.scale);
  assert.ok(Math.abs(afterZoom - before.top) <= 2, 'zoom retains the same musical viewport');
  await page.locator('#languageSelect').selectOption('en');
  await page.waitForFunction(() => document.querySelector('#scoreScale').getAttribute('aria-label') === 'Note size');
  await page.screenshot({ path: artifacts + 'phone-score.png' });
  await page.evaluate(() => __scoreQA.loadPattern({ ...structuredClone(__scoreQA.pattern), name: 'A different pattern' }));
  assert.equal(await page.locator('#notation').evaluate(element => element.scrollTop), 0, 'loading a different pattern starts at the top');
});

await browser.close();
await writeFile(artifacts + 'results.json', JSON.stringify({ results }, null, 2));
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
