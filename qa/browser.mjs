import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const lib = async page => { await page.locator('#appNav [data-section=library]').click(); await page.locator('.subtabs [data-pane=library]').click(); };

const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const channel = process.env.DRUMMER_BROWSER;
const artifacts = process.env.DRUMMER_ARTIFACTS || fileURLToPath(new URL(`./artifacts${channel ? `/${channel}` : ''}/`, import.meta.url));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
const filter = process.env.DRUMMER_CASE ? new RegExp(process.env.DRUMMER_CASE) : null;
const results = [];
const bridge = `\nglobalThis.__qa = { audio, midi, scorer, settings, play, studio, start, stop, onHit, scheduleSlot, finishLoop, loadPattern, renderStats, setBpm, changeStructure, runCalibration, chooseKit, get pattern() { return pattern; } };`;

async function scenario(name, fn, options = {}) {
  if (filter && !filter.test(name)) return;
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(6000);
  await page.addInitScript(({ initial, midiMode }) => {
    if (localStorage.getItem('drummer.language.v1') == null) localStorage.setItem('drummer.language.v1', 'sr');
    for (const [k, v] of Object.entries(initial || {})) localStorage.setItem(k, v);
    const port = { id: 'qa-input', name: 'Simulated TD-17', onmidimessage: null };
    const sent = [];
    const access = { inputs: new Map([['qa-input', port]]), outputs: new Map([['qa-output', { id: 'qa-output', name: 'Simulated output', send: (...args) => sent.push(args) }]]) };
    globalThis.__midiFixture = { port, access, sent };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: midiMode === 'unsupported' ? undefined : async () => {
      if (midiMode === 'denied') throw new Error('Test denial');
      if (midiMode === 'empty') access.inputs.clear();
      return access;
    } });
  }, { initial: options.initial, midiMode: options.midiMode });
  await page.route('**/js/main.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + bridge });
  });
  try {
    await page.goto(base);
    if (!options.startupFailure) { await page.waitForFunction(() => !!globalThis.__qa, null, { timeout: 15000 }); await page.evaluate(() => __qa.studio.journalReady); }
    const detail = await fn(page, errors);
    if (!options.allowErrors) assert.deepEqual(errors, [], 'Uncaught page errors');
    results.push({ name, status: 'PASS', detail });
    console.log(`PASS ${name}`);
  } catch (e) {
    const screenshot = `${String(results.length + 1).padStart(2, '0')}-failure.png`;
    await page.screenshot({ path: `${artifacts}/${screenshot}`, fullPage: true }).catch(() => {});
    results.push({ name, status: 'FAIL', error: e.message, pageErrors: errors, screenshot });
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
  } finally { await context.close(); }
}

await scenario('Startup: notation, 94 presets, simulated MIDI, assets', async p => {
  assert.equal(await p.title(), 'Drummer');
  assert.equal(await p.locator('#presets .load').count(), 20);
  assert.match(await p.locator('#presetCount').innerText(), /1–20 \/ 94/);
  assert.equal(await p.locator('#notation .head').count(), 12);
  assert.match(await p.locator('#midiStatus').innerText(), /Simulated TD-17/);
  const response = await p.request.get(`${base}/kits/index.json`); assert.equal(response.status(), 200); assert.deepEqual(await response.json(), []);
  await p.screenshot({ path: `${artifacts}/desktop.png`, fullPage: true });
});

await scenario('All presets render valid note coordinates', async p => {
  const loaded = new Set();
  for (let i = 0; i < 94; i++) {
    if (i && i % 20 === 0) await p.locator('#presetsNext').click();
    await lib(p); await p.locator('#presets .load').nth(i % 20).click();
    loaded.add(await p.evaluate(() => __qa.pattern.id));
    assert.equal(await p.locator('#notation .notation-svg').count(), 1);
    assert.ok(await p.locator('#notation .head').count() > 0);
    assert.doesNotMatch(await p.locator('#notation').innerHTML(), /NaN|Infinity|undefined/);
    if ([3, 6, 12, 13].includes(i)) await p.screenshot({ path: `${artifacts}/preset-${i}.png`, fullPage: true });
  }
  assert.equal(loaded.size, 94, 'Every preset was loaded exactly once across all five pages');
});

await scenario('All 96 supported meter/bar/subdivision combinations render', async p => {
  const result = await p.evaluate(async () => {
    const { blankPattern } = await import('/js/patterns.js');
    const { renderNotation } = await import('/js/notation.js');
    const div = document.createElement('div'); div.style.width = '1200px'; document.body.append(div);
    let count = 0;
    for (let bars = 1; bars <= 8; bars++) for (let beats = 2; beats <= 7; beats++) for (const division of [12, 16]) {
      const pattern = blankPattern({ bars, beats, division }); pattern.steps.snare.fill(2);
      renderNotation(div, pattern, { maxHeight: 340 });
      if (/NaN|Infinity|undefined/.test(div.innerHTML)) throw new Error(`${bars}/${beats}/${division}`);
      count++;
    }
    div.remove(); return count;
  });
  assert.equal(result, 96);
});

await scenario('Keyboard: all 13 instruments, normal/accent/ghost', async p => {
  const keys = [['e', 'Crash'], ['u', 'Crash 2'], ['i', 'Ride'], ['o', 'Ride zvono'], ['d', 'Hi-hat zatvoren'], ['s', 'Hi-hat otvoren'], ['g', 'Tom 1'], ['h', 'Tom 2'], ['f', 'Dobos'], ['c', 'Cross-stick'], ['l', 'Floor tom'], ['v', 'Kick'], ['a', 'Hi-hat nogom']];
  for (const [key, label] of keys) { await p.keyboard.press(key); assert.match(await p.locator('#lastHit').innerText(), new RegExp(`${label} · jačina 92`)); }
  await p.keyboard.press('Shift+f'); assert.match(await p.locator('#lastHit').innerText(), /122/);
  await p.keyboard.press('Alt+f'); assert.match(await p.locator('#lastHit').innerText(), /38/);
});

