import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const artifacts = process.env.DRUMMER_ARTIFACTS || fileURLToPath(new URL('./artifacts/performance-report/', import.meta.url));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.DRUMMER_BROWSER ? { channel: process.env.DRUMMER_BROWSER } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
async function scenario(name, fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('drummer.language.v1', 'sr');
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => ({ inputs: new Map(), outputs: new Map() }) });
  });
  await page.route('**/js/main.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + '\nglobalThis.__qa={studio,settings,play,scorer,start,stop,onHit,loadPattern};' });
  });
  try {
    await page.goto(base); await page.waitForFunction(() => !!globalThis.__qa); await page.evaluate(() => __qa.studio.journalReady);
    await fn(page); assert.deepEqual(errors, []);
    results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.stack, errors }); console.log(`FAIL ${name}: ${error.message}`);
    await page.screenshot({ path: `${artifacts}/failure-${results.length}.png`, fullPage: true });
  } finally { await context.close(); }
}

async function fixture(page) {
  await page.evaluate(async () => {
    const { blankPattern, slotOffsetMs } = await import('/js/patterns.js');
    const pattern = blankPattern({ bpm: 120, bars: 2 });
    pattern.steps.snare[0] = pattern.steps.snare[4] = pattern.steps.snare[16] = 2;
    const expected = [0, 4, 16].map(slot => ({ id: `0:${slot}:snare`, inst: 'snare', slot, loop: 0, dyn: 2, timeMs: slotOffsetMs(pattern, slot) }));
    const session = { id: 'report-browser', pattern, bpmStart: 120, bpmEnd: 120, startedAt: new Date().toISOString(),
      durationMs: 4000, calib: 0, range: { from: 1, to: 2, instruments: ['snare', 'kick'] }, level: 'normalno', expected,
      timeline: Array.from({ length: 32 }, (_, slot) => ({ slot, loop: 0, timeMs: slotOffsetMs(pattern, slot), bpm: 120 })),
      hits: [
        { inst: 'snare', loop: 0, timeMs: -10, expectedId: expected[0].id, err: -10, kind: 'good', vel: 92 },
        { inst: 'snare', loop: 0, timeMs: 550, expectedId: expected[1].id, err: 50, kind: 'ok', vel: 92 },
        { inst: 'kick', loop: 0, timeMs: 800, err: null, kind: 'extra', vel: 92 },
      ], results: [], passes: [], stats: { accuracy: 75, per: {} } };
    __qa.studio.sessions = [session]; __qa.studio.selectedId = session.id; __qa.studio.show('journal');
  });
}

await scenario('Report: black and red heads share the staff, with exact early/late displacement, extra and missed notes', async page => {
  await fixture(page);
  const geometry = await page.evaluate(() => {
    const root = document.querySelector('#performanceReport');
    const hits = [...root.querySelectorAll('.performance-hit')].map(g => ({ slot: +g.dataset.slot, time: +g.dataset.timeMs, red: getComputedStyle(g.querySelector('.performance-actual')).fill }));
    const firstBar = root.querySelector('.performance-bar'), black = [...firstBar.querySelectorAll('.head[data-inst="snare"]')].map(g => ({ x: +g.dataset.x, y: +g.dataset.y }));
    const red = [...firstBar.querySelectorAll('.performance-hit[data-inst="snare"] .performance-actual ellipse')].map(e => ({ x: +e.getAttribute('cx'), y: +e.getAttribute('cy') }));
    return { hits, offsets: root.querySelectorAll('.performance-offset').length, staffs: root.querySelectorAll('.staff').length, black, red, text: root.textContent };
  });
  assert.deepEqual(geometry.hits.map(h => Number(h.slot.toFixed(6))), [-.08, 4.4, 6.4]);
  assert.equal(geometry.hits[0].time, -10); assert.equal(geometry.hits[0].red, 'rgb(198, 40, 40)');
  assert.equal(geometry.offsets, 2); assert.equal(geometry.staffs, 10); assert.match(geometry.text, /\+50 ms/); assert.match(geometry.text, /višak/);
  assert.equal(geometry.red[0].y, geometry.black[0].y); assert.equal(geometry.red[1].y, geometry.black[1].y);
  assert.ok(geometry.red[0].x < geometry.black[0].x); assert.ok(geometry.red[1].x > geometry.black[1].x);
  assert.equal(await page.locator('.performance-missed').count(), 1); assert.equal(await page.locator('.performance-bar').count(), 2);
  const staffY = await page.locator('.performance-bar').evaluateAll(cards => cards.map(card => card.querySelector('.staff').getBoundingClientRect().y));
  assert.ok(Math.abs(staffY[0] - staffY[1]) < 1, 'consecutive bars share the same row baseline');
  await page.locator('#performanceReport').screenshot({ path: `${artifacts}/desktop.png` });
});

