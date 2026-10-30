// Optional real-model check. Reads already downloaded, licensed weights; never
// downloads them. Override DRUMMER_ADT_DIR and DRUMMER_ORT_WASM as needed.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADT_STR_MODEL, ADT_STR_ASSETS } from '../js/adt-str-model.js';
import { ADTOF_MODEL } from '../js/ai-transcription-model.js';
import { AI_WASM_ASSET } from '../js/ai-model-cache.js';

const temp = process.env.TEMP || '/tmp', folder = process.env.DRUMMER_ADT_DIR || join(temp, 'drummer-adtstr');
const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const assets = new Map(await Promise.all(ADT_STR_ASSETS.map(async asset => [asset.url, await readFile(join(folder, asset.url.split('/').at(-1)))])));
assets.set(AI_WASM_ASSET.url, await readFile(process.env.DRUMMER_ORT_WASM || join(temp, 'drummer-ai-feasibility/package/dist/ort-wasm-simd-threaded.wasm')));
assets.set(ADTOF_MODEL.url, await readFile(process.env.DRUMMER_ADTOF_MODEL || join(temp, 'drummer-ai-feasibility/adtof_frame_rnn.onnx')));
const artifacts = process.env.DRUMMER_ARTIFACTS || fileURLToPath(new URL('./artifacts/adt-str/', import.meta.url)); await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ serviceWorkers: 'block' }), page = await context.newPage();
const requests = [], errors = [], checks = []; let networkAllowed = true;
page.on('pageerror', error => errors.push(error.message));
await context.route('https://**/*', route => {
  const url = route.request().url(); requests.push(url);
  if (!networkAllowed || !assets.has(url)) return route.abort();
  return route.fulfill({ body: assets.get(url), contentType: url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
    headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' } });
});
await page.route('**/adt-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>ADT_STR test</title>' }));
try {
  await page.goto(base + '/adt-fixture');
  const report = await page.evaluate(async modelId => {
    const { createDrumTranscriber } = await import('/js/ai-transcriber.js');
    const transcriber = createDrumTranscriber(); window.transcriber = transcriber;
    const rate = 44100, audio = new Float32Array(Math.round(rate * 2.56));
    // Deterministic synthetic kick/snare/hats with no copyrighted samples.
    let random = 123456789;
    const noise = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 2147483648 - 1; };
    for (let hit = 0; hit < 13; hit++) {
      const start = Math.round(hit * .2 * rate);
      for (let i = start; i < audio.length; i++) {
        const seconds = (i - start) / rate;
        if (hit % 4 === 0) audio[i] += .7 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-seconds * 30)) * seconds) * Math.exp(-seconds * 8);
        else if (hit % 4 === 2) audio[i] += .3 * noise() * Math.exp(-seconds * 20);
        audio[i] += .1 * noise() * Math.exp(-seconds * 60);
      }
    }
    window.audioFixture = audio;
    const started = performance.now();
    const result = await transcriber.transcribe({ channels: [audio], sampleRate: rate }, { modelId, allowDownload: true, backend: 'wasm' });
    return { ...result, totalMs: performance.now() - started };
  }, ADT_STR_MODEL.id);
  assert.equal(report.modelId, ADT_STR_MODEL.id); assert.equal(report.backend, 'wasm');
  assert.ok(report.events.length > 0, 'synthetic drums should produce events');
  assert.ok(report.events.every(event => Number.isFinite(event.timeSeconds) && event.timeSeconds >= 0 && event.timeSeconds < 2.56 && event.velocity >= 1 && event.velocity <= 127));
  assert.equal(new Set(requests).size, 3, 'only two model graphs and shared runtime');
  checks.push(`PASS actual ADT_STR WASM: ${report.events.length} events in ${Math.round(report.inferenceMs)} ms inference (${Math.round(report.totalMs)} ms including load)`);
  console.log(checks.at(-1));
  const switched = await page.evaluate(async modelId => {
    const original = await transcriber.transcribe({ channels: [new Float32Array(44100)], sampleRate: 44100 }, { allowDownload: true, backend: 'wasm' });
    const back = await transcriber.prepare({ modelId, allowDownload: false });
    return { originalId: original.modelId, frames: original.activations.length / 5, finite: original.activations.every(Number.isFinite), backId: back.modelId };
  }, ADT_STR_MODEL.id);
  assert.deepEqual(switched, { originalId: ADTOF_MODEL.id, frames: 100, finite: true, backId: ADT_STR_MODEL.id });
  assert.equal(new Set(requests).size, 4);
  checks.push('PASS switching ADT_STR → default ADTOF inference → cached ADT_STR in the same worker');
  networkAllowed = false; const before = requests.length;
  const cached = await page.evaluate(async modelId => {
    transcriber.dispose();
    const { createDrumTranscriber } = await import('/js/ai-transcriber.js');
    const fresh = createDrumTranscriber();
    try { return await fresh.prepare({ modelId, allowDownload: false, backend: 'wasm' }); } finally { fresh.dispose(); }
  }, ADT_STR_MODEL.id);
  assert.equal(cached.modelId, ADT_STR_MODEL.id); assert.equal(requests.length, before);
  checks.push('PASS verified multipart cache prepares a fresh worker without network');
  const cancelled = await page.evaluate(async modelId => {
    const { createDrumTranscriber } = await import('/js/ai-transcriber.js');
    const worker = createDrumTranscriber(), controller = new AbortController();
    const pending = worker.transcribe({ channels: [new Float32Array(44100 * 60)], sampleRate: 44100 }, { modelId, signal: controller.signal });
    controller.abort(); try { await pending; return false; } catch (error) { return error.name === 'AbortError'; } finally { worker.dispose(); }
  }, ADT_STR_MODEL.id);
  assert.ok(cancelled); checks.push('PASS cancellation terminates preprocessing/worker');
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'report.json'), JSON.stringify({ checks, report, requests, errors }, null, 2));
  console.log(checks.slice(1).join('\n'));
} finally { await context.close(); await browser.close(); }
