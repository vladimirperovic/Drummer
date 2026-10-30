import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const model = process.env.DRUMMER_SCNET_MODEL, wasm = process.env.DRUMMER_AI_WASM;
if (!model || !wasm) { console.log('SKIP actual SCNet-large browser inference: set DRUMMER_SCNET_MODEL and DRUMMER_AI_WASM to verified downloaded assets.'); process.exit(0); }
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.env.DRUMMER_ARTIFACTS || fileURLToPath(new URL('./artifacts/scnet-separator/', import.meta.url))); await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Actual SCNet-large worker test</title>'); return; }
  const file = path === '/fixture-model.onnx' ? model : path === '/fixture-runtime.wasm' ? wasm : resolve(root, '.' + path);
  if (![model, wasm].includes(file) && !file.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403); res.end(); return; }
  try { const size = (await stat(file)).size; res.setHeader('Content-Length', size); res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', ['.js', '.mjs'].includes(extname(file)) ? 'text/javascript' : path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'); createReadStream(file).pipe(res); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ serviceWorkers: 'block' });
const origin = `http://127.0.0.1:${server.address().port}`;
const requests = [], errors = [], results = []; let blockAssets = false;
await context.route('https://huggingface.co/audiojs/scnet-large/**', async route => { requests.push(route.request().url()); if (blockAssets) return route.abort('internetdisconnected'); await route.fulfill({ status: 302, headers: { location: origin + '/fixture-model.onnx', 'access-control-allow-origin': '*' } }); });
await context.route('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort-wasm-simd-threaded.wasm', async route => { requests.push(route.request().url()); if (blockAssets) return route.abort('internetdisconnected'); await route.fulfill({ status: 302, headers: { location: origin + '/fixture-runtime.wasm', 'access-control-allow-origin': '*' } }); });
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('console', msg => console.log(msg.text()));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const { createDrumSeparator } = await import('/js/drum-separator.js');
    window.__separator = createDrumSeparator({ modelId: 'scnet-large-int8', onProgress: value => { window.__lastProgress = value; if (value.stage === 'loading' || value.stage === 'separating') console.log(JSON.stringify(value)); if (__cancelRun && value.stage === 'separating') __abort.abort(); } });
    window.__cancelRun = false; window.__heartbeat = 0; setInterval(() => __heartbeat++, 20);
    try { await __separator.prepare(); window.__noOptIn = false; } catch (error) { window.__noOptIn = error.code === 'AI_DOWNLOAD_REQUIRED'; }
  });
  assert.equal(await page.evaluate(() => __noOptIn), true); assert.equal(requests.length, 0); results.push({ name: 'No model/runtime download before explicit opt-in', status: 'PASS' });
  const metadata = await page.evaluate(async () => {
    const before = performance.now(), heartbeat = __heartbeat; const info = await __separator.prepare({ allowDownload: true, backend: 'wasm' }); return { info, loadMs: performance.now() - before, heartbeatTicks: __heartbeat - heartbeat };
  });
  assert.equal(metadata.info.backend, 'wasm'); assert.equal(metadata.info.id, 'scnet-large-int8'); assert.ok(metadata.heartbeatTicks > 10); assert.equal(requests.length, 2);
  const inference = await page.evaluate(async () => {
    const rate = 44100, frames = 343980, left = new Float32Array(frames), background = new Float32Array(frames); let seed = 1234567;
    for (let i = 0; i < frames; i++) {
      const t = i / rate, beat = t % .5, snare = (t + .5) % 1, hh = t % .25;
      seed = (1664525 * seed + 1013904223) >>> 0; const noise = seed / 2147483648 - 1;
      const drums = .48 * Math.sin(2 * Math.PI * (55 * beat + 3 * (1 - Math.exp(-beat * 35)))) * Math.exp(-beat * 18) + .26 * noise * Math.exp(-snare * 24) + .08 * noise * Math.exp(-hh * 150);
      background[i] = .22 * Math.sin(2 * Math.PI * 220 * t) + .13 * Math.sin(2 * Math.PI * 330 * t) + .08 * Math.sin(2 * Math.PI * 440 * t); left[i] = drums + background[i];
    }
    window.__input = { channels: [left], sampleRate: rate }; const before = performance.now(), heartbeat = __heartbeat;
    const result = await __separator.separate(__input); window.__result = result;
    let power = 0, difference = 0, reference = 0, projection = 0, inputProjection = 0, nonfinite = 0;
    for (let i = 0; i < frames; i++) { const v = result.channels[0][i]; power += v*v; difference += (v-left[i])**2; reference += background[i]**2; projection += v*background[i]; inputProjection += left[i]*background[i]; if (!Number.isFinite(v) || !Number.isFinite(result.channels[1][i])) nonfinite++; }
    return { frames: result.channels[0].length, channels: result.channels.length, sampleRate: result.sampleRate, backend: result.backend, runMs: performance.now()-before, heartbeatTicks: __heartbeat-heartbeat, rms: Math.sqrt(power/frames), differenceRms: Math.sqrt(difference/frames), backgroundBefore: inputProjection/reference, backgroundAfter: projection/reference, nonfinite, sourceStillOwned: left.length === frames };
  });
  assert.equal(inference.nonfinite, 0); assert.equal(inference.frames, 343980); assert.equal(inference.channels, 2); assert.equal(inference.sampleRate, 44100); assert.equal(inference.sourceStillOwned, true); assert.ok(inference.rms > .001); assert.ok(inference.differenceRms > .01); assert.ok(inference.heartbeatTicks > 30); assert.ok(Math.abs(inference.backgroundAfter) < Math.abs(inference.backgroundBefore) * .25); results.push({ name: 'Actual SCNet-large worker isolates finite drum audio and suppresses known tonal background', status: 'PASS', ...inference });
  const cancellation = await page.evaluate(async () => {
    window.__abort = new AbortController(); window.__cancelRun = true; const before = performance.now();
    try { await __separator.separate(__input, { signal: __abort.signal }); return { cancelled: false }; }
    catch (error) { return { cancelled: error.name === 'AbortError', elapsedMs: performance.now() - before }; }
  });
  assert.equal(cancellation.cancelled, true); assert.ok(cancellation.elapsedMs < 3000); results.push({ name: 'Cancel terminates in-flight native inference immediately', status: 'PASS', ...cancellation });
  // This isolated server has no application SW. Keep local worker modules
  // available while denying both external asset origins on a fresh worker.
  blockAssets = true;
  const offline = await page.evaluate(async () => { window.__cancelRun = false; const start = performance.now(), info = await __separator.prepare({ allowDownload: false, backend: 'wasm' }); __separator.dispose(); return { backend: info.backend, loadMs: performance.now()-start }; });
  assert.equal(offline.backend, 'wasm'); assert.equal(requests.length, 2); assert.deepEqual(errors, []); results.push({ name: 'Verified cached model and runtime prepare with external asset network blocked', status: 'PASS', ...offline });
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ metadata, results, requests, errors }, null, 2)); console.log(JSON.stringify({ passed: results.length, inference }));
} catch (error) { await writeFile(resolve(output, 'results.json'), JSON.stringify({ results, requests, errors, failure: error.stack }, null, 2)); throw error; }
finally { await context.close().catch(() => {}); await browser.close().catch(() => {}); await new Promise(resolve => server.close(resolve)); }

