// Public screenshots contain generated examples only, never a user's profile.
// Run explicitly against the local server when preparing a release.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../assets/screenshots/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1180 } });
const page = await context.newPage();
await page.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true,
  value: async () => ({ inputs: new Map(), outputs: new Map() }) }));
await page.route('**/js/main.js', async route => {
  const response = await route.fetch();
  await route.fulfill({ response, body: await response.text() + '\nglobalThis.__capture={studio,loadPattern};' });
});
try {
  await page.goto(process.env.DRUMMER_URL || 'http://127.0.0.1:8123');
  await page.locator('#presets .load').first().waitFor();
  await page.locator('#kit2dHost [data-play-ready=true]').first().waitFor({ state: 'attached', timeout: 2000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: output + 'drummer-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: output + 'drummer-phone.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.evaluate(async () => {
    const { resize, PRESETS } = await import('../js/patterns.js');
    const p = resize(PRESETS[0], { bars: 4 });
    for (const track of Object.values(p.steps)) for (let bar = 1; bar < 4; bar++) for (let i = 0; i < 16; i++) track[bar * 16 + i] = track[i];
    __capture.loadPattern(p);
  });
  await page.locator('#scoreOnly').check(); await page.locator('#scoreScale').fill('75');
  await page.screenshot({ path: output + 'notes-only.png' });
  await page.locator('#scoreOnly').uncheck();
  await page.evaluate(async () => {
    const { blankPattern, slotOffsetMs } = await import('../js/patterns.js');
    const pattern = blankPattern({ name: 'Timing practice example', bpm: 120, bars: 1 });
    for (const slot of [0, 4, 8, 12]) pattern.steps.snare[slot] = 2;
    const expected = [0, 4, 8, 12].map(slot => ({ id: `0:${slot}:snare`, inst: 'snare', slot, loop: 0, dyn: 2, timeMs: slotOffsetMs(pattern, slot) }));
    const hits = [
      { inst: 'snare', loop: 0, timeMs: -10, expectedId: expected[0].id, err: -10, kind: 'good', vel: 92, note: 38 },
      { inst: 'snare', loop: 0, timeMs: 550, expectedId: expected[1].id, err: 50, kind: 'ok', vel: 92, note: 38 },
      { inst: 'kick', loop: 0, timeMs: 800, err: null, kind: 'extra', vel: 92, note: 36 },
      { inst: 'snare', loop: 0, timeMs: 1470, expectedId: expected[3].id, err: -30, kind: 'ok', vel: 92, note: 38 },
    ];
    const session = { id: 'public-screenshot', pattern, bpmStart: 120, bpmEnd: 120, startedAt: '2026-10-29T12:00:00Z',
      durationMs: 2000, calib: 0, range: { from: 1, to: 1, instruments: ['snare', 'kick'] }, level: 'normalno', expected, hits,
      timeline: Array.from({ length: 16 }, (_, slot) => ({ slot, loop: 0, timeMs: slotOffsetMs(pattern, slot), bpm: 120 })),
      results: [{kind:'miss',inst:'snare',expectedId:expected[2].id,loop:0,slot:8}], passes: [], stats: { accuracy: 44, per: {} } };
    __capture.studio.sessions = [session]; __capture.studio.selectedId = session.id; __capture.studio.show('journal');
  });
  // The sticky transport is outside this cropped artifact; hide it briefly so
  // it cannot cover the report's title when Playwright scrolls the crop into view.
  await page.locator('.bar').evaluate(el => el.style.visibility = 'hidden');
  await page.locator('.performance-report').screenshot({ path: output + 'timing-report.png' });
  await page.locator('.bar').evaluate(el => el.style.visibility = '');
  const score = `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Reading practice</work-title></work><identification><creator type="composer">Drummer example</creator></identification><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${Array.from({length:12},(_,i)=>`<measure number="${i+1}">${i && i % 4 === 0 ? '<print new-system="yes"/>' : ''}${i?'':'<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>'}${['C','E','G','C'].map((step,j)=>`<note><pitch><step>${step}</step><octave>${j===3?5:4}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join('')}<backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note></measure>`).join('')}</part></score-partwise>`;
  await page.locator('#scoreFile').setInputFiles({ name: 'reading-practice.musicxml', mimeType: 'application/xml', buffer: Buffer.from(score) });
  await page.locator('#scoreImportCanvas svg').first().waitFor();
  await page.screenshot({ path: output + 'musicxml-score.png' });
  console.log('Captured five public screenshots in assets/screenshots/');
} finally { await browser.close(); }
