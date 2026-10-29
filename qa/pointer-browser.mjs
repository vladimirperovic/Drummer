import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const channel = process.env.DRUMMER_BROWSER || '';
const dir = fileURLToPath(new URL(`./artifacts/pointer/${channel || 'chromium'}/`, import.meta.url));
await mkdir(dir, { recursive: true });
// Keep normal autoplay restrictions: the first real pointer gesture must unlock sound.
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}), args: ['--enable-unsafe-swiftshader'] });
const results = [];
const bridge = `
globalThis.__pointerQA = { kit, settings, audio, studio, play, start, stop, applyKit, get pattern() { return pattern; }, hits: [], sounds: [], peak: 0 };
const hitBeforeTest = onHit;
onHit = (...args) => { __pointerQA.hits.push(args); return hitBeforeTest(...args); };
const playBeforeTest = audio.play.bind(audio);
audio.play = (...args) => {
  if (args[3] === 'live') {
    __pointerQA.sounds.push(args);
    if (!__pointerQA.analyser) {
      const analyser = __pointerQA.analyser = audio.ctx.createAnalyser(); analyser.fftSize = 256; audio.buses.live.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const sample = () => { analyser.getFloatTimeDomainData(samples); __pointerQA.peak = Math.max(__pointerQA.peak, ...samples.map(Math.abs)); requestAnimationFrame(sample); }; sample();
    }
  }
  return playBeforeTest(...args);
};`;
async function scenario(name, fn, options = {}) {
  if (process.env.DRUMMER_CASE && !new RegExp(process.env.DRUMMER_CASE).test(name)) return;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: options.offline ? 'allow' : 'block' });
  const p = await context.newPage(), errors = [];
  p.setDefaultTimeout(10000); p.on('pageerror', error => errors.push(error.message));
  await p.addInitScript(() => {
    if (localStorage.getItem('drummer.language.v1') == null) localStorage.setItem('drummer.language.v1', 'sr');
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => ({ inputs: new Map(), outputs: new Map() }) });
  });
  if (!options.offline) await p.route('**/js/main.js', async route => {
    const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + bridge });
  });
  if (options.missingMap) await p.route('**/assets/kit/pick-map.png', route => route.abort());
  try {
    await p.goto(base); await p.locator('#kitPlayHint').waitFor();
    if (!options.offline) await p.waitForFunction(() => !!globalThis.__pointerQA);
    await fn(p, context); assert.deepEqual(errors, []);
    results.push({ name, status: 'PASS' }); console.log('PASS ' + name);
  } catch (error) {
    await p.screenshot({ path: dir + `failure-${results.length + 1}.png`, fullPage: true }).catch(() => {});
    results.push({ name, status: 'FAIL', error: error.stack, errors }); console.log('FAIL ' + name + ': ' + error.message);
  } finally { await context.close(); }
}
async function rasterPoint(p, id) {
  await p.locator('#kit2dHost').scrollIntoViewIfNeeded();
  await p.locator('[data-play-ready=true]').waitFor();
  return p.evaluate(async id => {
    const { KIT_ART: art } = await import('/js/kit-art-data.js');
    const image = new Image(); image.src = '/assets/kit/pick-map.png'; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = art.width; canvas.height = art.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); const pixels = ctx.getImageData(0, 0, art.width, art.height).data;
    const color = art.pickColors[id], center = art.pads[id].center; let best = null, distance = Infinity;
    for (let y = 1; y < art.height - 1; y++) for (let x = 1; x < art.width - 1; x++) {
      const offset = (y * art.width + x) * 4;
      if (!color.every((v, i) => pixels[offset + i] === v)) continue;
      const d = (x - center[0]) ** 2 + (y - center[1]) ** 2;
      if (d < distance) { best = [x + .5, y + .5]; distance = d; }
    }
    if (!best) throw Error('No visible raster target: ' + id);
    const point = new DOMPoint(...best).matrixTransform(document.querySelector('#kit2dHost svg').getScreenCTM());
    return { x: point.x, y: point.y };
  }, id);
}
async function vectorPoint(p, id) {
  await p.locator('#kit2dHost').scrollIntoViewIfNeeded();
  return p.evaluate(id => {
    const node = document.querySelector(`[data-play-pad="${id}"]`), b = node.getBBox(), m = node.getScreenCTM();
    // Find a visible point, respecting overlap by other parts and the separate bell/rim.
    const center = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(m);
    const candidates = [center];
    for (let y = 0; y <= 24; y++) for (let x = 0; x <= 24; x++) candidates.push(new DOMPoint(b.x + b.width * x / 24, b.y + b.height * y / 24).matrixTransform(m));
    const point = candidates.find(p => document.elementFromPoint(p.x, p.y)?.closest('[data-play-pad]')?.dataset.playPad === id);
    if (!point) throw Error('No visible vector target: ' + id);
    return { x: point.x, y: point.y };
  }, id);
}
async function click(p, point, id, options = {}) {
  const before = await p.evaluate(() => __pointerQA.hits.length);
  await p.mouse.click(point.x, point.y, options);
  await p.waitForFunction(n => __pointerQA.sounds.length >= n, before + 1);
  const data = await p.evaluate(() => ({ hits: __pointerQA.hits, sounds: __pointerQA.sounds }));
  assert.equal(data.hits.length, before + 1, 'one hit per press'); assert.equal(data.sounds.length, before + 1, 'one sound per press');
  assert.equal(data.hits.at(-1)[0], id); assert.equal(data.hits.at(-1)[3], 'mouse'); assert.equal(data.sounds.at(-1)[0], id);
}
async function expanded(p) {
  await p.locator('#kitConfigurator summary').click(); await p.locator('#kitPreset').selectOption('expanded'); await p.locator('#kitConfigurator summary').click();
}
async function start(p) {
  await p.locator('#countIn').uncheck(); await p.locator('#metro').uncheck(); await p.locator('#playPattern').check(); await p.locator('#playBtn').click();
  await p.waitForFunction(() => __pointerQA.play.on && __pointerQA.play.cur && performance.now() > __pointerQA.play.firstPerf + 50);
}
const standard = { kick: 'kick', snare: 'snare', tom1: 'tom1', tom2: 'tom2', tom3: 'tom3', hihat: 'hh', crash: 'crash', crash2: 'crash2', ride: 'ride', bell: 'bell', rim: 'xstick', hhpedal: 'hhp' };

