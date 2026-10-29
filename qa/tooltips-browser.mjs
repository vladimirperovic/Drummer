// Svako vidljivo dugme, prekidač i lista ima opis (title) na srpskom i engleskom, u oba režima i svim sekcijama.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const browser = await chromium.launch({ headless: true });
let failed = 0;
for (const language of ['sr', 'en']) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })).newPage();
  await page.addInitScript(language => { localStorage.setItem('drummer.language.v1', language);
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => ({ inputs: new Map(), outputs: new Map() }) }); }, language);
  await page.goto(base); await page.locator('#presets .load').first().waitFor({ state: 'attached' });
  const missing = new Set(), serbianInEnglish = new Set();
  const collect = async () => {
    await page.waitForTimeout(150);
    const found = await page.evaluate(() => [...document.querySelectorAll('button, label.btn, label.tog, select')]
      .filter(el => el.getClientRects().length && !el.closest('[hidden], dialog:not([open])')).map(el => ({ key: el.id || el.className || el.textContent.trim().slice(0, 30), title: el.title })));
    for (const { key, title } of found) { if (!title) missing.add(key); else if (/[čćšžđ]/i.test(title) && !/Drummer/.test(title)) serbianInEnglish.add(key); }
  };
  for (const section of ['kit', 'library', 'editor', 'practice', 'results', 'settings']) {
    await page.locator(`#appNav [data-section=${section}]`).click(); await collect();
    for (const pane of await page.locator(`#section-${section} .subtabs [data-pane]`).all()) { await pane.click(); await collect(); }
  }
  await page.locator('[data-mode=song]').click();
  for (const pane of ['ai', 'songplay', 'songreport']) { await page.locator(`#appNav [data-pane=${pane}]`).click(); await collect(); }
  try {
    assert.deepEqual([...missing], [], `${language}: controls without a tooltip`);
    if (language === 'en') assert.deepEqual([...serbianInEnglish], [], 'English tooltips are translated');
    console.log(`PASS Tooltips: every visible control has a ${language.toUpperCase()} tooltip`);
  } catch (error) { failed++; console.log(`FAIL Tooltips ${language}: ${error.message}`); }
  await page.context().close();
}
await browser.close();
if (failed) process.exitCode = 1;
