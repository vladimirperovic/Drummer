import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const artifacts = resolve(process.env.DRUMMER_ARTIFACTS || 'qa/artifacts/routing-performance'); await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const bridge = ';globalThis.__routingQA = { midi, profiles, kit, settings, play, start, stop };';
const results = [], metrics = {};
async function scenario(name, run) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('drummer.language.v1', 'sr');
    const a = { id: 'kit-a', name: 'Identical MIDI controller' }, b = { id: 'kit-b', name: 'Identical MIDI controller' };
    window.__routingPorts = { a, b }; window.__routingSent = { a: [], b: [] };
    const outputs = new Map([['out-a', { id: 'out-a', name: 'Output A', send: (...v) => __routingSent.a.push(v), clear() {} }], ['out-b', { id: 'out-b', name: 'Output B', send: (...v) => __routingSent.b.push(v), clear() {} }]]);
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => ({ inputs: new Map([['kit-a', a], ['kit-b', b]]), outputs }) });
  });
  await page.route('**/js/main.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + bridge }); });
  await page.route('**/js/kit-3d.js', async route => {
    const response = await route.fetch(), body = await response.text();
    const exposed = 'camera, targets, renderer, scene, partGroups,';
    assert.ok(body.includes(exposed), '3D scheduling probe must attach to the live instance');
    await route.fulfill({ response, body: body.replace(exposed,
      'get __qaPendingFrame() { return frameId; }, get __qaActive() { return active(); }, ' + exposed) });
  });
  try {
    await page.goto(base); await page.waitForFunction(() => !!globalThis.__routingQA && !!__routingPorts.a.onmidimessage);
    await run(page); assert.deepEqual(errors, []); results.push({ name, status: 'PASS' }); console.log('PASS ' + name);
  } catch (error) {
    const screenshot = resolve(artifacts, `failure-${results.length + 1}.png`); await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    results.push({ name, status: 'FAIL', error: error.stack, errors, screenshot }); console.error('FAIL ' + name + ': ' + error.stack);
  } finally { await context.close(); }
}
const openRouting = async page => { await page.locator('[data-panel=settings]').click(); await page.locator('#midiRouting summary').click(); };
// Orbit damping converges per rendered frame, so elapsed time depends on GPU speed.
// Wait for the actual visible scheduler to drain; a continuously rendering kit
// still fails this bounded wait and the subsequent exact zero-frame assertions.
const waitForIdleKit = page => page.waitForFunction(() => {
  const kit = __routingQA.kit.three;
  return kit?.__qaActive && kit.__qaPendingFrame === 0;
}, null, { timeout: 15000, polling: 50 });

await scenario('Routing UI learns real device/channel, shares no note collisions, and persists after reload', async page => {
  await openRouting(page); await page.locator('#routingInstrument').selectOption('crash2'); await page.locator('#routingLearn').click();
  assert.equal(await page.locator('#routingInstrument option[value=crash2]').textContent(), 'Crash 2');
  assert.match(await page.locator('#routingDevice option[value=kit-a]').textContent(), /kit-a/);
  assert.match(await page.locator('#routingDevice option[value=kit-b]').textContent(), /kit-b/);
  await page.evaluate(() => __routingPorts.b.onmidimessage({ data: [0x93, 38, 92], timeStamp: performance.now() }));
  assert.equal(await page.locator('#routingDevice').inputValue(), 'kit-b'); assert.equal(await page.locator('#routingChannel').inputValue(), '4');
  assert.equal(await page.locator('#routingInputs tr').count(), 1); assert.match(await page.locator('#routingStatus').textContent(), /naučeno/);
  await page.evaluate(() => __routingPorts.b.onmidimessage({ data: [0x93, 38, 92], timeStamp: performance.now() })); assert.match(await page.locator('#lastHit').textContent(), /Crash 2/);
  await page.evaluate(() => __routingPorts.a.onmidimessage({ data: [0x93, 38, 92], timeStamp: performance.now() })); assert.match(await page.locator('#lastHit').textContent(), /Dobos/);
  await page.evaluate(() => __routingPorts.b.onmidimessage({ data: [0x92, 38, 92], timeStamp: performance.now() })); assert.match(await page.locator('#lastHit').textContent(), /Dobos/);
  await page.reload(); await page.waitForFunction(() => !!globalThis.__routingQA);
  assert.equal(await page.evaluate(() => __routingQA.midi.resolve(38, { deviceId: 'kit-b', channel: 4 })), 'crash2');
  assert.equal(await page.evaluate(() => __routingQA.midi.map[38]), 'snare');
});

