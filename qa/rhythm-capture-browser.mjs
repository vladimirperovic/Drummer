import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const artifacts = process.env.DRUMMER_ARTIFACTS || fileURLToPath(new URL('./artifacts/rhythm-capture/', import.meta.url));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
async function scenario(name, fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' }), page = await context.newPage(), errors = [];
  page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('drummer.language.v1', 'en'); Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => ({ inputs: new Map(), outputs: new Map() }) }); });
  await page.route('**/js/main.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nglobalThis.__qa={rhythmCapture,studio,audio,settings,onHit,get pattern(){return pattern;}};' }); });
  try {
    await page.goto(base); await page.waitForFunction(() => !!globalThis.__qa); await page.evaluate(() => __qa.studio.journalReady);
    await fn(page); assert.deepEqual(errors, []); results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`);
  } catch (error) { results.push({ name, status: 'FAIL', error: error.stack, errors }); console.log(`FAIL ${name}: ${error.message}`); await page.screenshot({ path: `${artifacts}/failure-${results.length}.png`, fullPage: true }).catch(() => {}); }
  finally { await context.close(); }
}
async function recorded(page) {
  await page.locator('#captureRhythm').click();
  await page.locator('[data-capture-name]').fill('QA recorded rhythm');
  await page.locator('[data-capture-bpm]').fill('120'); await page.locator('[data-capture-bars]').selectOption('1');
  await page.locator('[data-capture-beats]').selectOption('4'); await page.locator('[data-capture-unit]').selectOption('4');
  await page.locator('[data-capture-grid]').selectOption('16'); await page.locator('[data-capture-start]').click();
  await page.waitForFunction(() => __qa.rhythmCapture.state === 'recording');
  await page.evaluate(() => {
    const start = __qa.rhythmCapture.firstPerf;
    __qa.onHit('snare', 92, start - 10, 'midi', 38);
    __qa.onHit('snare', 120, start + 132, 'midi', 38);
    __qa.onHit('kick', 92, start + 132, 'midi', 36);
  });
  await page.locator('[data-capture-stop]').click(); await page.waitForFunction(() => __qa.rhythmCapture.state === 'preview');
}

await scenario('Capture: actual onHit timestamps become quantized review, then a saved editable rhythm', async page => {
  await recorded(page);
  const result = await page.evaluate(() => ({ times: __qa.rhythmCapture.hits.map(h => h.timeMs), slots: __qa.rhythmCapture.result.accepted.map(h => h.slot), count: __qa.studio.sessions.length }));
  assert.deepEqual(result.times.map(Math.round), [-10, 132, 132]); assert.deepEqual(result.slots, [0, 1, 1]); assert.equal(result.count, 0);
  assert.ok(await page.locator('[data-capture-preview] .head').count() >= 3);
  await page.locator('[data-capture-save]').click(); await page.waitForFunction(() => __qa.rhythmCapture.state === 'idle');
  const pattern = await page.evaluate(() => __qa.pattern); assert.equal(pattern.name, 'QA recorded rhythm'); assert.equal(pattern.steps.snare[0], 2); assert.equal(pattern.steps.snare[1], 3); assert.equal(pattern.steps.kick[1], 2);
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('trener.ritmovi.v1')).some(p => p.name === 'QA recorded rhythm')));
});

await scenario('Capture: canceling a pending audio start cannot begin a hidden recording later', async page => {
  await page.locator('#captureRhythm').click();
  await page.evaluate(() => { __qa.audio.ensure = () => new Promise(resolve => { window.__resolveAudio = resolve; }); });
  await page.locator('[data-capture-start]').click(); assert.equal(await page.evaluate(() => __qa.rhythmCapture.state), 'starting');
  await page.locator('[data-capture-close]').click(); await page.evaluate(() => __resolveAudio());
  assert.equal(await page.evaluate(() => __qa.rhythmCapture.state), 'idle'); assert.equal(await page.locator('.capture-banner').isVisible(), false);
  assert.equal(await page.locator('#playBtn').isEnabled(), true);
});

await scenario('Capture: a failed listen stops scheduled sound and restores editable review controls', async page => {
  await recorded(page);
  await page.evaluate(() => {
    window.__stopped = 0; let calls = 0;
    const stop = __qa.audio.stopScheduled.bind(__qa.audio), play = __qa.audio.play.bind(__qa.audio);
    __qa.audio.stopScheduled = () => { __stopped++; return stop(); };
    __qa.audio.play = (...args) => { if (++calls === 2) throw new Error('Test audio failure'); return play(...args); };
  });
  await page.locator('[data-capture-listen]').click(); await page.waitForFunction(() => __qa.rhythmCapture.state === 'preview');
  assert.equal(await page.evaluate(() => __stopped), 1); assert.equal(await page.locator('[data-capture-save]').isEnabled(), true);
  assert.match(await page.locator('#toast').innerText(), /Test audio failure/);
});

await scenario('Capture: phone review modal keeps all actions inside the viewport', async page => {
  await page.setViewportSize({ width: 390, height: 844 }); await recorded(page);
  const dimensions = await page.locator('#rhythmCapture').evaluate(e => ({ left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right, width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.left >= 0 && dimensions.right <= dimensions.width + 1); assert.ok(dimensions.scroll <= dimensions.width + 1);
  await page.locator('[data-capture-save]').scrollIntoViewIfNeeded(); assert.equal(await page.locator('[data-capture-save]').isVisible(), true);
  await page.locator('#rhythmCapture').screenshot({ path: `${artifacts}/phone.png` });
});

await browser.close(); await writeFile(`${artifacts}/results.json`, JSON.stringify(results, null, 2));
if (results.some(r => r.status === 'FAIL')) process.exitCode = 1;
