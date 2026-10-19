import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { fixture, smf, track, end } from './midi-fixtures.mjs';

const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const channel = process.env.DRUMMER_BROWSER || '';
const artifacts = fileURLToPath(new URL(`./artifacts/expansion/${channel || 'chromium'}/`, import.meta.url));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [], filter = process.env.DRUMMER_CASE ? new RegExp(process.env.DRUMMER_CASE) : null;
const bridge = '\nglobalThis.__qa = { audio, midi, scorer, settings, play, studio, profiles, workbench, start, stop, onHit, scheduleSlot, loadPattern, setBpm, changeStructure, get pattern() { return pattern; } };';
async function scenario(name, fn, { offline = false } = {}) {
  if (filter && !filter.test(name)) return;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: offline ? 'allow' : 'block' });
  const p = await context.newPage(), errors = [];
  p.setDefaultTimeout(10000); p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => {
    const port = { id: 'td-17', name: 'Test TD-17', onmidimessage: null };
    const access = { inputs: new Map([['td-17', port]]), outputs: new Map() };
    window.__port = port;
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
  });
  if (!offline) await p.route('**/js/main.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + bridge }); });
  try {
    await p.goto(base);
    if (!offline) await p.waitForFunction(() => !!window.__qa, null, { timeout: 15000 });
    else await p.locator('#presets .load').first().waitFor();
    await fn(p, context); assert.deepEqual(errors, [], 'uncaught page errors');
    results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`);
  } catch (e) {
    const screenshot = `failure-${results.length + 1}.png`;
    await p.screenshot({ path: artifacts + screenshot, fullPage: true }).catch(() => {});
    results.push({ name, status: 'FAIL', error: e.stack, errors, screenshot }); console.log(`FAIL ${name}: ${e.message}`);
  } finally { await context.close(); }
}
const editor = async p => p.locator('[data-view=editor]').click();
const tools = async (p, name) => { await p.locator('[data-view=tools]').click(); await p.locator(`[data-tool=${name}]`).click(); };
const studio = async (p, name) => { await p.locator('[data-view=practice]').click(); await p.locator(`[data-studio=${name}]`).click(); };
const setting = async p => p.locator('[data-panel=settings]').click();
const input = async (p, id, value) => { await p.locator(`#${id}`).fill(String(value)); await p.locator(`#${id}`).press('Tab'); };
const uploadMidi = async (p, data = fixture()) => {
  await tools(p, 'import'); await p.locator('#midiFile').setInputFiles({ name: 'song.mid', mimeType: 'audio/midi', buffer: Buffer.from(data) });
  await p.waitForFunction(() => !!__qa.workbench.file);
};

await scenario('Expansion: editor changes 6/8 and 7/8 with correct grid, grouping and notation', async p => {
  await editor(p); await p.locator('#edBeats').selectOption('6'); await p.locator('#edUnit').selectOption('8');
  assert.equal(await p.locator('#grid .cell[data-inst=snare]').count(), 12);
  assert.equal(await p.locator('#edGroups').inputValue(), '3+3');
  assert.deepEqual(await p.locator('#notation .timesig').allTextContents(), ['6', '8']);
  await p.locator('#edBeats').selectOption('7'); await input(p, 'edGroups', '3+2+2');
  assert.equal(await p.locator('#grid .cell[data-inst=snare]').count(), 14);
  assert.match(await p.locator('#patternInfo').innerText(), /7\/8.*3\+2\+2/);
  await input(p, 'edGroups', '4+4'); assert.match(await p.locator('#toast').innerText(), /Zbir grupa/);
  await p.screenshot({ path: artifacts + 'meter-editor.png', fullPage: true });
});
await scenario('Expansion: 7/8 scheduler accents 2+2+3, ends after seven eighths and saves a pass', async p => {
  await p.evaluate(async () => {
    const { blankPattern } = await import('/js/patterns.js'); const pattern = blankPattern({ beats: 7, beatUnit: 8, bpm: 120 }); pattern.steps.hh.fill(2);
    __qa.loadPattern(pattern); __qa.settings.loop = false; __qa.settings.countIn = false; window.__clicks = [];
    const click = __qa.audio.click.bind(__qa.audio); __qa.audio.click = (...a) => { __clicks.push(a); return click(...a); };
    await __qa.start();
  });
  await p.waitForFunction(() => !__qa.play.on && __qa.studio.sessions.length);
  const r = await p.evaluate(() => ({ clicks: __clicks, session: __qa.studio.sessions[0] }));
  assert.equal(r.clicks.length, 7); assert.deepEqual(r.clicks.map(a => a[1]), [true, false, true, false, true, false, false]);
  assert.ok(Math.abs(r.clicks[6][0] - r.clicks[0][0] - 1.5) < .00001);
  assert.equal(r.session.expected.length, 14); assert.equal(r.session.passes.length, 1);
  assert.ok(Math.abs(r.session.durationMs - 1750) < 30);
});
await scenario('Expansion: swung scheduler records unequal subdivisions and count-in retains duration', async p => {
  await p.evaluate(async () => {
    const { blankPattern } = await import('/js/patterns.js'); const pattern = blankPattern({ bpm: 120, swing: 67 }); pattern.steps.hh.fill(2);
    __qa.loadPattern(pattern); __qa.settings.loop = false; __qa.settings.countIn = true; window.__times = [];
    const ctxToPerf = __qa.audio.ctxToPerf.bind(__qa.audio);
    __qa.audio.ctxToPerf = t => { __times.push(t); return ctxToPerf(t); };
    await __qa.start();
  });
  await p.waitForFunction(() => !__qa.play.on && __qa.studio.sessions.length, null, { timeout: 10000 });
  const s = await p.evaluate(() => __qa.studio.sessions[0]);
  assert.equal(s.pattern.swing, 67); assert.ok(Math.abs(s.timeline[2].timeMs - 335) < 20);
  assert.ok(Math.abs(s.timeline[4].timeMs - 500) < 20); assert.ok(Math.abs(s.durationMs - 2000) < 30);
});
await scenario('Expansion: swung recording quantizes at the swung grid rather than straight time', async p => {
  const slot = await p.evaluate(async () => {
    const { blankPattern } = await import('/js/patterns.js'); __qa.loadPattern(blankPattern({ bpm: 120, swing: 75 }));
    __qa.settings.countIn = false; __qa.settings.record = true; await __qa.start(); clearInterval(__qa.play.timer);
    const t = performance.now(); __qa.play.firstPerf = t; __qa.play.cur = { n: 0, slot: 0, loop: 0, perf: t, bpm: 120 };
    __qa.onHit('snare', 122, t + 375); __qa.stop(); return __qa.pattern.steps.snare.indexOf(3);
  }); assert.equal(slot, 2);
});
await scenario('Expansion: MIDI import previews channel, meter, mapping and dynamic hits then saves', async p => {
  await uploadMidi(p);
  assert.equal(await p.locator('#midiChannel').inputValue(), '10'); assert.equal(await p.locator('#midiUnit').inputValue(), '8');
  assert.match(await p.locator('#midiSummary').innerText(), /Udarci: 4.*preskočeno: 1/);
  await p.locator('[data-midi-note="60"]').selectOption('tom1'); await p.locator('#midiImportApply').click();
  const pattern = await p.evaluate(() => __qa.pattern);
  assert.equal(pattern.steps.snare[2], 1); assert.equal(pattern.steps.tom1[8], 2); assert.equal(pattern.beats, 6);
  await p.locator('#saveBtn').click(); await p.reload(); await p.waitForFunction(() => !!window.__qa);
  assert.equal(await p.evaluate(() => __qa.pattern.steps.crash2[6]), 3);
});
await scenario('Expansion: MIDI track/channel and start selection can be changed before importing', async p => {
  await uploadMidi(p); await p.locator('#midiTrack').selectOption('2'); await p.locator('#midiChannel').selectOption('1');
  await p.locator('[data-midi-note="60"]').selectOption('kick'); await p.locator('[data-midi-note="64"]').selectOption('snare');
  await input(p, 'midiStart', '1'); await p.locator('#midiQuantize').selectOption('eighth');
  assert.match(await p.locator('#midiSummary').innerText(), /Udarci: 1/); await p.locator('#midiImportApply').click();
  assert.equal(await p.evaluate(() => __qa.pattern.steps.snare[0]), 2);
});
await scenario('Expansion: malformed MIDI is rejected without replacing the current pattern', async p => {
  await tools(p, 'import'); await p.locator('#midiFile').setInputFiles({ name: 'bad.mid', mimeType: 'audio/midi', buffer: Buffer.from('garbage') });
  await p.waitForFunction(() => document.querySelector('#midiSummary').textContent.includes('MIDI'));
  assert.equal(await p.locator('#midiImportApply').isDisabled(), true); assert.equal(await p.evaluate(() => __qa.pattern.name), 'Osnovni rok');
});
await scenario('Expansion: MIDI import reports empty selection and can use active device mapping', async p => {
  await uploadMidi(p); await p.evaluate(() => { __qa.midi.map = { 36: 'snare' }; }); await p.locator('#midiUseProfile').click();
  assert.match(await p.locator('#midiSummary').innerText(), /Udarci: 1/);
  await input(p, 'midiStart', 999); assert.equal(await p.locator('#midiImportApply').isDisabled(), true);
  assert.match(await p.locator('#midiSummary').innerText(), /Nema mapiranih/);
});
await scenario('Expansion: two device profiles restore independent maps, calibration and velocity curves', async p => {
  await setting(p); await input(p, 'profileName', 'My TD'); await p.locator('#profileDevice').selectOption('Test TD-17');
  await input(p, 'calib', 37); await p.locator('#profileCurve').selectOption('soft'); await input(p, 'profileGain', 1.2);
  await p.evaluate(() => { __qa.midi.assign(60, 'snare'); }); await p.locator('#profileSave').click(); const id = await p.locator('#profileSelect').inputValue();
  await p.locator('#profileNew').click(); await input(p, 'profileName', 'Other kit'); await input(p, 'calib', -12);
  await p.locator('#profileCurve').selectOption('hard'); await p.evaluate(() => { __qa.midi.assign(60, 'kick'); }); await p.locator('#profileSave').click();
  await p.locator('#profileSelect').selectOption(id);
  assert.equal(await p.locator('#calib').inputValue(), '37'); assert.equal(await p.locator('#profileCurve').inputValue(), 'soft');
  assert.equal(await p.evaluate(() => __qa.midi.map[60]), 'snare'); await p.reload(); await p.waitForFunction(() => !!window.__qa);
  assert.equal(await p.evaluate(() => __qa.settings.calib), 37); assert.equal(await p.evaluate(() => __qa.midi.map[60]), 'snare');
});
await scenario('Expansion: profile device match, deletion and quota failure are explicit', async p => {
  await setting(p); await input(p, 'profileName', 'Connected profile'); await p.locator('#profileDevice').selectOption('Test TD-17'); await p.locator('#profileSave').click();
  const id = await p.locator('#profileSelect').inputValue(); await p.locator('#profileNew').click(); await p.locator('#profileMatch').click();
  assert.equal(await p.locator('#profileSelect').inputValue(), id);
  await p.evaluate(() => { window.__set = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { if(k === 'drummer.profiles.v1') throw new Error('quota'); return __set.call(this,k,v); }; });
  await input(p, 'profileName', 'Unwritten name'); await p.locator('#profileSave').click();
  assert.equal(await p.locator('#storageWarning').isVisible(), true);
  assert.equal(await p.evaluate(() => __qa.profiles.items[0].name), 'Connected profile');
  await p.evaluate(() => { Storage.prototype.setItem = __set; }); p.once('dialog', d => d.accept()); await p.locator('#profileDelete').click();
  assert.equal(await p.evaluate(() => __qa.profiles.items.length), 0);
});
await scenario('Expansion: velocity curve affects live sound/scoring but recording keeps raw velocity', async p => {
  await p.evaluate(async () => {
    __qa.settings.velocityCurve = 'soft'; __qa.settings.countIn = false; __qa.settings.loop = false; __qa.setBpm(260);
    await __qa.start();
  });
  await p.waitForFunction(() => __qa.play.cur?.n >= 0);
  await p.evaluate(() => __port.onmidimessage({ data: [153, 40, 40], timeStamp: performance.now() }));
  await p.waitForFunction(() => !__qa.play.on);
  const hit = await p.evaluate(() => __qa.studio.sessions[0].hits[0]);
  assert.equal(hit.vel, 40); assert.equal(hit.note, 40); assert.ok(hit.adjustedVelocity > 40);
});
await scenario('Expansion: profile controls are locked during exercise and program', async p => {
  await setting(p); await p.locator('#playBtn').click(); await p.waitForFunction(() => __qa.play.on);
  assert.equal(await p.locator('#profileSelect').isDisabled(), true); assert.equal(await p.locator('#profileSave').isDisabled(), true);
  await p.locator('#playBtn').click(); assert.equal(await p.locator('#profileSave').isDisabled(), false);
});
await scenario('Expansion: English covers all static screens, instrument labels and accessibility text', async p => {
  await p.locator('#languageSelect').selectOption('en'); await p.waitForFunction(() => document.documentElement.lang === 'en');
  for (const name of ['kit','editor','practice','tools']) await p.locator(`[data-view=${name}]`).click();
  for (const name of ['focus','journal','backing','program','replay']) await studio(p,name);
  for (const name of ['import','print','offline']) await tools(p,name);
  await setting(p);
  assert.equal(await p.locator('[data-view=practice]').innerText(), 'Practice'); assert.equal(await p.locator('[data-panel=settings]').innerText(), 'Settings');
  assert.equal(await p.locator('#profileSave').innerText(), 'Save profile');
  assert.match(await p.locator('#mapTable').innerText(), /Snare/);
  assert.match(await p.locator('#playBtn').getAttribute('title'), /Space/);
  const remaining = await p.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), texts = []; let n;
    while ((n = walker.nextNode())) if (n.nodeValue.trim() && !n.parentElement.closest('script,style,[translate=no],[data-user-text]') && /[čćšđžČĆŠĐŽ]|\b(ritam|taktova|Dnevnik|Podesavanja|Noge|Ruke|Snimaj|Odbrojavanje)\b/.test(n.nodeValue)) texts.push(n.nodeValue.trim());
    return [...new Set(texts)];
  });
  assert.deepEqual(remaining, []);
  await p.screenshot({ path: artifacts + 'english-settings.png', fullPage: true });
});
await scenario('Expansion: language persists, toggles back, and does not change notes or custom names', async p => {
  await editor(p); await input(p, 'edName', 'Moja pesma čć Ritmovi'); const original = await p.evaluate(() => JSON.stringify(__qa.pattern.steps));
  await p.locator('#languageSelect').selectOption('en'); assert.equal(await p.locator('#edName').inputValue(), 'Moja pesma čć Ritmovi');
  p.once('dialog', d => d.accept('Moja pesma čć Ritmovi'));
  await p.locator('#saveBtn').click(); await p.reload(); await p.waitForFunction(() => !!window.__qa);
  assert.equal(await p.locator('#languageSelect').inputValue(), 'en'); assert.equal(await p.locator('[data-view=tools]').innerText(), 'Tools');
  assert.equal(await p.evaluate(() => JSON.stringify(__qa.pattern.steps)), original);
  assert.equal(await p.locator('#mine .load span').first().innerText(), 'Moja pesma čć Ritmovi');
  await p.locator('#languageSelect').selectOption('sr'); assert.equal(await p.locator('[data-view=tools]').innerText(), 'Alati');
});
await scenario('Expansion: English translates live errors, score counts, journal and confirmations', async p => {
  await p.locator('#languageSelect').selectOption('en');
  await p.evaluate(async () => { __qa.settings.countIn=false; __qa.settings.loop=false; __qa.setBpm(260); await __qa.start(); });
  await p.waitForFunction(() => !__qa.play.on && __qa.studio.sessions.length);
  await p.locator('[data-panel=stats]').click(); assert.match(await p.locator('#counts').innerText(), /missed/);
  await studio(p,'journal'); assert.match(await p.locator('#sessionDetail').innerText(), /No earlier comparable session/);
  let message; p.once('dialog', async d => { message = d.message(); await d.dismiss(); });
  await p.locator('[data-delete-session]').click(); assert.match(message, /Delete this session/);
  await tools(p,'import'); await p.locator('#midiFile').setInputFiles({ name:'bad.mid',mimeType:'audio/midi',buffer:Buffer.from('bad') });
  await p.waitForFunction(() => document.querySelector('#midiSummary').textContent.includes('truncated'));
});
await scenario('Expansion: print preview paginates 7/8, preserves sticking and produces an English PDF', async p => {
  await p.evaluate(async () => {
    const { blankPattern } = await import('/js/patterns.js'); const p = blankPattern({ name:'7/8 practice sheet', bars:8, beats:7, beatUnit:8, bpm:110, sticking:'RLRLRLRLRLRLRL'.repeat(8) });
    p.steps.hh.fill(2); for(let i=0;i<112;i+=4) p.steps.snare[i]=3; for(let i=0;i<112;i+=14) p.steps.kick[i]=2;
    __qa.loadPattern(p);
  });
  await p.locator('#languageSelect').selectOption('en'); await tools(p,'print');
  await p.locator('#printBars').selectOption('2'); await input(p,'printRepeats',2);
  assert.equal(await p.locator('#printPreview .print-page').count(),3); assert.equal(await p.locator('#printPreview .print-staff').count(),8);
  assert.equal(await p.locator('#printPreview .sticking').count(),224);
  await p.evaluate(() => { window.print = () => { window.__printed = true; }; }); await p.locator('#printGo').click();
  assert.equal(await p.evaluate(() => window.__printed),true); assert.equal(await p.locator('#printOutput .print-page').count(),3);
  await p.pdf({ path:artifacts+'practice-sheet.pdf', format:'A4', printBackground:true, preferCSSPageSize:true });
  await p.screenshot({ path:artifacts+'print-preview.png',fullPage:true });
});
await scenario('Expansion: print controls remove sticking and retain user title safely', async p => {
  await p.evaluate(async () => { const {blankPattern}=await import('/js/patterns.js'); __qa.loadPattern(blankPattern({ name:'<img src=x onerror=alert(1)> čć',sticking:'RL' })); });
  await tools(p,'print'); await p.locator('#printSticking').uncheck();
  assert.equal(await p.locator('#printPreview .sticking').count(),0); assert.equal(await p.locator('#printPreview img').count(),0);
  assert.match(await p.locator('#printPreview h1').innerText(),/<img/);
});
await scenario('Expansion: new screens and English fit phone, tablet and desktop', async p => {
  await p.locator('#languageSelect').selectOption('en');
  for(const width of [1440,768,390,360]) {
    await p.setViewportSize({width,height:1000});
    await p.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, { timeout: 3000 });
    await editor(p); await setting(p);
    for(const tool of ['import','print','offline']) {
      await tools(p,tool); const dimensions=await p.evaluate(()=>[innerWidth,document.documentElement.scrollWidth]);
      assert.ok(dimensions[1]<=dimensions[0], `${width}/${tool}: ${dimensions}`);
    }
  }
  await p.screenshot({path:artifacts+'phone-english.png',fullPage:true});
});
await scenario('Expansion: PWA manifest, icons and all app modules are cached for offline reload', async (p, context) => {
  await p.waitForFunction(()=>navigator.serviceWorker.controller!==null,null,{timeout:20000});
  const manifest = await (await p.request.get(base+'/manifest.webmanifest')).json(); assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons) { const response=await p.request.get(base+'/'+icon.src); assert.equal(response.status(),200); assert.equal((await response.body()).subarray(1,4).toString(),'PNG'); }
  const cached = await p.evaluate(async()=>{const keys=await caches.keys();const c=await caches.open(keys.find(k=>k.startsWith('drummer:')));return(await c.keys()).map(r=>new URL(r.url).pathname);});
  for(const path of ['/index.html','/js/i18n.js','/js/midi-file.js','/js/printing.js']) assert.ok(cached.includes(path));
  await p.locator('#languageSelect').selectOption('en'); await context.setOffline(true); await p.reload();
  await p.locator('#presets .load').first().waitFor(); assert.equal(await p.locator('[data-view=tools]').innerText(),'Tools');
  await p.locator('#countIn').uncheck(); await p.locator('#loop').uncheck(); await input(p,'bpm',260);
  await p.locator('#playBtn').click(); await p.waitForFunction(()=>document.querySelector('#playBtn').textContent.includes('Stop'));
  await p.waitForFunction(()=>document.querySelector('#playBtn').textContent.includes('Start'));
  await studio(p,'journal'); assert.equal(await p.locator('#sessionList tr').count(),1);
  const uncachedFails = await p.evaluate(async () => { try { await fetch('/qa/not-cached-offline-probe'); return false; } catch { return true; } });
  assert.equal(uncachedFails, true, 'Uncached requests must fail while cached app remains usable');
  await tools(p,'offline'); assert.match(await p.locator('#pwaStatus').innerText(),/offline use/);
  await p.screenshot({path:artifacts+'offline.png',fullPage:true});
},{offline:true});
await scenario('Expansion: PWA shows install invitation and update checks without forced reload', async p => {
  await p.waitForFunction(()=>navigator.serviceWorker.controller!==null,null,{timeout:20000}); await tools(p,'offline');
  await p.evaluate(()=>{ const event=new Event('beforeinstallprompt',{cancelable:true}); event.prompt=async()=>{window.__installRequested=true;}; event.userChoice=Promise.resolve({outcome:'dismissed'}); dispatchEvent(event); });
  assert.equal(await p.locator('#pwaInstall').isEnabled(),true); await p.locator('#pwaInstall').click(); assert.equal(await p.evaluate(()=>window.__installRequested),true);
  await p.locator('#pwaCheck').click(); await p.waitForFunction(()=>document.querySelector('#pwaStatus').textContent.includes('završena'));
  assert.equal(await p.locator('#pwaUpdate').isVisible(),false);
},{offline:true});

