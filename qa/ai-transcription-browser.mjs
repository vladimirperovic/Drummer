// Real, optional model inference. Supply already downloaded licensed model/runtime
// via DRUMMER_ADTOF_MODEL and DRUMMER_ORT_WASM; this test never downloads assets.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeAiWav } from '../js/ai-audio.js';

const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const temp = join(process.env.TEMP || '/tmp', 'drummer-ai-feasibility');
const model = await readFile(process.env.DRUMMER_ADTOF_MODEL || join(temp, 'adtof_frame_rnn.onnx'));
const wasm = await readFile(process.env.DRUMMER_ORT_WASM || join(temp, 'package', 'dist', 'ort-wasm-simd-threaded.wasm'));
const artifacts = fileURLToPath(new URL('./artifacts/ai-transcription/', import.meta.url)); await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
const errors = [], requests = []; let networkAllowed = true;
page.on('pageerror', error => errors.push(error.message));
await context.route('https://**/*', async route => {
  const url = route.request().url(); requests.push({ url, method: route.request().method() });
  if (!networkAllowed) return route.abort();
  if (url.endsWith('/adtof_frame_rnn.onnx')) return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: model, headers: { 'Access-Control-Allow-Origin': '*' } });
  if (url.endsWith('/ort-wasm-simd-threaded.wasm')) return route.fulfill({ status: 200, contentType: 'application/wasm', body: wasm, headers: { 'Access-Control-Allow-Origin': '*' } });
  return route.abort();
});
await page.route('**/ai-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/ai-tools.css"><section id="section-song" data-section-panel="song"></section>' }));
const results = [];
try {
  await page.goto(base + '/ai-fixture');
  await page.evaluate(async () => {
    const { createAiTools } = await import('/js/ai-tools.js');
    window.ai = createAiTools({ isBusy: () => !!window.practiceBusy, onBusyChange: value => { window.aiBusy = value; }, onCandidate: candidate => { window.candidate = { count: candidate.events.length, durationSeconds: candidate.durationSeconds, sampleRate: candidate.audioBuffer.sampleRate }; return true; } });
    ai.show();
  });
  assert.equal(requests.length, 0); results.push('PASS no AI download on startup');
  const audio = new Float32Array(44100 * 8);
  for (let i = 0; i < audio.length; i++) { const local = i % 22050; audio[i] = local < 4410 ? Math.sin(2 * Math.PI * 80 * local / 44100) * Math.exp(-local / 1000) * .7 : 0; }
  await page.locator('#aiAudioFile').setInputFiles({ name: 'synthetic-kicks.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeAiWav([audio], 44100)) });
  await page.waitForFunction(() => !ai.busy && !document.getElementById('aiTranscribe').disabled);
  assert.equal(requests.length, 0); results.push('PASS local audio decode without uploads/downloads');
  const started = Date.now(); await page.locator('#aiTranscribe').click();
  await page.locator('#aiReview').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => !ai.busy);
  const noteCount = await page.locator('#aiNotePreview ellipse').count(); assert.ok(noteCount >= 4, `expected synthetic kick notes, got ${noteCount}`);
  assert.equal(requests.length, 2); assert.ok(requests.every(request => request.method === 'GET'));
  results.push(`PASS actual Worker/WASM model: ${noteCount} visible noteheads, ${Date.now() - started} ms download-cache-load-inference`);
  await page.locator('#aiApply').click(); assert.ok((await page.evaluate(() => candidate.count)) >= 8); assert.equal(await page.evaluate(() => candidate.sampleRate), 44100);
  results.push('PASS candidate callback preserves whole-song events and local audio');
  networkAllowed = false; const before = requests.length;
  const cached = await page.evaluate(async () => {
    const { createDrumTranscriber } = await import('/js/ai-transcriber.js'); const worker = createDrumTranscriber();
    await worker.prepare({ allowDownload: false }); const out = await worker.transcribe({ channels: [new Float32Array(44100)], sampleRate: 44100 }); worker.dispose();
    return { frames: out.activations.length / 5, finite: out.activations.every(Number.isFinite), backend: out.backend };
  });
  assert.deepEqual(cached, { frames: 100, finite: true, backend: 'wasm' }); assert.equal(requests.length, before); results.push('PASS fresh worker uses verified cache without network');
  const cancelled = await page.evaluate(async () => {
    const { createDrumTranscriber } = await import('/js/ai-transcriber.js'); const worker = createDrumTranscriber(), controller = new AbortController();
    const pending = worker.transcribe({ channels: [new Float32Array(44100 * 60)], sampleRate: 44100 }, { signal: controller.signal }); controller.abort();
    try { await pending; return false; } catch (error) { worker.dispose(); return error.name === 'AbortError'; }
  });
  assert.ok(cancelled); results.push('PASS cancellation aborts worker/preprocessing');
  await page.evaluate(() => { practiceBusy = true; ai.refresh(); }); assert.equal(await page.locator('#aiTranscribe').isDisabled(), true);
  await page.evaluate(() => { practiceBusy = false; ai.refresh(); });
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: artifacts + 'ai-mobile.png', fullPage: true }); results.push('PASS busy guards and mobile layout');
  await page.route('**/js/main.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nglobalThis.__aiIntegration={studio,get pattern(){return pattern},get ai(){return aiTools}};' }); });
  await page.addInitScript(() => {
    localStorage.setItem('drummer.language.v1', 'en');
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => ({ inputs: new Map(), outputs: new Map() }) });
  });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(base); await page.locator('#presets .load').first().waitFor({ state: 'attached' });
  if (await page.locator('#appNav [data-pane=ai]').isHidden()) await page.locator('button[data-mode=song]').click(); await page.locator('#appNav [data-pane=ai]').click();
  assert.match(await page.locator('#tool-ai h2').textContent(), /Song/);
  await page.locator('#aiAudioFile').setInputFiles({ name: 'synthetic-kicks.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeAiWav([audio], 44100)) });
  await page.waitForFunction(() => !__aiIntegration.ai.busy && !document.getElementById('aiTranscribe').disabled);
  await page.locator('#aiTranscribe').click(); await page.locator('#aiReview').waitFor({ state: 'visible' }); await page.waitForFunction(() => !__aiIntegration.ai.busy);
  await page.locator('#aiApply').click();
  assert.ok(await page.evaluate(() => __aiIntegration.studio.arrangements.draft.sections.length > 0));
  assert.equal(await page.evaluate(() => __aiIntegration.studio.backing.buffer.duration), 8);
  if (await page.locator('#appNav [data-pane=ai]').isHidden()) await page.locator('button[data-mode=song]').click(); await page.locator('#appNav [data-pane=ai]').click();
  await page.screenshot({ path: artifacts + 'ai-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: artifacts + 'ai-mobile-integrated.png', fullPage: true });
  results.push('PASS real application: translated AI tab, full-song arrangement and continuous backing import');
  assert.deepEqual(errors, []);
  await writeFile(artifacts + 'report.json', JSON.stringify({ results, requests, errors }, null, 2)); console.log(results.join('\n'));
} finally { await context.close(); await browser.close(); }