await scenario('Report: instrument filter, English and narrow screens preserve a chronological score without page overflow', async page => {
  await fixture(page);
  await page.locator('[data-report-instrument]').selectOption('kick'); assert.equal(await page.locator('.performance-hit').count(), 1);
  await page.locator('#languageSelect').selectOption('en');
  assert.match(await page.locator('#performanceReport h3').textContent(), /Your complete performance/);
  await page.setViewportSize({ width: 390, height: 844 });
  const cards = await page.locator('.performance-bar').evaluateAll(elements => elements.map(e => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y })));
  assert.equal(cards[0].x, cards[1].x); assert.ok(cards[1].y > cards[0].y);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  await page.locator('#performanceReport').screenshot({ path: `${artifacts}/phone.png` });
});

await scenario('Report: Stop opens the completed report and preserves a first hit 10ms early', async page => {
  await page.locator('#scoreOnly').check();
  assert.equal(await page.locator('body').evaluate(e => e.classList.contains('notes-only')), true);
  await page.evaluate(async () => {
    const { blankPattern } = await import('/js/patterns.js'); const p = blankPattern({ bpm: 120 }); p.steps.snare[0] = 2;
    __qa.loadPattern(p); __qa.settings.countIn = false; __qa.settings.metro = false; await __qa.start();
  });
  await page.waitForFunction(() => __qa.scorer.pending.some(n => n.inst === 'snare'));
  await page.evaluate(() => { const n = __qa.scorer.pending.find(n => n.inst === 'snare'); __qa.onHit('snare', 92, n.perf - 10, 'midi', 38); });
  await page.waitForTimeout(220);
  await page.evaluate(() => __qa.stop());
  assert.equal(await page.locator('body').evaluate(e => e.classList.contains('notes-only')), false);
  assert.equal(await page.locator('#studio-journal').isVisible(), true);
  assert.equal(await page.locator('#performanceReport .performance-hit').count(), 1);
  const hit = await page.evaluate(async () => (await __qa.studio.loadSession(__qa.studio.sessions[0].id)).hits[0]);
  assert.equal(hit.kind, 'good'); assert.ok(Math.abs(hit.timeMs + 10) < .001);
});

await scenario('Report: long performances load twenty chronological bars per batch and exact times one hundred per page', async page => {
  await page.evaluate(async () => {
    window.IntersectionObserver = class { observe() {} disconnect() {} };
    const { blankPattern } = await import('/js/patterns.js');
    const { renderPerformanceReport } = await import('/js/performance-report.js');
    const pattern = blankPattern({ bars: 2, bpm: 120 }); pattern.steps.snare[0] = 2;
    const session = { pattern, durationMs: 100000, range: { from: 1, to: 2 }, hits: [], expected: [], timeline: [] };
    for (let loop = 0; loop < 25; loop++) {
      session.timeline.push(...Array.from({ length: 32 }, (_, slot) => ({ loop, slot, timeMs: loop * 4000 + slot * 125, bpm: 120 })));
      session.hits.push(...Array.from({ length: 12 }, (_, slot) => ({ inst: 'snare', loop, slot, timeMs: loop * 4000 + slot * 125 + 20, kind: 'extra' })));
    }
    const container = document.createElement('div'); container.id = 'longPerformanceReport'; document.querySelector('#view-tools').append(container);
    document.querySelector('[data-view=tools]').click(); renderPerformanceReport(container, session);
  });
  const report = page.locator('#longPerformanceReport');
  assert.equal(await report.locator('.performance-bar').count(), 20);
  await report.locator('[data-report-more]').click(); assert.equal(await report.locator('.performance-bar').count(), 40);
  await report.locator('[data-report-more]').click(); assert.equal(await report.locator('.performance-bar').count(), 50);
  assert.equal(await report.locator('[data-report-more]').isVisible(), false);
  assert.deepEqual(await report.locator('.performance-bar').evaluateAll(elements => elements.map(e => +e.dataset.reportBar)), Array.from({ length: 50 }, (_, i) => i + 1));
  const times = await report.locator('.performance-hit').evaluateAll(elements => elements.map(e => +e.dataset.timeMs));
  assert.equal(times.length, 300); assert.ok(times.every((time, i) => !i || time >= times[i - 1]));
  await report.locator('summary').click(); await page.waitForFunction(() => document.querySelectorAll('#longPerformanceReport tbody tr').length === 100);
  await report.locator('[data-report-more-times]').click(); assert.equal(await report.locator('tbody tr').count(), 200);
  await report.locator('[data-report-more-times]').click(); assert.equal(await report.locator('tbody tr').count(), 300);
  await report.locator('[data-report-columns]').selectOption('1');
  assert.equal(await report.locator('.performance-full-score').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length), 1);
  await report.locator('[data-report-labels]').uncheck(); assert.equal(await report.locator('.performance-delta').first().isVisible(), false);
});

await browser.close();
await writeFile(`${artifacts}/results.json`, JSON.stringify(results, null, 2));
if (results.some(r => r.status === 'FAIL')) process.exitCode = 1;