await scenario('Keyboard shortcuts do not trigger when editing text', async p => {
  await p.locator('#appNav [data-section=editor]').click(); await p.locator('#edName').fill('ff jj vv');
  await p.locator('#edName').press('Space'); assert.equal(await p.locator('#lastHit').innerText(), 'Spremno za sviranje');
  assert.equal(await p.evaluate(() => __qa.play.on), false);
});

await scenario('Tempo UI enforces 30-260 BPM and keyboard increments', async p => {
  await p.locator('#bpm').fill('500'); await p.locator('#bpm').press('Tab'); assert.equal(await p.locator('#bpm').inputValue(), '260');
  await p.locator('#bpm').fill('1'); await p.locator('#bpm').press('Tab'); assert.equal(await p.locator('#bpm').inputValue(), '30');
  await p.locator('.brand').click(); await p.keyboard.press('Shift+ArrowUp'); assert.equal(await p.locator('#bpm').inputValue(), '35');
});

await scenario('BUG: editor clicks follow normal -> accent -> ghost -> empty', async p => {
  await p.locator('#appNav [data-section=editor]').click();
  const cell = p.locator('[data-inst=crash2][data-slot="0"]'); const values = [];
  for (let i = 0; i < 4; i++) { await cell.click(); values.push(Number(await cell.getAttribute('data-v'))); }
  assert.deepEqual(values, [2, 3, 1, 0]);
});

await scenario('Editor modifiers, erase, resize and copy first bar', async p => {
  await p.locator('#appNav [data-section=editor]').click();
  const cell = p.locator('[data-inst=crash2][data-slot="0"]');
  await cell.click({ modifiers: ['Shift'] }); assert.equal(await cell.getAttribute('data-v'), '3');
  await cell.click({ modifiers: ['Alt'] }); assert.equal(await cell.getAttribute('data-v'), '1');
  await cell.click({ button: 'right' }); assert.equal(await cell.getAttribute('data-v'), '0');
  await cell.click({ modifiers: ['Shift'] }); await p.locator('#edBars').selectOption('2'); await p.locator('#edCopyBar').click();
  assert.equal(await p.locator('[data-inst=crash2][data-slot="16"]').getAttribute('data-v'), '3');
  await p.locator('#edDiv').selectOption('12'); assert.equal(await p.locator('#grid .cell').count(), 13 * 24);
  assert.equal(await p.locator('#clickSub option').count(), 2);
});

await scenario('Save, duplicate, export and reload preserve an edited rhythm', async p => {
  p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'QA rhythm' : undefined));
  await p.locator('#appNav [data-section=editor]').click(); await p.locator('[data-inst=crash2][data-slot="0"]').click({ modifiers: ['Shift'] });
  await lib(p); await p.locator('#saveBtn').click(); assert.equal(await p.locator('#mine .item').count(), 1);
  await lib(p); await p.locator('#mine button').filter({ hasText: 'Dupliraj' }).click(); assert.equal(await p.locator('#mine .item').count(), 2);
  const downloadPromise = p.waitForEvent('download'); await lib(p); await p.locator('#exportBtn').click(); const download = await downloadPromise;
  const path = `${artifacts}/export.json`; await download.saveAs(path);
  const { readFile } = await import('node:fs/promises'); const data = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(data.ritmovi.length, 2); assert.equal(data.ritmovi[0].steps.crash2[0], 3);
  await p.waitForTimeout(300); await p.reload(); await p.waitForFunction(() => !!globalThis.__qa); await p.evaluate(() => __qa.studio.journalReady);
  assert.equal(await p.locator('#mine .item').count(), 2); assert.equal(await p.evaluate(() => __qa.pattern.steps.crash2[0]), 3);
});

