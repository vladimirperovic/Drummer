// Reproducible synthetic benchmark; no network model downloads or licensed songs.
// Supply DRUMMER_DEMUCS_MODEL, DRUMMER_SCNET_MODEL, DRUMMER_SCNET_SMALL_MODEL,
// DRUMMER_AI_WASM, or put these verified assets in TEMP/drummer-ai-feasibility.
// node qa/separator-benchmark.mjs
// Results: DRUMMER_BENCH_OUTPUT or TEMP/drummer-separator-benchmark.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SEPARATOR_MODELS } from '../js/drum-separator-core.js';
import { AI_WASM_ASSET } from '../js/ai-model-cache.js';

const root = fileURLToPath(new URL('../', import.meta.url)), fixtures = join(tmpdir(), 'drummer-ai-feasibility');
const output = resolve(process.env.DRUMMER_BENCH_OUTPUT || join(tmpdir(), 'drummer-separator-benchmark'));
const expectedThreads = Number(process.env.DRUMMER_BENCH_THREADS || 8);
const modelFiles = {
  'htdemucs-ft-drums-fp16-55f929d3': process.env.DRUMMER_DEMUCS_MODEL || join(fixtures, 'htdemucs_ft_drums_fp16weights.onnx'),
  'scnet-large-int8': process.env.DRUMMER_SCNET_MODEL || join(fixtures, 'scnet-large.int8.onnx'),
  'scnet-int8': process.env.DRUMMER_SCNET_SMALL_MODEL || join(fixtures, 'scnet.int8.onnx'),
};
const wasm = process.env.DRUMMER_AI_WASM || join(fixtures, 'package/dist/ort-wasm-simd-threaded.wasm');
const models = SEPARATOR_MODELS.filter(model => modelFiles[model.id]);
const assets = new Map([['wasm', wasm], ...models.map(model => [model.id, modelFiles[model.id]])]);
for (const asset of [...models, { ...AI_WASM_ASSET, id: 'wasm' }]) {
  const path = assets.get(asset.id), info = await stat(path);
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (info.size !== asset.bytes || hash.digest('hex') !== asset.sha256) throw new Error(`Asset verification failed: ${asset.id}`);
}
await mkdir(join(output, 'audio'), { recursive: true });
const server = createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Local separator benchmark</title>'); return; }
  const file = path.startsWith('/_assets/') ? assets.get(path.slice(9)) : resolve(root, '.' + path);
  if (!file || (!assets.has(path.slice(9)) && !file.startsWith(root.endsWith(sep) ? root : root + sep))) { res.writeHead(403); res.end(); return; }
  try {
    res.setHeader('Content-Length', (await stat(file)).size);
    res.setHeader('Content-Type', ['.js', '.mjs'].includes(extname(file)) ? 'text/javascript' : extname(file) === '.wasm' ? 'application/wasm' : 'application/octet-stream');
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ serviceWorkers: 'block' }), page = await context.newPage();
await page.exposeFunction('saveBenchmarkAudio', async (name, base64) => {
  if (!/^[a-z0-9-]+\.wav$/.test(name)) throw new Error('Invalid benchmark audio filename');
  await writeFile(join(output, 'audio', name), Buffer.from(base64, 'base64'));
});
page.on('console', message => { if (message.type() === 'log') console.log(message.text()); });
const network = [], approved = new Map([[AI_WASM_ASSET.url, 'wasm'], ...models.map(model => [model.url, model.id])]);
await context.route('https://**/*', async route => {
  const url = route.request().url(), id = approved.get(url); network.push({ url, suppliedLocally: !!id });
  if (!id) return route.abort();
  return route.fulfill({ status: 302, headers: { location: `${origin}/_assets/${id}`, 'Access-Control-Allow-Origin': '*' } });
});
const report = {
  created: new Date().toISOString(), syntheticOnly: true,
  audioExport: 'Stereo PCM16 WAV, every mix/reference/result attenuated by the same 0.5 gain to prevent clipping. Metrics use the original float samples before attenuation.',
  caveat: 'Three procedural synthetic drum/tonal mixes. These scores are not a general music accuracy benchmark and are not BSSEval/museval SDR.',
  method: {
    sampleRate: 44100, seconds: 7.8, frames: 343980, backend: 'wasm', expectedThreads,
    execution: 'Same browser, machine and thread count; one model at a time. One inference per clip, same session reused; first clip is a cold run, later clips are warm.',
    sdr: '10*log10(sum(reference^2)/sum((estimate-reference)^2)); original gain and timing, no alignment.',
    siSdr: 'Per-channel means removed; shared projection alpha=<estimate,reference>/<reference,reference>, then 10*log10(sum((alpha*reference)^2)/sum((estimate-alpha*reference)^2)).',
    backgroundAttenuation: '-20*log10(abs(background coefficient)) from least-squares projection on known drums and known background jointly; mixture coefficient is 1.',
    timing: 'No onset-accuracy claims: samples are compared without a latency correction.',
  }, models: [], network,
};
const save = async () => {
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2));
  const lines = [report.caveat, '', 'Model | fixture | inference seconds | SDR dB | SI-SDR dB | background attenuation dB'];
  for (const model of report.models) for (const row of model.results || []) lines.push(`${model.name} | ${row.fixture} | ${(row.inferenceMs / 1000).toFixed(3)} | ${row.metrics.sdrDb.toFixed(3)} | ${row.metrics.siSdrDb.toFixed(3)} | ${row.metrics.backgroundAttenuationDb.toFixed(3)}`);
  for (const model of report.models) if (model.error) lines.push(`${model.name}: FAILED ${model.error}`);
  await writeFile(join(output, 'results.txt'), lines.join('\n') + '\n');
};
try {
  await page.goto(origin);
  report.environment = await page.evaluate(() => ({ browser: navigator.userAgent, cores: navigator.hardwareConcurrency, crossOriginIsolated }));
  if (!report.environment.crossOriginIsolated) throw new Error('Benchmark needs cross-origin isolation');
  await page.evaluate(() => {
    window.benchmarkFixture = variant => {
      const length = 343980, rate = 44100;
      const drums = [new Float32Array(length), new Float32Array(length)], background = [new Float32Array(length), new Float32Array(length)];
      const beatSeconds = [0.5, 60 / 132, 60 / 90][variant]; let seed = 1234567 + variant * 91237;
      for (let i = 0; i < length; i++) {
        const time = i / rate, beat = time % beatSeconds, backbeat = (time + beatSeconds) % (2 * beatSeconds), hat = time % (beatSeconds / (variant === 2 ? 4 : 2));
        seed = (1664525 * seed + 1013904223) >>> 0; const noise = seed / 2147483648 - 1;
        const kick = .48 * Math.sin(2 * Math.PI * (55 * beat + 3 * (1 - Math.exp(-beat * 35)))) * Math.exp(-beat * 18);
        const snare = .26 * noise * Math.exp(-backbeat * 24), hihat = (variant === 2 ? .045 : .08) * noise * Math.exp(-hat * 150);
        const fillTime = time % (4 * beatSeconds), tom = variant === 1 && fillTime > 3 * beatSeconds ? .16 * Math.sin(2 * Math.PI * 115 * (fillTime % (beatSeconds / 2))) * Math.exp(-(fillTime % (beatSeconds / 2)) * 22) : 0;
        drums[0][i] = kick + snare + hihat + tom;
        drums[1][i] = kick + snare + hihat * .78 + tom * .65;
        const chord = variant === 1 ? (Math.floor(time / (2 * beatSeconds)) % 2 ? 261.625565 : 220) : variant === 2 ? 196 : 220;
        const gain = variant === 2 ? .35 * (.7 + .3 * Math.sin(time * 1.5)) : .22;
        background[0][i] = gain * Math.sin(2 * Math.PI * chord * time) + .13 * Math.sin(2 * Math.PI * chord * 1.5 * time) + .08 * Math.sin(2 * Math.PI * chord * 2 * time);
        background[1][i] = gain * .85 * Math.sin(2 * Math.PI * chord * time + .18) + .13 * Math.sin(2 * Math.PI * chord * 1.5 * time + .2) + .08 * Math.sin(2 * Math.PI * chord * 2 * time);
      }
      const mix = drums.map((channel, c) => Float32Array.from(channel, (sample, i) => sample + background[c][i]));
      return { drums, background, mix };
    };
    window.benchmarkMetrics = (estimate, reference, background) => {
      let refPower = 0, errorPower = 0, bgPower = 0, refBg = 0, estRef = 0, estBg = 0;
      let centerRefPower = 0, centerEstPower = 0, centerDot = 0;
      for (let c = 0; c < 2; c++) {
        const n = reference[c].length;
        let refMean = 0, estMean = 0;
        for (let i = 0; i < n; i++) { refMean += reference[c][i]; estMean += estimate[c][i]; }
        refMean /= n; estMean /= n;
        for (let i = 0; i < n; i++) {
          const r = reference[c][i], e = estimate[c][i], b = background[c][i];
          if (!Number.isFinite(e)) throw new Error('Nonfinite model output');
          refPower += r * r; errorPower += (e - r) ** 2; bgPower += b * b; refBg += r * b; estRef += e * r; estBg += e * b;
          centerRefPower += (r - refMean) ** 2; centerEstPower += (e - estMean) ** 2; centerDot += (r - refMean) * (e - estMean);
        }
      }
      if (centerEstPower < 1e-12) throw new Error('Silent model output cannot receive a valid SI-SDR');
      const targetPower = centerDot * centerDot / centerRefPower, residualPower = Math.max(1e-12, centerEstPower - targetPower);
      const determinant = refPower * bgPower - refBg * refBg, backgroundCoefficient = (estBg * refPower - estRef * refBg) / determinant;
      return { sdrDb: 10 * Math.log10(refPower / Math.max(1e-12, errorPower)), siSdrDb: 10 * Math.log10(Math.max(1e-12, targetPower) / residualPower), backgroundAttenuationDb: -20 * Math.log10(Math.max(1e-12, Math.abs(backgroundCoefficient))), backgroundCoefficient, drumGain: (estRef * bgPower - estBg * refBg) / determinant };
    };
  });
  for (const model of models) {
    console.log(`Preparing ${model.name}`);
    const row = { id: model.id, name: model.name, bytes: model.bytes, sha256: model.sha256, status: 'running' }; report.models.push(row);
    try {
      const result = await page.evaluate(async ({ modelId, expectedThreads, saveFixtures }) => {
        const { createDrumSeparator } = await import('/js/drum-separator.js');
        const { encodeAiWav } = await import('/js/ai-audio.js');
        const saveWav = async (name, channels) => {
          const bytes = new Uint8Array(encodeAiWav(channels.map(channel => Float32Array.from(channel, value => value * .5)), 44100)), chunks = [];
          for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
          await saveBenchmarkAudio(name, btoa(chunks.join('')));
        };
        const separator = createDrumSeparator({ modelId }), started = performance.now(), results = [];
        try {
          const info = await separator.prepare({ allowDownload: true, backend: 'wasm' }), prepareMs = performance.now() - started;
          if (info.backend !== 'wasm' || info.threads !== expectedThreads) throw new Error(`Unmatched backend/threads: ${info.backend}/${info.threads}, expected wasm/${expectedThreads}`);
          for (let variant = 0; variant < 3; variant++) {
            const fixture = benchmarkFixture(variant), result = await separator.separate({ channels: fixture.mix, sampleRate: 44100 });
            const row = { fixture: ['rock-tones', 'fills-changing-tones', 'soft-dense-hats'][variant], firstRun: variant === 0, backend: result.backend, threads: result.threads, inferenceMs: result.inferenceMs, realTimeFactor: result.inferenceMs / 7800, metrics: benchmarkMetrics(result.channels, fixture.drums, fixture.background), inputMetrics: benchmarkMetrics(fixture.mix, fixture.drums, fixture.background) };
            await saveWav(`${row.fixture}-${modelId}-drums.wav`, result.channels);
            if (saveFixtures) {
              await saveWav(`${row.fixture}-mix.wav`, fixture.mix);
              await saveWav(`${row.fixture}-reference-drums.wav`, fixture.drums);
              await saveWav(`${row.fixture}-background.wav`, fixture.background);
            }
            results.push(row); console.log(JSON.stringify({ model: modelId, ...row }));
          }
          return { prepareMs, results };
        } finally { separator.dispose(); }
      }, { modelId: model.id, expectedThreads, saveFixtures: model === models[0] });
      Object.assign(row, result, { status: 'passed' });
    } catch (error) { row.status = 'failed'; row.error = error.message; console.log(`${model.id}: ${error.message}`); }
    await save();
  }
  if (report.models.some(model => model.status !== 'passed')) process.exitCode = 1;
  console.log(`Saved ${join(output, 'results.json')}`);
} finally { await save(); await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