await scenario('Expansion: a real PWA update protects edits and storage failures, then preserves saved data', async p => {
  const root = fileURLToPath(new URL('../', import.meta.url)); let version = 'qa-before';
  const server = createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const path = resolve(root, '.' + (name === '/' ? '/index.html' : name));
      if (!path.startsWith(resolve(root) + sep)) { res.writeHead(403).end(); return; }
      let body = await readFile(path);
      if (name === '/sw.js') body = Buffer.from(body.toString().replace(/const VERSION = '[^']+'/, `const VERSION = '${version}'`));
      const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png' };
      res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control':'no-store' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await p.goto(`http://127.0.0.1:${server.address().port}`);
    await p.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await p.locator('#languageSelect').selectOption('en'); await editor(p); await input(p,'edName','Saved through update');
    await setting(p); await input(p,'calib',37); await input(p,'profileName','Update profile'); await p.locator('#profileSave').click();
    await tools(p,'offline'); version = 'qa-after'; await p.locator('#pwaCheck').click();
    await p.locator('#pwaUpdate').waitFor();
    await p.evaluate(() => { window.__beforeUpdate = true; }); await p.locator('#pwaUpdate').click();
    assert.match(await p.locator('#pwaStatus').innerText(), /save pattern and program/);
    assert.equal(await p.evaluate(() => window.__beforeUpdate), true);
    let savePrompt; p.once('dialog', async d => { savePrompt = d.message(); await d.accept('Saved through update'); });
    await p.locator('[data-panel=library]').click(); await p.locator('#saveBtn').click(); assert.equal(savePrompt,'Pattern name:'); await tools(p,'offline');
    await p.evaluate(() => { window.__originalSet = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('quota'); }; });
    await p.locator('#pwaUpdate').click(); assert.match(await p.locator('#pwaStatus').innerText(), /Export a backup/);
    assert.equal(await p.evaluate(() => window.__beforeUpdate), true);
    await p.evaluate(() => { Storage.prototype.setItem = __originalSet; }); await p.locator('#pwaUpdate').click();
    await p.waitForFunction(() => !window.__beforeUpdate && document.querySelector('#presets .load'));
    assert.equal(await p.locator('#languageSelect').inputValue(),'en');
    await editor(p); assert.equal(await p.locator('#edName').inputValue(),'Saved through update');
    await setting(p); assert.equal(await p.locator('#calib').inputValue(),'37'); assert.equal(await p.locator('#profileName').inputValue(),'Update profile');
    const keys = await p.evaluate(() => caches.keys()); assert.ok(keys.some(k => k.endsWith('qa-after'))); assert.ok(!keys.some(k => k.endsWith('qa-before')));
  } finally { await new Promise(resolve => server.close(resolve)); }
},{offline:true});

const report = { browser:channel||'Chromium', browserVersion:browser.version(), generatedAt:new Date().toISOString(), passed:results.filter(r=>r.status==='PASS').length, failed:results.filter(r=>r.status==='FAIL').length, results };
await browser.close(); await writeFile(artifacts+'results.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,failed:report.failed})); process.exitCode=report.failed?1:0;
