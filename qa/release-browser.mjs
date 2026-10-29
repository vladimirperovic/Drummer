import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true,
  value: async () => ({ inputs: new Map(), outputs: new Map() }) }));
try {
  await page.goto(process.env.DRUMMER_URL || 'http://127.0.0.1:8123');
  await page.locator('#presets .load').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('#languageSelect').inputValue(), 'en');
  assert.equal(await page.locator('#importSong').innerText(), 'Import score');
  assert.equal(await page.locator('#scoreScale').getAttribute('aria-label'), 'Note size');
  await page.locator('#languageSelect').selectOption('sr');
  assert.equal(await page.locator('#importSong').innerText(), 'Uvezi partituru');
  await page.reload(); await page.locator('#presets .load').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('html').getAttribute('lang'), 'sr');
  await page.locator('#languageSelect').selectOption('en');
  await page.reload(); await page.locator('#presets .load').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.deepEqual(errors, []);
  console.log('PASS Release: fresh English default, optional Serbian and persistent language selection');
} finally { await browser.close(); }