await scenario('JSON upload accepts valid patterns and rejects malformed JSON', async p => {
  await p.locator('#importFile').setInputFiles({ name: 'test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ name: 'Imported QA', steps: { crash2: [3] } })) });
  await p.waitForFunction(() => document.querySelectorAll('#mine .item').length === 1);
  assert.match(await p.locator('#mine').innerText(), /Imported QA/);
  await p.locator('#importFile').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('nije ispravan'));
  assert.equal(await p.locator('#mine .item').count(), 1);
});

await scenario('BUG: imported non-string sticking must not crash pattern loading', async p => {
  await p.locator('#importFile').setInputFiles({ name: 'bad-type.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ name: 'Bad sticking', sticking: 123, steps: {} })) });
  await p.waitForFunction(() => document.querySelectorAll('#mine .load').length === 1);
  await lib(p); await p.locator('#mine .load').click();
  await p.waitForTimeout(250);
  assert.equal(await p.locator('#notation svg').count(), 1, 'Notation disappeared after importing numeric sticking');
});

await scenario('BUG: imported non-string name must not break export', async (p, errors) => {
  await p.locator('#importFile').setInputFiles({ name: 'bad-name.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ name: 123, steps: {} })) });
  await p.waitForFunction(() => document.querySelectorAll('#mine .item').length === 1);
  await lib(p); await p.locator('#mine button').filter({ hasText: /^Izvezi$/ }).click(); await p.waitForTimeout(100);
  assert.deepEqual(errors, []);
});

await scenario('BUG: corrupted library shape must recover on startup', async (p, errors) => {
  assert.deepEqual(errors, []); assert.equal(await p.locator('#presets .load').count(), 20);
  assert.match(await p.locator('#presetCount').innerText(), /\/ 94/);
}, { startupFailure: true, initial: { 'trener.ritmovi.v1': '{}' } });

await scenario('MIDI learn, input, choke, pedal and reset through UI', async p => {
  await p.locator('#appNav [data-section=settings]').click(); await p.locator('.subtabs [data-pane=device]').click(); await p.locator('[data-learn=crash2]').click();
  await p.evaluate(() => __midiFixture.port.onmidimessage({ data: [0x99, 60, 110], timeStamp: performance.now() }));
  assert.equal(await p.evaluate(() => __qa.midi.map[60]), 'crash2');
  await p.evaluate(() => __midiFixture.port.onmidimessage({ data: [0x99, 60, 110], timeStamp: performance.now() }));
  assert.match(await p.locator('#lastHit').innerText(), /Crash 2/);
  await p.evaluate(() => { __midiFixture.port.onmidimessage({ data: [0xb9, 4, 127], timeStamp: performance.now() }); __midiFixture.port.onmidimessage({ data: [0xa9, 57, 127], timeStamp: performance.now() }); });
  assert.equal(await p.locator('.kit-svg rect[width="10"][height="140"]').count(), 2);
  await p.locator('#mapReset').click(); assert.equal(await p.evaluate(() => __qa.midi.map[60]), undefined);
});

for (const mode of ['unsupported', 'denied', 'empty']) await scenario(`MIDI ${mode}: keyboard fallback still works`, async p => {
  assert.match(await p.locator('#midiStatus').innerText(), /Bez bubnja/);
  await p.keyboard.press('f'); assert.match(await p.locator('#lastHit').innerText(), /Dobos/);
}, { midiMode: mode });

await scenario('MIDI hot-plug updates connection status', async p => {
  await p.evaluate(() => { __midiFixture.access.inputs.clear(); __midiFixture.access.onstatechange(); });
  assert.match(await p.locator('#midiStatus').innerText(), /Bez bubnja/);
  await p.evaluate(() => { __midiFixture.access.inputs.set('qa-input', __midiFixture.port); __midiFixture.access.onstatechange(); });
  assert.match(await p.locator('#midiStatus').innerText(), /Simulated TD-17/);
});

await scenario('Scheduler: metronome subdivisions, quiet bars and MIDI output', async p => {
  const result = await p.evaluate(async () => {
    const { blankPattern } = await import('/js/patterns.js'); __qa.loadPattern(blankPattern({ bpm: 120 }));
    await __qa.audio.ensure(); const clicks = []; __qa.audio.click = (...a) => clicks.push(a);
    __qa.settings.clickSub = 4; __qa.settings.quiet = 'alt'; __qa.settings.metro = true;
    for (let i = 0; i < 32; i++) __qa.scheduleSlot(i, __qa.audio.time + i * .125);
    __qa.pattern.steps.snare[0] = 3; __qa.settings.playPattern = true; __qa.midi.outId = 'qa-output';
    __qa.scheduleSlot(32, __qa.audio.time + 5);
    return { clicks: clicks.length, sent: __midiFixture.sent.map(x => x[0]) };
  });
  assert.equal(result.clicks, 17); assert.deepEqual(result.sent, [[0x99, 38, 122], [0x89, 38, 0]]);
});

await scenario('Single pass automatically stops and counts all 12 missed notes', async p => {
  await p.locator('#countIn').uncheck(); await p.locator('#loop').uncheck();
  await p.locator('#bpm').fill('260'); await p.locator('#bpm').press('Tab'); await p.locator('#playBtn').click();
  await p.waitForFunction(() => !__qa.play.on, { timeout: 5000 });
  assert.equal(await p.evaluate(() => __qa.scorer.stats().all.miss), 12);
  assert.equal(await p.locator('#accuracy').innerText(), '0%');
});

await scenario('BUG: completed single pass is shown in pass history', async p => {
  await p.evaluate(async () => { __qa.settings.countIn = false; __qa.settings.loop = false; __qa.setBpm(260); await __qa.start(); });
  await p.waitForFunction(() => !__qa.play.on);
  assert.equal(await p.evaluate(() => __qa.play.loopScores.length), 1);
});

await scenario('BUG: count-in strikes do not reduce exercise accuracy', async p => {
  await p.locator('#playBtn').click(); await p.keyboard.press('f'); await p.locator('#playBtn').click();
  assert.equal(await p.evaluate(() => __qa.scorer.stats().all.extra), 0);
});

await scenario('Recording quantizes live hits and preserves dynamic accents', async p => {
  const r = await p.evaluate(async () => {
    const { blankPattern } = await import('/js/patterns.js'); __qa.loadPattern(blankPattern());
    __qa.settings.countIn = false; __qa.settings.record = true; await __qa.start(); clearInterval(__qa.play.timer);
    const t = performance.now(); __qa.play.firstPerf = t; __qa.play.cur = { n: 0, slot: 0, loop: 0, perf: t };
    __qa.onHit('snare', 122, t + 12); __qa.stop(); return __qa.pattern.steps.snare[0];
  }); assert.equal(r, 3);
});

await scenario('Trainer increases tempo for 90%+ pass and clamps maximum', async p => {
  const values = await p.evaluate(() => {
    __qa.settings.trainer.on = true; __qa.settings.trainer.step = 5; __qa.setBpm(258);
    __qa.scorer.record({ kind: 'good', inst: 'snare', err: 0, vel: 92, dynOk: true }, 0); __qa.finishLoop(0);
    return { bpm: __qa.pattern.bpm, scores: __qa.play.loopScores };
  }); assert.deepEqual(values, { bpm: 260, scores: [100] });
});

await scenario('BUG: concurrent Start requests create only one playback timer', async p => {
  const count = await p.evaluate(async () => {
    const saved = __qa.audio.ensure.bind(__qa.audio); await saved();
    let release; const gate = new Promise(r => release = r); __qa.audio.ensure = () => gate;
    const original = window.setInterval; let count = 0; const ids = [];
    window.setInterval = (...args) => { count++; const id = original(...args); ids.push(id); return id; };
    const first = __qa.start(), second = __qa.start(); release(); await Promise.all([first, second]);
    ids.forEach(clearInterval); __qa.stop(); window.setInterval = original; return count;
  }); assert.equal(count, 1);
});

await scenario('BUG: all 19 instruments produce non-silent synthesized audio', async p => {
  const energies = await p.evaluate(async () => {
    const { AudioEngine } = await import('/js/audio.js'); const { INSTRUMENTS } = await import('/js/patterns.js');
    const energies = {};
    for (const inst of INSTRUMENTS) {
      const ctx = new OfflineAudioContext(1, 48000, 48000), a = new AudioEngine();
      a.ctx = ctx; a.buses = { pattern: ctx.destination }; Object.defineProperty(a, 'ready', { value: true });
      a.noise = ctx.createBuffer(1, 48000, 48000); const d = a.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 123.456);
      a.play(inst.id, 0, .7); const rendered = await ctx.startRendering(); const samples = rendered.getChannelData(0);
      energies[inst.id] = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
    }
    return energies;
  });
  await writeFile(`${artifacts}/audio-energy.json`, JSON.stringify(energies, null, 2));
  assert.deepEqual(Object.entries(energies).filter(([, e]) => e < .00001).map(([id]) => id), []);
  return energies;
});

await scenario('Desktop and tablet layouts fit viewport without document overflow', async p => {
  for (const width of [1440, 1024, 768]) {
    await p.setViewportSize({ width, height: 900 }); await p.waitForTimeout(200);
    const r = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    assert.ok(r.scroll <= r.width, JSON.stringify(r));
  }
  await p.screenshot({ path: `${artifacts}/tablet.png`, fullPage: true });
});

await scenario('Phone layout at 390px fits viewport', async p => {
  const r = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  await p.screenshot({ path: `${artifacts}/phone.png`, fullPage: true });
  assert.ok(r.scroll <= r.width, JSON.stringify(r));
}, { viewport: { width: 390, height: 844 } });

await scenario('Narrow phone layout at 360px fits viewport', async p => {
  const r = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  assert.ok(r.scroll <= r.width, JSON.stringify(r));
}, { viewport: { width: 360, height: 800 } });

await scenario('Calibration estimates latency and rejects insufficient hits', async p => {
  const r = await p.evaluate(async () => {
    await __qa.audio.ensure();
    const realTimeout = window.setTimeout, realClick = __qa.audio.click.bind(__qa.audio);
    let complete; let clicks = [];
    window.setTimeout = (fn) => { complete = fn; return 0; };
    __qa.audio.click = t => clicks.push(__qa.audio.ctxToPerf(t));
    await __qa.runCalibration();
    for (const perf of clicks.slice(4)) __qa.onHit('snare', 92, perf + 37);
    complete(); const first = { calib: __qa.settings.calib, text: document.querySelector('#calibInfo').textContent };
    clicks = []; await __qa.runCalibration(); complete();
    const second = document.querySelector('#calibInfo').textContent;
    window.setTimeout = realTimeout; __qa.audio.click = realClick;
    return { first, second };
  });
  assert.ok(Math.abs(r.first.calib - 37) <= 1, JSON.stringify(r)); assert.match(r.first.text, /Gotovo/); assert.match(r.second, /Premalo/);
});

await scenario('WAV sample kit loads and missing kit falls back to synth', async p => {
  const samples = 4800, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(10000 * Math.sin(2 * Math.PI * 440 * i / 48000)), 44 + i * 2);
  await p.route('**/kits/qa/kit.json', route => route.fulfill({ json: { name: 'QA sine', instruments: { crash2: [{ file: 'test.wav', lo: 1, hi: 127 }] } } }));
  await p.route('**/kits/qa/test.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav }));
  await p.route('**/kits/missing/kit.json', route => route.fulfill({ status: 404, body: 'missing' }));
  const r = await p.evaluate(async () => {
    await __qa.chooseKit('qa'); const sample = __qa.audio.pickSample('crash2', .7);
    const duration = sample.buf.duration; __qa.audio.play('crash2', __qa.audio.time, .7);
    await __qa.chooseKit('missing'); return { duration, fallback: __qa.audio.kit === null, message: document.querySelector('#toast').textContent };
  });
  assert.ok(Math.abs(r.duration - .1) < .001); assert.equal(r.fallback, true); assert.match(r.message, /ugrađeni zvuk/);
});

await scenario('BUG: failed persistent save must not report success', async p => {
  p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Unsaved QA' : undefined));
  await p.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Test quota', 'QuotaExceededError'); }; });
  await lib(p); await p.locator('#saveBtn').click();
  assert.doesNotMatch(await p.locator('#toast').innerText(), /^Sačuvano:/);
});

await scenario('Continuous playback completes eight loops without growing pending queue', async p => {
  await p.evaluate(async () => { __qa.settings.countIn = false; __qa.setBpm(260); await __qa.start(); });
  await p.waitForFunction(() => __qa.play.loopScores.length >= 8, null, { timeout: 15000 });
  const r = await p.evaluate(() => { const result = { loops: __qa.play.loopScores.length, pending: __qa.scorer.pending.length, queued: __qa.play.queue.length, misses: __qa.scorer.stats().all.miss }; __qa.stop(); return result; });
  assert.ok(r.loops >= 8); assert.ok(r.pending < 16); assert.ok(r.queued < 8); assert.ok(r.misses >= 96);
  return r;
});

// Functional acceptance scenarios for the five new practice features.
const STUDIO_SECTION = { focus: 'practice', program: 'practice', journal: 'results', replay: 'results', backing: 'song', arrangement: 'song' };
const showStudio = async (p, name) => { await p.locator(`#appNav [data-section=${STUDIO_SECTION[name]}]`).click(); await p.locator(`.subtabs [data-pane=${name}]`).click(); await p.waitForTimeout(150); };
const onePass = async (p, { perfect = false } = {}) => {
  await p.evaluate(async perfect => {
    __qa.settings.countIn = false; __qa.settings.loop = false; __qa.setBpm(260);
    if (perfect) {
      const original = __qa.scorer.expect.bind(__qa.scorer);
      __qa.scorer.expect = note => { original(note); __qa.onHit(note.inst, [0, 40, 92, 122][note.dyn], note.perf, 'midi'); };
    }
    await __qa.start();
  }, perfect);
  await p.waitForFunction(() => !__qa.play.on && __qa.studio.sessions.length > 0);
};
function wave(seconds = 8) {
  const samples = Math.round(48000 * seconds), wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / 48000)), 44 + i * 2);
  return wav;
}
const seedReplay = async p => {
  await p.evaluate(async () => {
    const { blankPattern } = await import('/js/patterns.js'), { practiceRange } = await import('/js/practice.js');
    const pattern = blankPattern({ name: 'QA performance', bpm: 120 });
    pattern.steps.crash2[0] = 3; pattern.steps.snare[4] = 2; pattern.steps.kick[8] = 2;
    const expected = [{ id: '0:0:crash2', inst: 'crash2', dyn: 3, slot: 0, loop: 0, timeMs: 0 },
      { id: '0:4:snare', inst: 'snare', dyn: 2, slot: 4, loop: 0, timeMs: 500 },
      { id: '0:8:kick', inst: 'kick', dyn: 2, slot: 8, loop: 0, timeMs: 1000 }];
    const hits = [{ inst: 'crash2', note: 52, vel: 122, timeMs: 20.25, err: 20.25, kind: 'good', source: 'midi', expectedId: '0:0:crash2', slot: 0, loop: 0 },
      { inst: 'snare', note: 40, vel: 33, timeMs: 550.75, err: 50.75, kind: 'ok', source: 'midi', expectedId: '0:4:snare', slot: 4, loop: 0 }];
    const session = { id: 'qa-performance', startedAt: '2026-10-19T10:00:00Z', pattern, range: practiceRange(pattern),
      bpmStart: 120, bpmEnd: 120, level: 'normalno', calib: 0, durationMs: 1500, hits, expected,
      timeline: Array.from({ length: 12 }, (_, slot) => ({ slot, loop: 0, timeMs: slot * 125, bpm: 120 })),
      passes: [], results: [{ inst: 'kick', kind: 'miss', slot: 8, loop: 0, expectedId: '0:8:kick' }],
      stats: { accuracy: 50, all: { good: 1, ok: 1, miss: 1, extra: 0 }, expected: 3, per: {} } };
    localStorage.setItem('drummer.sessions.v1', JSON.stringify([session]));
  });
  await p.reload(); await p.waitForFunction(() => !!globalThis.__qa); await p.evaluate(() => __qa.studio.journalReady);
};

await scenario('Feature: A-B scores only chosen bars and instruments while retaining other raw hits', async p => {
  await lib(p); await p.locator('#presets .load').filter({ hasText: 'Bossa nova' }).click();
  await showStudio(p, 'focus'); await p.locator('#focusOn').check();
  await p.locator('#focusFrom').selectOption('2'); await p.locator('#focusTo').selectOption('2'); await p.locator('#focusFeet').click();
  await p.locator('#countIn').uncheck(); await p.locator('#loop').uncheck();
  await p.locator('#bpm').fill('260'); await p.locator('#bpm').press('Tab'); await p.locator('#playBtn').click();
  await p.waitForFunction(() => __qa.play.cur?.n >= 0);
  await p.keyboard.press('f');
  await p.waitForFunction(() => !__qa.play.on);
  const result = await p.evaluate(async () => { await __qa.studio.journalReady; return await __qa.studio.loadSession(__qa.studio.sessions[0].id); });
  assert.equal(result.expected.length, 10); assert.ok(result.expected.every(e => e.slot >= 16 && e.slot < 32 && ['kick', 'hhp'].includes(e.inst)));
  assert.equal(result.stats.all.extra, 0); assert.equal(result.stats.all.miss, 10);
  assert.ok(result.hits.some(h => h.inst === 'snare' && h.kind === 'free'));
  assert.equal(result.range.from, 2); assert.equal(result.range.to, 2);
});

await scenario('Feature: empty instrument selection prevents starting with an explanation', async p => {
  await showStudio(p, 'focus'); await p.locator('#focusOn').check();
  for (const c of await p.locator('#focusInstruments input').all()) await c.uncheck();
  await p.locator('#playBtn').click(); assert.equal(await p.evaluate(() => __qa.play.on), false);
  assert.match(await p.locator('#toast').innerText(), /bar jedan instrument/);
});

await scenario('Feature: weak segment suggestion uses the last session and lowers tempo', async p => {
  await onePass(p); await showStudio(p, 'focus'); await p.locator('#focusSuggest').click();
  const r = await p.evaluate(() => ({ focus: __qa.studio.focus, bpm: __qa.pattern.bpm }));
  assert.equal(r.focus.enabled, true); assert.equal(r.focus.instruments.length, 1); assert.equal(r.bpm, 250);
});

await scenario('Feature: journal stores session, statistics and completed passes across reload', async p => {
  await onePass(p); const original = await p.evaluate(async () => { await __qa.studio.journalReady; return await __qa.studio.loadSession(__qa.studio.sessions[0].id); });
  assert.equal(original.stats.expected, 12); assert.equal(original.passes.length, 1); assert.equal(original.passes[0].score, 0);
  await p.reload(); await p.waitForFunction(() => !!globalThis.__qa); await p.evaluate(() => __qa.studio.journalReady);
  assert.equal(await p.evaluate(() => __qa.studio.sessions[0].id), original.id);
  await showStudio(p, 'journal'); assert.equal(await p.locator('#sessionList tr').count(), 1);
  assert.match(await p.locator('#sessionDetail').innerText(), /Hi-hat zatvoren/);
  await p.screenshot({ path: `${artifacts}/journal.png`, fullPage: true });
});

await scenario('Feature: original MIDI zone, velocity and fractional timing survive capture and reload', async p => {
  await p.evaluate(async () => { __qa.settings.countIn = false; __qa.settings.loop = false; __qa.setBpm(260); await __qa.start(); });
  await p.waitForFunction(() => __qa.scorer.pending.some(n => n.inst === 'snare'));
  const sent = await p.evaluate(() => {
    const note = __qa.scorer.pending.find(n => n.inst === 'snare');
    const timestamp = note.perf + 17.25;
    __midiFixture.port.onmidimessage({ data: [0x99, 40, 73], timeStamp: timestamp });
    return { relative: timestamp - __qa.studio.capture.firstPerf };
  });
  await p.waitForFunction(() => !__qa.play.on);
  await p.reload(); await p.waitForFunction(() => !!globalThis.__qa); await p.evaluate(() => __qa.studio.journalReady);
  const hit = await p.evaluate(async () => { await __qa.studio.journalReady; return (await __qa.studio.loadSession(__qa.studio.sessions[0].id)).hits[0]; });
  assert.equal(hit.note, 40); assert.equal(hit.vel, 73); assert.equal(hit.kind, 'good');
  assert.ok(Math.abs(hit.err - 17.25) < .00001, 'Fractional timing must survive floating-point clock subtraction');
  assert.ok(Math.abs(hit.timeMs - sent.relative) < .00001);
});

await scenario('Feature: journal compares matching sessions and reports the best 90-percent BPM', async p => {
  await onePass(p, { perfect: true });
  const first = await p.evaluate(async () => { await __qa.studio.journalReady; return await __qa.studio.loadSession(__qa.studio.sessions[0].id); }); assert.equal(first.stats.accuracy, 100);
  await p.reload(); await p.waitForFunction(() => !!globalThis.__qa); await p.evaluate(() => __qa.studio.journalReady);
  await onePass(p); await showStudio(p, 'journal'); await p.locator('#journalFilter').selectOption('current');
  assert.match(await p.locator('#sessionDetail').innerText(), /Promena: -100/);
  assert.match(await p.locator('#journalSummary').innerText(), /260/);
  assert.equal(await p.locator('#sessionList tr').count(), 2);
});

await scenario('Feature: failed journal save retains the performance and retry persists it', async p => {
  await p.evaluate(() => {
    window.__originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { const request = __originalPut.apply(this, args); if (this.name === 'events') this.transaction.abort(); return request; };
  });
  await onePass(p); assert.equal(await p.locator('#storageWarning').isVisible(), true);
  assert.equal(await p.evaluate(() => __qa.studio.sessions.length), 1);
  await p.evaluate(() => { IDBObjectStore.prototype.put = __originalPut; });
  await p.locator('#retryStorage').click(); await p.waitForFunction(() => __qa.studio.pendingSessions.size === 0);
  await p.reload(); await p.waitForFunction(() => !!globalThis.__qa); await p.evaluate(() => __qa.studio.journalReady);
  assert.equal(await p.evaluate(() => __qa.studio.sessions.length), 1);
});

await scenario('Feature: replay renders expected notes, real hits and misses without quantization', async p => {
  await seedReplay(p); await showStudio(p, 'replay');
  assert.equal(await p.locator('#replayHits tr').count(), 2);
  assert.match(await p.locator('#replayHits').innerText(), /0.020/); assert.match(await p.locator('#replayHits').innerText(), /52/);
  assert.equal(await p.locator('#replayChart circle[fill="none"]').count(), 1);
  assert.equal(await p.locator('#replayChart circle:not([fill="none"])').count(), 2);
  await p.screenshot({ path: `${artifacts}/replay.png`, fullPage: true });
});

await scenario('Feature: replay slows original timing, pauses, seeks and stops independently', async p => {
  await seedReplay(p); await showStudio(p, 'replay');
  await p.evaluate(() => { window.__sounds = []; const original = __qa.audio.play.bind(__qa.audio); __qa.audio.play = (...args) => { __sounds.push(args); return original(...args); }; });
  await p.locator('#replaySpeed').selectOption('0.5'); await p.locator('#replayPlay').click();
  await p.waitForFunction(() => __sounds.length > 0);
  const scheduling = await p.evaluate(() => ({ first: __sounds[0], start: __qa.studio.replay.startTime }));
  assert.equal(scheduling.first[0], 'crash2'); assert.ok(Math.abs(scheduling.first[1] - scheduling.start - .0405) < .00001);
  await p.locator('#replayPlay').click(); assert.equal(await p.evaluate(() => __qa.studio.replay.playing), false);
  await p.locator('#replaySeek').evaluate(el => { el.value = '500'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.locator('#replayPlay').click(); await p.waitForFunction(() => __sounds.some(s => s[0] === 'snare'));
  await p.locator('#replayStop').click(); assert.equal(await p.locator('#replaySeek').inputValue(), '0');
  assert.equal(await p.evaluate(() => __qa.studio.sessions.length), 1); assert.equal(await p.evaluate(() => __qa.play.on), false);
});

await scenario('Feature: MIDI and JSON exports retain recorded notes and velocity', async p => {
  await seedReplay(p); await showStudio(p, 'replay');
  const { readFile } = await import('node:fs/promises');
  let promise = p.waitForEvent('download'); await p.locator('#replayMidi').click(); let download = await promise;
  const midiPath = `${artifacts}/performance.mid`; await download.saveAs(midiPath); const bytes = await readFile(midiPath);
  assert.equal(bytes.subarray(0, 4).toString(), 'MThd'); assert.ok(bytes.includes(Buffer.from([0x99, 52, 122]))); assert.ok(bytes.includes(Buffer.from([0x99, 40, 33])));
  promise = p.waitForEvent('download'); await p.locator('#replayJson').click(); download = await promise;
  const jsonPath = `${artifacts}/performance.json`; await download.saveAs(jsonPath); const data = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.deepEqual(data.hits.map(h => h.timeMs), [20.25, 550.75]);
});

await scenario('Feature: backing WAV, A-B, first beat and half-speed share the audio clock', async p => {
  await lib(p); await p.locator('#presets .load').filter({ hasText: 'Bossa nova' }).click();
  await showStudio(p, 'focus'); await p.locator('#focusOn').check(); await p.locator('#focusFrom').selectOption('2'); await p.locator('#focusTo').selectOption('2');
  await showStudio(p, 'backing');
  await p.locator('#backingFile').setInputFiles({ name: 'qa-song.wav', mimeType: 'audio/wav', buffer: wave() });
  await p.waitForFunction(() => !!__qa.studio.backing.buffer);
  await p.locator('#backingBpm').fill('120'); await p.locator('#backingBpm').press('Tab');
  await p.locator('#backingOffset').fill('0.5'); await p.locator('#backingOffset').press('Tab'); await p.locator('#backingSpeed').selectOption('0.5');
  assert.equal(await p.locator('#bpm').inputValue(), '60'); await p.locator('#countIn').uncheck();
  await p.evaluate(() => {
    window.__backingStarts = []; window.__clickTimes = [];
    const ctx = __qa.audio.ctx, create = ctx.createBufferSource.bind(ctx), click = __qa.audio.click.bind(__qa.audio);
    ctx.createBufferSource = () => { const source = create(), start = source.start.bind(source); source.start = (...args) => { if (source.buffer === __qa.studio.backing.buffer) __backingStarts.push([...args, source.playbackRate.value]); return start(...args); }; return source; };
    __qa.audio.click = (...args) => { __clickTimes.push(args[0]); return click(...args); };
  });
  await p.locator('#playBtn').click(); await p.waitForFunction(() => __backingStarts.length > 0);
  const actual = await p.evaluate(() => ({ source: __backingStarts[0], click: __clickTimes[0] }));
  assert.equal(actual.source[0], actual.click); assert.deepEqual(actual.source.slice(1), [2.5, 2, .5]);
  assert.equal(await p.locator('#bpm').isDisabled(), true);
  await p.locator('#playBtn').click(); assert.equal(await p.evaluate(() => __qa.studio.backing.sources.size), 0);
  await p.screenshot({ path: `${artifacts}/backing.png`, fullPage: true });
});

await scenario('Feature: backing starts after count-in and repeats selected audio segment', async p => {
  await p.evaluate(() => __qa.setBpm(260)); await showStudio(p, 'backing');
  await p.locator('#backingFile').setInputFiles({ name: 'qa-count.wav', mimeType: 'audio/wav', buffer: wave(4) });
  await p.waitForFunction(() => !!__qa.studio.backing.buffer);
  await p.evaluate(() => {
    window.__starts = []; window.__clicks = [];
    const backing = __qa.studio.backing, schedule = backing.schedule.bind(backing), click = __qa.audio.click.bind(__qa.audio);
    backing.schedule = (...args) => { __starts.push(args[0]); return schedule(...args); };
    __qa.audio.click = (...args) => { __clicks.push(args[0]); return click(...args); };
  });
  await p.locator('#playBtn').click(); await p.waitForFunction(() => __starts.length >= 2);
  const r = await p.evaluate(() => ({ starts: __starts, clicks: __clicks }));
  assert.ok(Math.abs(r.starts[0] - r.clicks[0] - 4 * 60 / 260) < .001);
  assert.ok(Math.abs(r.starts[1] - r.starts[0] - 4 * 60 / 260) < .001);
  await p.locator('#playBtn').click();
});

await scenario('Feature: invalid backing file and out-of-file loop fail without starting playback', async p => {
  await showStudio(p, 'backing'); await p.locator('#backingFile').setInputFiles({ name: 'bad.wav', mimeType: 'audio/wav', buffer: Buffer.from('bad') });
  await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('nije mogao'));
  await p.locator('#backingFile').setInputFiles({ name: 'short.wav', mimeType: 'audio/wav', buffer: wave(.1) });
  await p.waitForFunction(() => !!__qa.studio.backing.buffer);
  await p.locator('#playBtn').click(); assert.equal(await p.evaluate(() => __qa.play.on), false); assert.match(await p.locator('#toast').innerText(), /izlaze iz pesme/);
  await p.locator('#backingRemove').click(); assert.equal(await p.evaluate(() => __qa.studio.backing.buffer), null);
});

const setupProgram = async (p, rest = 0) => {
  await showStudio(p, 'program'); await p.locator('#programName').fill('QA routine'); await p.locator('#programAdd').click();
  for (const [field, value] of [['seconds', '1'], ['bpm', '260'], ['rest', String(rest)], ['target', '0']]) {
    const input = p.locator(`[data-field=${field}][data-index="0"]`); await input.fill(value); await input.press('Tab');
  }
  await lib(p); await p.locator('#presets .load').filter({ hasText: 'Shuffle (triole)' }).click(); await showStudio(p, 'program'); await p.locator('#programAdd').click();
  for (const [field, value] of [['seconds', '1'], ['bpm', '250'], ['rest', '0'], ['target', '90']]) {
    const input = p.locator(`[data-field=${field}][data-index="1"]`); await input.fill(value); await input.press('Tab');
  }
  await p.locator('#countIn').uncheck();
};

await scenario('Feature: program persists snapshots, runs sequentially and stores both outcomes', async p => {
  await setupProgram(p); await p.locator('#programSave').click(); const id = await p.locator('#programSelect').inputValue();
  await p.reload(); await p.waitForFunction(() => !!globalThis.__qa); await p.evaluate(() => __qa.studio.journalReady); await showStudio(p, 'program'); await p.locator('#programSelect').selectOption(id);
  assert.equal(await p.locator('.program-entry').count(), 2); assert.equal(await p.locator('#programName').inputValue(), 'QA routine');
  await p.locator('#programStart').click(); await p.waitForFunction(() => !__qa.studio.run && __qa.studio.sessions.length === 2, null, { timeout: 10000 });
  const sessions = await p.evaluate(() => __qa.studio.sessions);
  assert.deepEqual(sessions.map(s => s.pattern.name), ['Shuffle (triole)', 'Osnovni rok']);
  assert.deepEqual(sessions.map(s => s.bpmStart), [250, 260]); assert.equal(sessions[0].routine.id, sessions[1].routine.id);
  assert.match(await p.locator('#programStatus').innerText(), /Program je završen/);
  assert.equal(await p.locator('#programResults .pass').count(), 1); assert.equal(await p.locator('#programResults .fail').count(), 1);
  await p.screenshot({ path: `${artifacts}/program.png`, fullPage: true });
});

await scenario('Feature: stopping a program during its break cancels the next exercise', async p => {
  await setupProgram(p, 2); await p.locator('#programStart').click();
  await p.waitForFunction(() => !!__qa.studio.run?.restUntil, null, { timeout: 6000 });
  await p.locator('#programStop').click(); await p.waitForTimeout(2400);
  assert.equal(await p.evaluate(() => __qa.studio.run), null); assert.equal(await p.evaluate(() => __qa.play.on), false);
  assert.equal(await p.evaluate(() => __qa.studio.sessions.length), 1);
});

await scenario('Feature: canceling pending audio initialization cannot start a stale session', async p => {
  const result = await p.evaluate(async () => {
    let release; __qa.audio.ensure = () => new Promise(resolve => release = resolve);
    const pending = __qa.start(); __qa.stop(); release(); const started = await pending;
    return { started, playing: __qa.play.on, starting: __qa.play.starting, capture: __qa.studio.capture, sessions: __qa.studio.sessions.length };
  });
  assert.deepEqual(result, { started: false, playing: false, starting: false, capture: null, sessions: 0 });
});

await scenario('Feature: all five studio panels fit desktop, tablet and phone widths', async p => {
  for (const width of [1440, 768, 390, 360]) {
    await p.setViewportSize({ width, height: 1000 }); await p.waitForTimeout(150);
    for (const panel of ['focus', 'journal', 'backing', 'program', 'replay']) {
      await showStudio(p, panel);
      const r = await p.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(r.scroll <= r.width, `${panel}: ${JSON.stringify(r)}`);
    }
  }
  await showStudio(p, 'focus'); await p.screenshot({ path: `${artifacts}/studio-phone.png`, fullPage: true });
});

await scenario('Feature: Space operates focused controls without unexpectedly starting a session', async p => {
  await p.locator('#countIn').focus(); await p.keyboard.press('Space');
  assert.equal(await p.locator('#countIn').isChecked(), false);
  assert.equal(await p.evaluate(() => __qa.play.on), false);
  await p.locator('#playBtn').focus(); await p.keyboard.press('Space');
  await p.waitForFunction(() => __qa.play.on);
  await p.keyboard.press('Space'); await p.waitForFunction(() => !__qa.play.on);
});

await scenario('Feature: corrupt journal fields remain readable and safe after reload', async p => {
  await seedReplay(p);
  await p.evaluate(async () => {
    const s = await __qa.studio.journal.get(__qa.studio.sessions[0].id); s.bpmStart = '<img src=x onerror=alert(1)>'; s.hits[0].err = 'bad';
    s.timeline[0].loop = '<img>'; s.stats.per = { snare: null }; s.stats.accuracy = '<img>';
    await __qa.studio.journal.put(s);
  });
  await p.reload(); await p.waitForFunction(() => !!globalThis.__qa); await p.evaluate(() => __qa.studio.journalReady);
  await showStudio(p, 'journal'); await showStudio(p, 'replay');
  assert.equal(await p.locator('#replayHits tr').count(), 2);
  assert.equal(await p.locator('#sections img').count(), 0);
  assert.equal(await p.evaluate(async () => (await __qa.studio.loadSession(__qa.studio.sessions[0].id)).hits[0].err), null);
});

await scenario('Feature: backing volume changes live and speed choices respect tempo limits', async p => {
  await showStudio(p, 'backing');
  await p.locator('#backingFile').setInputFiles({ name: 'qa-volume.wav', mimeType: 'audio/wav', buffer: wave(12) });
  await p.waitForFunction(() => !!__qa.studio.backing.buffer);
  await p.locator('#backingBpm').fill('30'); await p.locator('#backingBpm').press('Tab');
  assert.equal(await p.locator('#backingSpeed option[value="0.5"]').evaluate(option => option.disabled), true);
  await p.locator('#backingBpm').fill('260'); await p.locator('#backingBpm').press('Tab');
  assert.equal(await p.locator('#backingSpeed option[value="1.25"]').evaluate(option => option.disabled), true);
  await p.locator('#countIn').uncheck(); await p.locator('#playBtn').click();
  await p.waitForFunction(() => __qa.studio.backing.sources.size > 0);
  await p.locator('#backingVolume').evaluate(el => { el.value = '0.2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForFunction(() => [...__qa.studio.backing.sources].every(s => Math.abs(s.mixGain.gain.value - .2) < .01));
  assert.equal(await p.evaluate(() => __qa.studio.backing.volume), .2);
  await p.locator('#playBtn').click();
});

const browserVersion = browser.version();
await browser.close();
const report = { browser: channel || 'Chromium', browserVersion, generatedAt: new Date().toISOString(), sourceCommit: 'b9199e027af2c76b99e67a5dc48835f87daac57f', localChange: 'Nine bug fixes and five practice features', passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length, results };
await writeFile(`${artifacts}/${channel ? `${channel}-` : ''}browser-results.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, failed: report.failed }));
process.exitCode = report.failed ? 1 : 0;
