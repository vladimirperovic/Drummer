import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import path from 'node:path';

const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const channel = process.env.DRUMMER_BROWSER || '';
const artifacts = fileURLToPath(new URL(`./artifacts/score-import/${channel || 'chromium'}/`, import.meta.url));
await mkdir(artifacts, { recursive: true });
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><work><work-title>Piano integration fixture</work-title></work><identification><creator type="composer">Drummer QA</creator></identification><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${Array.from({ length: 12 }, (_, i) => `<measure number="${i + 1}">${i > 0 && i % 4 === 0 ? '<print new-system="yes"/>' : ''}${!i ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' : ''}${['C', 'E', 'G', 'C'].map((step, n) => `<note><pitch><step>${step}</step><octave>${n === 3 ? 5 : 4}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join('')}<backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note></measure>`).join('')}</part></score-partwise>`;
const container = '<container><rootfiles><rootfile full-path="scores/piano.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>';
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; };
function archive(items, mutate = () => {}) {
  const files = [], directory = []; let offset = 0;
  for (const [name, text] of items) {
    const source = Buffer.from(text), data = deflateRawSync(source), nameBytes = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(source), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(source.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(source), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(source.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    mutate(central, name); files.push(local, nameBytes, data); directory.push(central, nameBytes); offset += local.length + nameBytes.length + data.length;
  }
  const end = Buffer.alloc(22), dir = Buffer.concat(directory); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, dir, end]);
}
const mxl = archive([['META-INF/container.xml', container], ['scores/piano.musicxml', xml]]);
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
async function scenario(name, fn, url = base, offline = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: offline ? 'allow' : 'block' });
  const page = await context.newPage(), errors = [], foreign = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(new URL(url).origin)) foreign.push(request.url()); });
  await page.addInitScript(() => { localStorage.setItem('drummer.language.v1', 'en'); Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => ({ inputs: new Map(), outputs: new Map() }) }); });
  try {
    await page.goto(url); await page.locator('#presets .load').first().waitFor(); await fn(page, context);
    assert.deepEqual(errors, []); assert.deepEqual(foreign, [], 'score import never requests remote resources');
    results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`);
  } catch (error) {
    await page.screenshot({ path: artifacts + `failure-${results.length + 1}.png` }).catch(() => {});
    results.push({ name, status: 'FAIL', error: error.stack, errors, foreign }); console.log(`FAIL ${name}: ${error.message}`);
  } finally { await context.close(); }
}
const upload = async (page, name, buffer) => {
  await page.locator('#scoreFile').setInputFiles({ name, mimeType: 'application/xml', buffer });
  await page.locator('#scoreImportCanvas svg').first().waitFor();
};

await scenario('MusicXML: original pitched two-staff score, title, zoom and keyboard isolation', async page => {
  assert.equal(await page.locator('script[src*="opensheetmusicdisplay"]').count(), 0, 'lazy runtime');
  const name = await page.locator('#patternName').textContent(), bpm = await page.locator('#bpm').inputValue();
  await upload(page, 'piano.musicxml', Buffer.from(xml));
  assert.equal(await page.locator('#scoreImportTitle').textContent(), 'Piano integration fixture');
  assert.ok(await page.locator('#scoreImportCanvas svg path').count() > 60);
  assert.match(await page.locator('#scoreImportMeta').textContent(), /12/);
  const before = await page.locator('#scoreImportCanvas').boundingBox();
  await page.locator('#importedScoreScale').fill('50');
  await page.waitForFunction(height => document.querySelector('#scoreImportCanvas').getBoundingClientRect().height < height - 20, before.height);
  const systemPositions = await page.locator('#scoreImportCanvas').evaluate(element => ['3', '5', '9'].map(number =>
    [...element.querySelectorAll('svg text')].find(label => label.textContent.trim() === number)?.getBoundingClientRect().y));
  assert.ok(systemPositions.every(Number.isFinite), 'measure labels are present');
  assert.ok(systemPositions[1] > systemPositions[0] + 20 && systemPositions[2] > systemPositions[1] + 20,
    'original XML breaks before measures 5 and 9 remain on separate systems even at 50% zoom');
  await page.locator('#scoreImportClose').focus(); await page.keyboard.press('KeyF'); await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#bpm').inputValue(), bpm); assert.equal(await page.locator('#patternName').textContent(), name);
  assert.equal(await page.locator('#playBtn').getAttribute('class'), 'play');
  await page.screenshot({ path: artifacts + 'original-piano-score.png' });
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#scoreImportDialog').isVisible(), false);
  assert.ok(await page.locator('#notation').isVisible());
});

await scenario('MusicXML: deflated MXL archive and replacement preserve the original score title', async page => {
  await upload(page, 'piano.mxl', mxl);
  assert.equal(await page.locator('#scoreImportTitle').textContent(), 'Piano integration fixture');
  await page.locator('#scoreImportClose').click();
  await upload(page, 'replacement.xml', Buffer.from(xml.replace('Piano integration fixture', 'Second score')));
  assert.equal(await page.locator('#scoreImportTitle').textContent(), 'Second score');
});

await scenario('MusicXML: malformed XML, entity declarations, remote images, ZIP traversal and zip bombs are rejected', async page => {
  const cases = [
    { name: 'bad.xml', data: Buffer.from('<score-partwise><broken>') },
    { name: 'xxe.xml', data: Buffer.from(xml.replace(/<!DOCTYPE[^>]+>/, '<!DOCTYPE score-partwise [<!ENTITY x SYSTEM "https://example.invalid/entity">]>')) },
    { name: 'external.xml', data: Buffer.from(xml.replace('<part-list>', '<credit><credit-image source="https://example.invalid/image.png"/></credit><part-list>')) },
    { name: 'traversal.mxl', data: archive([['META-INF/container.xml', container.replace('scores/piano.musicxml', '../piano.xml')], ['../piano.xml', xml]]) },
    { name: 'bomb.mxl', data: archive([['META-INF/container.xml', container], ['scores/piano.musicxml', xml]], (central, name) => { if (name.endsWith('.musicxml')) central.writeUInt32LE(100 * 1024 * 1024, 24); }) },
    { name: 'crc.mxl', data: archive([['META-INF/container.xml', container], ['scores/piano.musicxml', xml]], central => central.writeUInt32LE(123, 16)) },
    { name: 'not-a-score.pdf', data: Buffer.from(xml) },
  ];
  const result = await page.evaluate(async cases => {
    const { readScoreFile } = await import('./js/score-import.js'); const results = [];
    for (const item of cases) {
      try { await readScoreFile(new File([Uint8Array.from(atob(item.data), value => value.charCodeAt(0))], item.name)); results.push('accepted'); }
      catch { results.push('rejected'); }
    }
    return results;
  }, cases.map(item => ({ name: item.name, data: item.data.toString('base64') })));
  assert.deepEqual(result, cases.map(() => 'rejected'));
  assert.equal(await page.locator('#scoreImportDialog').isVisible(), false);
  assert.ok(await page.locator('#playBtn').isEnabled());
});

await scenario('MusicXML: phone dialog stays within viewport with scrollable original notation', async page => {
  await page.setViewportSize({ width: 390, height: 844 });
  await upload(page, 'phone.musicxml', Buffer.from(xml));
  const box = await page.locator('#scoreImportDialog').boundingBox(); assert.ok(box.x >= 0 && box.width <= 390 && box.height <= 844);
  assert.ok(await page.locator('#scoreImportClose').isVisible());
  assert.ok(await page.locator('#scoreImportScroll').evaluate(element => element.scrollHeight > element.clientHeight));
  await page.screenshot({ path: artifacts + 'phone-score.png' });
});

await scenario('MusicXML: starting practice during file reading cancels the pending import safely', async page => {
  const result = await page.evaluate(async xml => {
    const { createScoreImporter } = await import('./js/score-import.js');
    document.querySelector('#scoreImportDialog').remove();
    let busy = false, release, opened = 0;
    const control = createScoreImporter({ button: document.createElement('button'), input: document.createElement('input'), isBusy: () => busy, onOpen: () => opened++ });
    const pending = control.open({ name: 'delayed.musicxml', size: xml.length, arrayBuffer: () => new Promise(resolve => { release = resolve; }) });
    busy = true; release(new TextEncoder().encode(xml).buffer);
    return { success: await pending, opened, isOpen: control.isOpen };
  }, xml);
  assert.deepEqual(result, { success: false, opened: 0, isOpen: false });
});

// A real /Drummer/ path catches accidental root-relative vendor/module URLs.
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
    if (!pathname.startsWith('/Drummer/')) { response.writeHead(404).end(); return; }
    const file = path.resolve(root, pathname.slice('/Drummer/'.length) || 'index.html');
    if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
    const data = await readFile(file); response.writeHead(200, { 'Content-Type': type }); response.end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  await scenario('MusicXML: deployed subpath resolves local runtime and opens a score offline after preparation', async (page, context) => {
    await page.waitForFunction(() => navigator.serviceWorker.controller, { timeout: 15000 });
    await upload(page, 'online.musicxml', Buffer.from(xml)); await page.locator('#scoreImportClose').click();
    await context.setOffline(true); await page.reload(); await page.locator('#presets .load').first().waitFor();
    await upload(page, 'offline.mxl', mxl);
    assert.equal(await page.locator('#scoreImportTitle').textContent(), 'Piano integration fixture');
    assert.match(await page.locator('script[src*="opensheetmusicdisplay"]').getAttribute('src'), /\/Drummer\/js\/vendor\//);
  }, `http://127.0.0.1:${server.address().port}/Drummer/`, true);
} finally { await new Promise(resolve => server.close(resolve)); }
await browser.close();
await writeFile(artifacts + 'results.json', JSON.stringify({ results }, null, 2));
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