await scenario('Routing profile export/import includes independent outputs and imports legacy v1 profiles', async page => {
  await openRouting(page); await page.locator('#routingDevice').selectOption('kit-a'); await page.locator('#routingChannel').selectOption('2'); await page.locator('#routingInstrument').selectOption('kick'); await page.locator('#routingAdd').click();
  const row = page.locator('#routingOutputs tr[data-inst=snare]'); await row.locator('select').selectOption('out-b'); await row.locator('input').nth(0).fill('3'); await row.locator('input').nth(0).press('Tab'); await row.locator('input').nth(1).fill('60'); await row.locator('input').nth(1).press('Tab');
  assert.equal(await row.locator('td').first().textContent(), 'Dobos');
  await page.locator('#profileName').fill('Routing profile'); await page.locator('#profileSave').click();
  const downloadPromise = page.waitForEvent('download'); await page.evaluate(() => __routingQA.profiles.exportProfile()); const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8')); assert.equal(exported.version, 2); assert.equal(exported.profile.routing.inputs[0].device, 'kit-a'); assert.deepEqual(exported.profile.routing.outputs.snare, { device: 'out-b', deviceName: 'Output B', channel: 3, note: 60 });
  const imported = await page.evaluate(async value => {
    __routingQA.midi.setRouting({}); return await __routingQA.profiles.importProfile(new File([JSON.stringify(value)], 'profile.json'));
  }, exported); assert.equal(imported, true);
  await page.evaluate(() => __routingQA.midi.sendInstrument('snare', 92, 1000));
  assert.deepEqual(await page.evaluate(() => __routingSent.b.slice(-2)), [[[0x92, 60, 92], 1000], [[0x82, 60, 0], 1080]]);
  const legacy = { ...exported, version: 1, profile: { ...exported.profile, name: 'Legacy profile' } }; delete legacy.profile.routing;
  assert.equal(await page.evaluate(value => __routingQA.profiles.importProfile(new File([JSON.stringify(value)], 'old-profile.json')), legacy), true);
  assert.deepEqual(await page.evaluate(() => __routingQA.midi.routing), { inputs: [], outputs: {} });
});

await scenario('Routing controls handle channel wildcards, deletion, phone width and playback locking', async page => {
  await openRouting(page); await page.locator('#routingChannel').selectOption('2'); await page.locator('#routingInstrument').selectOption('kick'); await page.locator('#routingAdd').click();
  assert.equal(await page.evaluate(() => __routingQA.midi.resolve(38, { deviceId: 'kit-b', channel: 2 })), 'kick');
  await page.setViewportSize({ width: 390, height: 1000 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: resolve(artifacts, 'routing-phone.png'), fullPage: true });
  await page.locator('#routingInputs button').click(); assert.equal(await page.evaluate(() => __routingQA.midi.routing.inputs.length), 0);
  await page.evaluate(() => { __routingQA.settings.countIn = false; }); await page.locator('#playBtn').click();
  assert.equal(await page.locator('#routingAdd').isDisabled(), true); assert.equal(await page.locator('#routingLearn').isDisabled(), true);
  assert.equal(await page.evaluate(() => __routingQA.profiles.routingUI.update({ inputs: [{ device: '*', channel: 0, note: 38, inst: 'kick' }] })), false);
  await page.locator('#playBtn').click();
});

