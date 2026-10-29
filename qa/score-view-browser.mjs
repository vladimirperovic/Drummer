import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const channel = process.env.DRUMMER_BROWSER || '';
const artifacts = fileURLToPath(new URL(`./artifacts/score-view/${channel || 'chromium'}/`, import.meta.url));
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
    await page.goto(base); await page.locator('#presets .load').first().waitFor();
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

await scenario('Score view: size slider changes actual note size and eight rows without changing the rhythm', async page => {
  await page.locator('#scoreRows').selectOption('8');
  const pattern = await page.evaluate(() => JSON.stringify(__scoreQA.pattern));
  const before = await page.locator('#notation .fillhead').first().boundingBox();
  await zoom(page, 50);
  const after = await page.locator('#notation .fillhead').first().boundingBox();
  assert.ok(Math.abs(after.width / before.width - .5) < .01);
  assert.equal(await page.locator('#notation .staff').count(), 40);
  assert.equal(await page.evaluate(() => JSON.stringify(__scoreQA.pattern)), pattern);
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

await scenario('Score view: compact phone layout keeps controls and navigation accessible', async page => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#scoreOnly').check(); await zoom(page, 40);
  await page.locator('#scoreRows').selectOption('8');
  assert.ok(await page.locator('#playBtn').isVisible());
  assert.ok(await page.locator('#scoreScale').isVisible());
  assert.ok(await page.locator('#scoreOnly').isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.evaluate(() => __scoreQA.notation.setPlayhead(112));
  assert.ok(await page.locator('#notation').evaluate(element => element.scrollTop > 0));
  await page.locator('#languageSelect').selectOption('en');
  await page.waitForFunction(() => document.querySelector('#scoreScale').getAttribute('aria-label') === 'Note size');
  await page.screenshot({ path: artifacts + 'phone-score.png' });
});

await browser.close();
await writeFile(artifacts + 'results.json', JSON.stringify({ results }, null, 2));
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
