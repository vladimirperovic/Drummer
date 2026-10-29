import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const lib = async page => { await page.locator('#appNav [data-section=library]').click(); await page.locator('.subtabs [data-pane=library]').click(); };

const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const channel = process.env.DRUMMER_BROWSER || '';
const artifacts = fileURLToPath(new URL(`./artifacts/catalog/${channel || 'chromium'}/`, import.meta.url));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}), args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
const results = [], filter = process.env.DRUMMER_CASE ? new RegExp(process.env.DRUMMER_CASE) : null;
const bridge = '\nglobalThis.__qa = { kit, settings, play, start, stop, onHit, loadPattern, workspaceView, get notation() { return notation; }, get pattern() { return pattern; } };';
async function scenario(name, fn, options = {}) {
  if (filter && !filter.test(name)) return;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: options.offline ? 'allow' : 'block' });
  const p = await context.newPage(), errors = []; p.setDefaultTimeout(10000);
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => {
    if (localStorage.getItem('drummer.language.v1') == null) localStorage.setItem('drummer.language.v1', 'sr');
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => ({ inputs: new Map(), outputs: new Map() }) });
  });
  if (!options.offline) await p.route('**/js/main.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + bridge }); });
  if (options.noWebGL) await p.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.startsWith('webgl') ? null : getContext.call(this, type, ...args); };
  });
  try {
    await p.goto(base); await p.locator('#presets .load').first().waitFor({ state: 'attached' });
    await fn(p, context); assert.deepEqual(errors, [], 'uncaught page errors');
    results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`);
  } catch (e) {
    const screenshot = `failure-${results.length + 1}.png`; await p.screenshot({ path: artifacts + screenshot }).catch(() => {});
    results.push({ name, status: 'FAIL', error: e.stack, errors, screenshot }); console.log(`FAIL ${name}: ${e.message}`);
  } finally { await context.close(); }
}
const three = async p => { await p.locator('#appNav [data-section=kit]').click(); await p.locator('#kit3d').click(); await p.waitForFunction(() => __qa.kit.three && __qa.kit.mode === '3d'); };
const loadEight = async p => p.evaluate(async () => {
  const { blankPattern } = await import('/js/patterns.js'); const pattern = blankPattern({ bars: 8, bpm: 180 }); pattern.steps.snare.fill(2); __qa.loadPattern(pattern);
});

await scenario('Catalog: category counts, bilingual search and typing without drum shortcuts', async p => {
  assert.equal(await p.locator('#presets .load').count(), 20);
  assert.match(await p.locator('#presetCount').innerText(), /\/ 94/);
  for (const category of ['latin', 'rock', 'jazz', 'three-eight']) { await lib(p); await p.locator('#presetCategory').selectOption(category); assert.equal(await p.locator('#presets .load').count(), 20); assert.match(await p.locator('#presetCount').innerText(), /\/ 20/); }
  await lib(p); await p.locator('#presetCategory').selectOption('latin'); await lib(p); await p.locator('#presetSearch').pressSequentially('bossa');
  assert.equal(await p.locator('#presetSearch').inputValue(), 'bossa'); assert.equal(await p.locator('#presets .load').count(), 2);
  assert.equal(await p.evaluate(() => __qa.play.on), false);
  await lib(p); await p.locator('#presetSearch').fill('anticipated kick'); assert.equal(await p.locator('#presets .load').count(), 1);
  await lib(p); await p.locator('#presetSearch').fill('no-such-pattern'); assert.ok(await p.locator('#presetEmpty').isVisible());
});
await scenario('Catalog: twenty real notation previews match notes, retain names and show first-two-bar captions', async p => {
  for (const category of ['all', 'latin', 'rock', 'jazz', 'three-eight']) {
    await lib(p); await p.locator('#presetCategory').selectOption(category);
    assert.equal(await p.locator('#presets .library-preview svg').count(), 20);
    const failures = await p.evaluate(async () => {
      const { PRESETS, INSTRUMENTS, slotsPerBar } = await import('/js/patterns.js'), failures = [];
      for (const button of document.querySelectorAll('#presets .load')) {
        const source = PRESETS.find(preset => preset.id === button.dataset.presetId), svg = button.querySelector('.library-preview svg');
        const limit = Math.min(2, source.bars) * slotsPerBar(source);
        if (button.firstElementChild.textContent !== source.name) failures.push(source.id + ': name');
        for (const inst of INSTRUMENTS) {
          const expected = source.steps[inst.id].slice(0, limit).filter(Boolean).length;
          if (svg.querySelectorAll(`.head[data-inst="${inst.id}"]`).length !== expected) failures.push(source.id + ': notes ' + inst.id);
        }
        if (svg.querySelector('.playhead') || /NaN|Infinity/.test(svg.outerHTML)) failures.push(source.id + ': invalid geometry');
        if (source.bars > 2 && !button.querySelector('.preview-caption')?.textContent.includes(`1–2 / ${source.bars}`)) failures.push(source.id + ': truncated without caption');
        const box = svg.getBBox(), frame = svg.viewBox.baseVal;
        if (box.y < frame.y - 1 || box.y + box.height > frame.y + frame.height + 1) failures.push(source.id + ': clipped preview');
      }
      return failures;
    });
    assert.deepEqual(failures, [], category);
  }
  await p.locator('#languageSelect').selectOption('en');
  assert.ok((await p.locator('#presets .load > span:first-child').allTextContents()).every(Boolean));
  for (const width of [1440, 390, 360]) { await p.setViewportSize({ width, height: 1000 }); assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
});
await scenario('Catalog: all eighty new presets load their correct meter, notes and English lesson', async p => {
  await p.locator('#languageSelect').selectOption('en');
  const result = await p.evaluate(async () => {
    const { PRESETS, totalSlots } = await import('/js/patterns.js'); const failures = [];
    for (const preset of PRESETS.slice(14)) {
      __qa.loadPattern(preset);
      if (__qa.pattern.beats !== preset.beats || __qa.pattern.beatUnit !== preset.beatUnit || __qa.notation.total !== totalSlots(preset) || /NaN|Infinity/.test(document.querySelector('#notation').innerHTML)) failures.push(preset.id);
    }
    return failures;
  }); assert.deepEqual(result, []);
  await p.waitForFunction(() => document.querySelector('#patternLesson').textContent.startsWith('Count three'));
});
await scenario('Workspace: sections and navigation occupy full width at desktop and phone sizes', async p => {
  await p.locator('#appNav [data-section=editor]').click();
  for (const width of [1440, 768, 390, 360]) {
    await p.setViewportSize({ width, height: 1000 });
    const r = await p.evaluate(() => {
      const section = document.querySelector('#section-editor').getBoundingClientRect(), nav = document.querySelector('#appNav').getBoundingClientRect();
      // Only the current mode's menu is shown (Notes or Song).
      const buttons = [...document.querySelectorAll('#appNav button')].filter(b => b.getClientRects().length).map(b => b.getBoundingClientRect());
      return { sectionWidth: section.width, navWidth: nav.width, navInside: buttons.every(b => b.left >= -1 && b.right <= innerWidth + 1 && b.height >= 44),
        overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(r.sectionWidth >= width - 4 && r.navWidth >= width - 4, JSON.stringify(r)); assert.ok(r.navInside, JSON.stringify(r)); assert.ok(r.overflow <= 1, JSON.stringify(r));
  }
  await p.screenshot({ path: artifacts + 'phone-editor.png' });
});
await scenario('Workspace: drag and keyboard resize persist without changing tempo', async p => {
  const handle = p.locator('#sheetResize'), before = await p.locator('.sheet').boundingBox(), rect = await handle.boundingBox();
  await p.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await p.mouse.down(); await p.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2 + 100, { steps: 5 }); await p.mouse.up();
  assert.ok((await p.locator('.sheet').boundingBox()).height >= before.height + 95);
  const bpm = await p.locator('#bpm').inputValue(); await handle.focus(); await handle.press('ArrowDown'); assert.equal(await p.locator('#bpm').inputValue(), bpm);
  const height = (await p.locator('.sheet').boundingBox()).height; await p.waitForTimeout(300); await p.reload();
  assert.ok(Math.abs((await p.locator('.sheet').boundingBox()).height - height) < 2);
  await p.locator('#resetSheet').click(); assert.ok((await p.locator('.sheet').boundingBox()).height < height);
});
await scenario('Workspace: two/four notation rows, focus mode, auto-scroll and Escape preserve playback', async p => {
  await loadEight(p); await p.locator('#scoreRows').selectOption('2'); assert.equal(await p.locator('#notation .staff').count(), 10);
  await p.locator('#scoreRows').selectOption('4'); assert.equal(await p.locator('#notation .staff').count(), 20);
  await p.locator('#scoreView').click(); assert.ok(!(await p.locator('.lower').isVisible())); assert.ok(await p.locator('.bar').isVisible());
  // Read the manual follow position in the same task: the running transport
  // moves the playhead back to its actual first beat on the next frame.
  const followed = await p.evaluate(async () => { __qa.settings.countIn = false; await __qa.start(); __qa.notation.setPlayhead(112); return document.querySelector('#notation').scrollTop; });
  assert.ok(followed > 0);
  await p.keyboard.press('Escape'); assert.ok(await p.locator('.lower').isVisible()); assert.ok(await p.evaluate(() => __qa.play.on));
  await p.evaluate(() => __qa.stop());
  await p.locator('#scoreView').click(); await p.waitForTimeout(250); await p.reload(); assert.ok(await p.locator('body').evaluate(e => e.classList.contains('notes-only')));
  await p.screenshot({ path: artifacts + 'notes-only.png' });
});
await scenario('Kit: 2D fixed-size center flashes, full cymbal discs and repeated-hit cleanup', async p => {
  const original = await p.locator('.overlay[data-pad=snare]').evaluate(e => [e.getAttribute('width'), e.getAttribute('height'), e.getAttribute('mask')]);
  assert.equal(await p.locator('.approach').count(), 0);
  assert.equal(await p.locator('.kit-svg mask').count(), 12);
  await p.evaluate(() => { for (let i = 0; i < 50; i++) __qa.kit.pulse('snare'); __qa.kit.pulse('crash2'); });
  assert.deepEqual(await p.locator('.overlay[data-pad=snare]').evaluate(e => [e.getAttribute('width'), e.getAttribute('height'), e.getAttribute('mask')]), original);
  assert.match(await p.locator('.kit-svg mask[id$="-crash2"] image').getAttribute('href'), /mask-crash2\.png$/);
  assert.match(await p.locator('.overlay[data-pad=snare]').getAttribute('style'), /255, 107, 107/);
  assert.ok(await p.locator('.overlay[data-pad=snare]').evaluate(e => e.getAnimations().length <= 1));
  await p.waitForTimeout(500); assert.equal(await p.locator('.overlay[data-pad=snare]').evaluate(e => e.getAnimations().length), 0);
  await p.locator('#view-kit').screenshot({ path: artifacts + 'kit-2d.png' });
});
await scenario('Kit: original 2D image and all visibility masks have visible, unclipped matching pixels', async p => {
  const result = await p.evaluate(async () => {
    const { KIT_ART } = await import('/js/kit-art-data.js'), { INSTRUMENTS } = await import('/js/patterns.js');
    const canvas = document.createElement('canvas'); canvas.width = KIT_ART.width; canvas.height = KIT_ART.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }), counts = {};
    for (const id of Object.keys(KIT_ART.pads)) {
      const image = new Image(); image.src = `/assets/kit/mask-${id}.png`; await image.decode();
      if (image.width !== canvas.width || image.height !== canvas.height) throw Error('Mismatched mask dimensions');
      ctx.drawImage(image, 0, 0); const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let count = 0, border = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 200) {
        count++; const x = i / 4 % canvas.width, y = Math.floor(i / 4 / canvas.width);
        if (x < 2 || x > canvas.width - 3 || y < 2 || y > canvas.height - 3) border++;
      }
      counts[id] = { count, border };
    }
    const base = new Image(); base.src = '/assets/kit/drummer-2d.png'; await base.decode(); ctx.drawImage(base, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== pixels[i + 1] || pixels[i] !== pixels[i + 2]) throw Error('Artwork is not monochrome');
    for (const inst of INSTRUMENTS.filter(i => !i.optional)) {
      if (!counts[inst.target]) throw Error(`Missing mask: ${inst.id}`);
      __qa.kit.pulse(inst.id);
      const overlay = document.querySelector(`.overlay[data-pad="${inst.target}"]`);
      if (!overlay.style.fill || overlay.getAnimations().length !== 1) throw Error(`Missing flash: ${inst.id}`);
    }
    for (const node of document.querySelectorAll('.overlay')) for (const animation of node.getAnimations()) { animation.pause(); animation.currentTime = 0; }
    return counts;
  });
  for (const [id, pixels] of Object.entries(result)) { assert.ok(pixels.count > 100, id); assert.equal(pixels.border, 0, id); }
  await p.locator('#view-kit').screenshot({ path: artifacts + 'kit-2d-colors.png' });
});
await scenario('Kit: original 2D requires no WebGL and its artwork stays available offline', async (p, context) => {
  await p.evaluate(async () => navigator.serviceWorker.ready); await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true); await p.reload(); await p.locator('[data-kit-art]').waitFor();
  const result = await p.evaluate(async () => {
    const images = [...document.querySelectorAll('.kit-svg image')];
    await Promise.all(images.map(async node => { const image = new Image(); image.src = node.getAttribute('href'); await image.decode(); }));
    return { count: images.length, three: performance.getEntriesByType('resource').some(r => r.name.endsWith('three.core.js')) };
  });
  assert.equal(result.count, 13); assert.equal(result.three, false);
  await p.setViewportSize({ width: 390, height: 844 }); await p.locator('#view-kit').screenshot({ path: artifacts + 'phone-2d.png' });
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}, { offline: true, noWebGL: true });
await scenario('Kit: 3D loads lazily and keeps white shells, black spots and twelve hit targets', async p => {
  assert.equal(await p.locator('#kit3dHost canvas').count(), 0); assert.equal(await p.evaluate(() => performance.getEntriesByType('resource').some(e => e.name.endsWith('three.core.js'))), false);
  await three(p);
  const r = await p.evaluate(() => {
    const kit = __qa.kit.three; let shells = 0;
    kit.scene.traverse(n => { if (n.geometry?.type === 'CylinderGeometry' && n.geometry.parameters.radiusTop > .3 && n.geometry.parameters.height > .2) { if (n.material.side === 0 && n.material.color.getHex() === 0xffffff) shells++; } });
    return { targets: [...kit.targets.keys()], snare: kit.targets.get('snare')[0].base.getHex(), ride: kit.targets.get('ride')[0].base.getHex(), shells };
  });
  assert.equal(r.targets.length, 12); assert.equal(r.snare, 0x161616); assert.equal(r.ride, 0xffffff); assert.equal(r.shells, 5);
  await p.waitForTimeout(400); await p.locator('#view-kit').screenshot({ path: artifacts + 'kit-3d.png' });
});
await scenario('Kit: all thirteen live instruments and reference playback color the 3D targets without scaling', async p => {
  await three(p);
  const r = await p.evaluate(async () => {
    const { INSTRUMENTS } = await import('/js/patterns.js'); const failures = [];
    for (const inst of INSTRUMENTS.filter(i => !i.optional)) {
      const target = __qa.kit.three.targets.get(inst.target)[0]; const initial = target.mesh.scale.toArray().join();
      __qa.onHit(inst.id, 92, performance.now()); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (target.mesh.material.color.equals(target.base) || initial !== target.mesh.scale.toArray().join()) failures.push(inst.id);
    }
    __qa.settings.countIn = false; await __qa.start(); return failures;
  }); assert.deepEqual(r, []);
  await p.waitForFunction(() => document.querySelector('#notation .playhead').getAttribute('x') !== '-20');
  await p.waitForFunction(() => { const t = __qa.kit.three.targets.get('kick')[0]; return !t.mesh.material.color.equals(t.base); });
  await p.evaluate(() => __qa.stop());
  // Finishing now opens the notation report; resume the visible 3D view before
  // asserting a fade that intentionally pauses while the canvas is hidden.
  await p.locator('#appNav [data-section=kit]').click();
  await p.waitForTimeout(500); assert.ok(await p.evaluate(() => [...__qa.kit.three.targets.values()].flat().every(t => t.mesh.material.color.equals(t.base))));
});
await scenario('Kit: mouse rotation, zoom, reset and keyboard controls work without tempo conflicts', async p => {
  await three(p); const camera = () => p.evaluate(() => __qa.kit.three.camera.position.toArray()); const home = await camera();
  const rect = await p.locator('#kit3dHost canvas').boundingBox();
  await p.mouse.move(rect.x + 15, rect.y + 15); await p.mouse.down(); await p.mouse.move(rect.x + 115, rect.y + 25, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(600);
  assert.notDeepEqual(await camera(), home);
  await p.locator('#kitReset').click(); const reset = await camera(); assert.ok(reset.every((v, i) => Math.abs(v - home[i]) < .01));
  const bpm = await p.locator('#bpm').inputValue(); await p.locator('#kit3dHost canvas').focus(); await p.keyboard.press('ArrowUp'); assert.equal(await p.locator('#bpm').inputValue(), bpm); assert.notDeepEqual(await camera(), home);
  await p.locator('#kitReset').click(); await p.locator('#kitZoomIn').click(); assert.notDeepEqual(await camera(), home);
});
await scenario('Kit: view switching reuses one renderer and remembers 3D after reload', async p => {
  await three(p); await p.evaluate(() => window.__renderer = __qa.kit.three.renderer);
  for (let i = 0; i < 3; i++) { await p.locator('#kit2d').click(); assert.ok(await p.locator('.kit-svg').isVisible()); await p.locator('#kit3d').click(); }
  assert.equal(await p.evaluate(() => __renderer === __qa.kit.three.renderer), true); assert.equal(await p.locator('#kit3dHost canvas').count(), 1);
  await p.waitForTimeout(300); await p.reload(); await p.waitForFunction(() => __qa?.kit.mode === '3d'); assert.ok(await p.locator('#kit3dHost canvas').isVisible());
});
await scenario('Kit: English controls, mobile sizing and translated fallback when WebGL is unavailable', async p => {
  await p.locator('#languageSelect').selectOption('en'); await p.locator('#kit3d').click();
  await p.waitForFunction(() => document.querySelector('#kitViewStatus').textContent.startsWith('3D is unavailable'));
  assert.ok(await p.locator('.kit-svg').isVisible()); assert.equal(await p.locator('#kit2d').getAttribute('aria-pressed'), 'true');
  await p.setViewportSize({ width: 390, height: 844 }); assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}, { noWebGL: true });
await scenario('Kit: phone 3D fits, English labels translate and lost graphics context returns to 2D', async p => {
  await p.setViewportSize({ width: 390, height: 844 }); await p.locator('#languageSelect').selectOption('en'); await three(p);
  assert.equal(await p.locator('#kitReset').innerText(), 'Reset view'); assert.match(await p.locator('#kit3dHost canvas').getAttribute('aria-label'), /3D drum kit/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.locator('#view-kit').screenshot({ path: artifacts + 'phone-3d.png' });
  await p.evaluate(() => __qa.kit.three.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
  await p.waitForFunction(() => __qa.kit.mode === '2d'); assert.ok(await p.locator('.kit-svg').isVisible()); assert.equal(await p.locator('#kit3dHost canvas').count(), 0);
});
await scenario('Kit: 3D and new presets load offline even when 3D was never opened online', async (p, context) => {
  await p.evaluate(async () => { await navigator.serviceWorker.ready; });
  await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true); await p.reload(); await p.locator('#presets .load').first().waitFor({ state: 'attached' });
  assert.equal(await p.locator('#presets .load').count(), 20);
  assert.match(await p.locator('#presetCount').innerText(), /\/ 94/);
  await p.locator('#kit3d').click(); await p.locator('#kit3dHost canvas').waitFor(); assert.equal(await p.locator('#kit3d').getAttribute('aria-pressed'), 'true');
  await lib(p); await p.locator('#presetCategory').selectOption('three-eight'); assert.equal(await p.locator('#presets .load').count(), 20); assert.match(await p.locator('#presetCount').innerText(), /\/ 20/);
}, { offline: true });

const report = { browser: channel || 'Chromium', browserVersion: browser.version(), generatedAt: new Date().toISOString(), passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length, results };
await browser.close(); await writeFile(artifacts + 'results.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, failed: report.failed })); process.exitCode = report.failed ? 1 : 0;