await scenario('Pointer: all twelve standard 2D targets sound while stopped, with monitoring off', async p => {
  const initial = await p.evaluate(() => JSON.stringify(__pointerQA.pattern));
  assert.equal(await p.locator('#liveSound').isChecked(), false);
  for (const [target, id] of Object.entries(standard)) await click(p, await rasterPoint(p, target), id);
  assert.equal(await p.evaluate(() => __pointerQA.audio.ready), true);
  assert.ok(await p.evaluate(() => __pointerQA.peak > .001), 'non-silent live audio waveform');
  assert.equal(await p.evaluate(() => JSON.stringify(__pointerQA.pattern)), initial);
  assert.equal(await p.evaluate(() => __pointerQA.play.on), false);
});
await scenario('Pointer: live clicks keep playback running, score once and do not edit with Record off', async p => {
  await start(p); const before = await p.evaluate(() => JSON.stringify(__pointerQA.pattern));
  for (const [target, id] of Object.entries(standard)) await click(p, await rasterPoint(p, target), id);
  assert.equal(await p.evaluate(() => __pointerQA.play.on), true);
  assert.equal(await p.evaluate(() => JSON.stringify(__pointerQA.pattern)), before);
  const hits = await p.evaluate(() => __pointerQA.studio.capture.hits);
  assert.equal(hits.length, 12); assert.ok(hits.every(h => h.source === 'mouse')); assert.ok(hits.every(h => h.kind !== 'free'));
  await p.locator('#playBtn').click();
  assert.equal(await p.evaluate(async () => {
    await __pointerQA.studio.flushJournal();
    return (await __pointerQA.studio.loadSession(__pointerQA.studio.sessions.at(-1).id)).hits.length;
  }), 12);
});
await scenario('Pointer: Record writes the clicked instrument and dynamics only during playback', async p => {
  await p.locator('#record').check();
  const initial = await p.evaluate(() => JSON.stringify(__pointerQA.pattern));
  await click(p, await rasterPoint(p, 'ride'), 'ride');
  assert.equal(await p.evaluate(() => JSON.stringify(__pointerQA.pattern)), initial);
  await start(p); await p.keyboard.down('Shift'); await click(p, await rasterPoint(p, 'ride'), 'ride'); await p.keyboard.up('Shift');
  assert.ok(await p.evaluate(() => __pointerQA.pattern.steps.ride.includes(3)));
  await p.keyboard.down('Alt'); await click(p, await rasterPoint(p, 'tom3'), 'tom3'); await p.keyboard.up('Alt');
  assert.ok(await p.evaluate(() => __pointerQA.pattern.steps.tom3.includes(1)));
  const hits = await p.evaluate(() => __pointerQA.hits); assert.equal(hits.at(-2)[1], 122); assert.equal(hits.at(-1)[1], 40);
  await p.locator('#playBtn').click();
});
await scenario('Pointer: expanded 2D includes both bass drums, snares, three rack toms and pedals', async p => {
  await expanded(p);
  const targets = { ...standard, kick2: 'kick2', snare2: 'snare2', rim2: 'xstick2', tom4: 'tom4', floor2: 'floor2', crash3: 'crash3' };
  for (const [target, id] of Object.entries(targets)) await click(p, await vectorPoint(p, target), id);
  await p.locator('#kitConfigurator summary').click(); await p.locator('#kitHand').selectOption('left'); await p.locator('#kitConfigurator summary').click();
  for (const id of ['kick', 'kick2', 'snare2', 'floor2']) await click(p, await vectorPoint(p, id), id);
});
await scenario('Pointer: moving a part stays silent, then its new location plays without duplicate listeners', async p => {
  await p.locator('#kitMove').click(); const point = await vectorPoint(p, 'snare');
  await p.mouse.move(point.x, point.y); await p.mouse.down(); await p.mouse.move(point.x - 70, point.y + 35, { steps: 8 }); await p.mouse.up();
  assert.equal(await p.evaluate(() => __pointerQA.hits.length), 0); assert.ok(await p.evaluate(() => __pointerQA.settings.kitConfig.offsets.snare));
  await p.locator('#kitMove').click(); await click(p, await vectorPoint(p, 'snare'), 'snare');
  for (let n = 0; n < 3; n++) { await p.locator('#kitMove').click(); await p.locator('#kitMove').click(); }
  await click(p, await vectorPoint(p, 'snare'), 'snare');
  await p.locator('#kitLayoutReset').click(); await click(p, await rasterPoint(p, 'snare'), 'snare');
  await p.reload(); await click(p, await rasterPoint(p, 'snare'), 'snare');
});
await scenario('Pointer: 3D parts play immediately without camera motion; background still rotates', async p => {
  await expanded(p); await p.locator('#kit3d').click(); await p.locator('#kit3dHost canvas').waitFor(); await p.locator('#kit3dHost').scrollIntoViewIfNeeded();
  const originalBounds = await p.locator('#kit3dHost canvas').boundingBox();
  const points = await p.evaluate(async () => {
    const T = await import('/js/vendor/three.module.js'), k = __pointerQA.kit.three, ray = new T.Raycaster(), r = k.renderer.domElement.getBoundingClientRect(), found = {};
    k.camera.updateMatrixWorld(); k.scene.updateMatrixWorld(true);
    // Locate each visible assembly using only the closest mesh's owning part.
    for (let y = r.y + 3; y < r.bottom; y += 4) for (let x = r.x + 3; x < r.right; x += 4) {
      ray.setFromCamera(new T.Vector2((x - r.x) / r.width * 2 - 1, 1 - (y - r.y) / r.height * 2), k.camera);
      const hit = ray.intersectObjects([...k.partGroups.values()], true).find(h => h.object.isMesh); if (!hit) continue;
      let part = hit.object; while (part && !part.userData.part) part = part.parent;
      let pad = hit.object; while (pad && !pad.userData.pad && !pad.userData.part) pad = pad.parent;
      if (part && (pad.userData.pad || pad.userData.part) === part.userData.part) found[part.userData.part] ||= { x, y };
    }
    return found;
  });
  assert.equal(Object.keys(points).length, 14);
  const camera = await p.evaluate(() => __pointerQA.kit.three.camera.position.toArray());
  for (const [target, point] of Object.entries(points)) await click(p, point, target === 'hihat' ? 'hh' : target);
  assert.deepEqual(await p.evaluate(() => __pointerQA.kit.three.camera.position.toArray()), camera);
  const point = points.floor2, before = await p.evaluate(() => __pointerQA.hits.length);
  await p.mouse.move(point.x, point.y); await p.mouse.down();
  assert.equal(await p.evaluate(() => __pointerQA.hits.length), before + 1, 'sounds before release');
  await p.mouse.move(point.x + 40, point.y + 20, { steps: 5 }); await p.mouse.up();
  assert.deepEqual(await p.evaluate(() => __pointerQA.kit.three.camera.position.toArray()), camera);
  await p.locator('#kitMove').click(); await p.mouse.click(points.snare.x, points.snare.y); assert.equal(await p.evaluate(() => __pointerQA.hits.length), before + 1); await p.locator('#kitMove').click();
  const r = await p.locator('#kit3dHost canvas').boundingBox();
  await p.mouse.move(r.x + 12, r.y + 12); await p.mouse.down(); await p.mouse.move(r.x + 112, r.y + 22, { steps: 10 }); await p.mouse.up();
  assert.notDeepEqual(await p.evaluate(() => __pointerQA.kit.three.camera.position.toArray()), camera);
  assert.equal(await p.evaluate(() => __pointerQA.hits.length), before + 1);
  await p.locator('#kitReset').click(); await start(p); await p.locator('#kit3dHost').scrollIntoViewIfNeeded();
  const liveBounds = await p.locator('#kit3dHost canvas').boundingBox();
  await click(p, { x: points.floor2.x + liveBounds.x - originalBounds.x, y: points.floor2.y + liveBounds.y - originalBounds.y }, 'floor2');
  assert.equal(await p.evaluate(() => __pointerQA.play.on), true);
  assert.equal(await p.evaluate(() => __pointerQA.studio.capture.hits.at(-1).inst), 'floor2');
  assert.equal(await p.evaluate(() => __pointerQA.studio.capture.hits.at(-1).source), 'mouse');
  await p.locator('#playBtn').click();
});
await scenario('Pointer: rapid repeated clicks, right-click and empty background do not duplicate hits', async p => {
  const point = await rasterPoint(p, 'snare');
  for (let n = 0; n < 10; n++) await p.mouse.click(point.x, point.y);
  await p.waitForFunction(() => __pointerQA.sounds.length === 10);
  const r = await p.locator('#kit2dHost svg').boundingBox(); await p.mouse.click(r.x + 2, r.y + 2); await p.mouse.click(point.x, point.y, { button: 'right' });
  assert.equal(await p.evaluate(() => __pointerQA.hits.length), 10);
  await p.locator('#liveSound').check(); await click(p, point, 'snare');
});
await scenario('Pointer: mobile English layout and no picking image retain playable 2D fallback', async p => {
  await p.locator('.configured-kit').waitFor(); await p.locator('#languageSelect').selectOption('en'); await p.setViewportSize({ width: 390, height: 844 });
  assert.match(await p.locator('#kitPlayHint').innerText(), /Click a part to play/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await click(p, await vectorPoint(p, 'snare'), 'snare'); await p.locator('#view-kit').screenshot({ path: dir + 'phone-playing.png' });
}, { missingMap: true });
await scenario('Pointer: offline reload retains fixed 2D picking and first 3D opening', async (p, context) => {
  await p.evaluate(async () => navigator.serviceWorker.ready); await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true); await p.reload(); const point = await rasterPoint(p, 'snare'); await p.mouse.click(point.x, point.y);
  await p.waitForFunction(() => document.querySelector('#lastHit').textContent.includes('Dobos'));
  assert.ok(await p.locator('.overlay[data-pad=snare]').evaluate(e => e.getAnimations().length > 0));
  await p.locator('#kit3d').click(); await p.locator('#kit3dHost canvas').waitFor(); assert.equal(await p.locator('#kit3d').getAttribute('aria-pressed'), 'true');
}, { offline: true });

const summary = { browserVersion: browser.version(), generatedAt: new Date().toISOString(), passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length, results };
await writeFile(dir + 'results.json', JSON.stringify(summary, null, 2)); await browser.close();
console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed })); if (summary.failed) process.exitCode = 1;