await scenario('Visible idle 3D renders zero frames; flash, pedal, camera and layout changes request frames', async page => {
  await page.locator('#kit3d').click(); await page.waitForFunction(() => __routingQA.kit.three && __routingQA.kit.mode === '3d');
  await page.evaluate(() => {
    const renderer = __routingQA.kit.three.renderer, render = renderer.render.bind(renderer); window.__renderCount = 0;
    renderer.render = (...args) => { __renderCount++; return render(...args); };
  });
  await waitForIdleKit(page); const settled = await page.evaluate(() => __renderCount); await page.waitForTimeout(700);
  metrics.idleFramesIn700ms = await page.evaluate(() => __renderCount) - settled; assert.equal(metrics.idleFramesIn700ms, 0);
  await page.evaluate(() => __routingQA.kit.three.pulse('snare')); await page.waitForFunction(() => { const target = __routingQA.kit.three.targets.get('snare')[0]; return !target.mesh.material.color.equals(target.base); });
  await page.waitForFunction(() => { const target = __routingQA.kit.three.targets.get('snare')[0]; return target.mesh.material.color.equals(target.base); });
  const flashed = await page.evaluate(() => __renderCount); assert.ok(flashed > settled + 2); await page.waitForTimeout(300); assert.equal(await page.evaluate(() => __renderCount), flashed);
  for (const action of ['pedal', 'rotate', 'zoom', 'layout']) {
    const before = await page.evaluate(() => __renderCount);
    await page.evaluate(async kind => {
      const kit = __routingQA.kit.three;
      if (kind === 'pedal') kit.pedal(0);
      if (kind === 'rotate') kit.rotate(.3);
      if (kind === 'zoom') kit.zoom(.9);
      if (kind === 'layout') { const { moveKitPart } = await import('/js/kit-config.js'); kit.updateLayout(moveKitPart(__routingQA.settings.kitConfig, 'snare', .2, .2)); }
    }, action);
    await page.waitForFunction(count => __renderCount > count, before);
  }
  await page.locator('#kit2d').click(); const hidden = await page.evaluate(() => __renderCount); await page.evaluate(() => { __routingQA.kit.three.pedal(127); __routingQA.kit.three.pulse('snare'); }); await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => __renderCount), hidden);
  await page.locator('#kit3d').click(); await page.waitForFunction(count => __renderCount > count, hidden);
});

await scenario('3D orbit damping settles, tab visibility pauses, and disposal cancels pending animation', async page => {
  await page.locator('#kit3d').click(); await page.waitForFunction(() => __routingQA.kit.three && __routingQA.kit.mode === '3d');
  await page.evaluate(() => { const r = __routingQA.kit.three.renderer, original = r.render.bind(r); window.__renderCount = 0; r.render = (...args) => { __renderCount++; return original(...args); }; });
  const box = await page.locator('#kit3dHost canvas').boundingBox();
  const beforeCamera = await page.evaluate(() => __routingQA.kit.three.camera.position.toArray());
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down(); await page.mouse.move(box.x + 100, box.y + 50, { steps: 8 }); await page.mouse.up();
  const settlingStarted = Date.now();
  await waitForIdleKit(page); metrics.orbitSettlingMs = Date.now() - settlingStarted;
  assert.notDeepEqual(await page.evaluate(() => __routingQA.kit.three.camera.position.toArray()), beforeCamera);
  const settled = await page.evaluate(() => __renderCount); await page.waitForTimeout(500); assert.equal(await page.evaluate(() => __renderCount), settled);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); __routingQA.kit.three.pulse('snare'); });
  await page.waitForTimeout(500); assert.equal(await page.evaluate(() => __renderCount), settled);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }); await page.waitForFunction(count => __renderCount > count, settled);
  await page.evaluate(() => { __routingQA.kit.three.pulse('snare'); __routingQA.kit.three.dispose(); }); const disposed = await page.evaluate(() => __renderCount);
  await page.waitForTimeout(500); assert.equal(await page.evaluate(() => __renderCount), disposed); assert.equal(await page.locator('#kit3dHost canvas').count(), 0);
});

await browser.close(); await writeFile(resolve(artifacts, 'results.json'), JSON.stringify({ results, metrics }, null, 2));
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
