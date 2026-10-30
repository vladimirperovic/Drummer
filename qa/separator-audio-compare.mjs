// Local MP3/FLAC/WAV comparison. Never scans for audio or downloads/uploads it.
// DRUMMER_COMPARE_FILES='["C:/explicit/song.mp3","C:/explicit/song.flac"]'
// DRUMMER_COMPARE_OFFSET=0 DRUMMER_COMPARE_SECONDS=15 node qa/separator-audio-compare.mjs
// Model assets: same DRUMMER_*_MODEL / DRUMMER_AI_WASM variables as separator-benchmark.mjs.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, extname, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SEPARATOR_MODELS } from '../js/drum-separator-core.js';
import { AI_WASM_ASSET } from '../js/ai-model-cache.js';

let requested;
try { requested = JSON.parse(process.env.DRUMMER_COMPARE_FILES || 'null'); } catch { throw new Error('DRUMMER_COMPARE_FILES must be a JSON array of 1–3 explicit file paths.'); }
if (!Array.isArray(requested) || requested.length < 1 || requested.length > 3 || requested.some(path => typeof path !== 'string' || !path.trim())) {
  throw new Error('Set DRUMMER_COMPARE_FILES to a JSON array of 1–3 explicit audio file paths. No folders are searched.');
}
const offset = Number(process.env.DRUMMER_COMPARE_OFFSET || 0), seconds = Number(process.env.DRUMMER_COMPARE_SECONDS || 15);
if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(seconds) || seconds < .05 || seconds > 60) throw new Error('Use a nonnegative offset and an excerpt duration from 0.05 to 60 seconds (default 15).');
const expectedThreads = Number(process.env.DRUMMER_COMPARE_THREADS || 8), timeoutMs = Number(process.env.DRUMMER_COMPARE_TIMEOUT_MS || 300000);
if (!Number.isInteger(expectedThreads) || expectedThreads < 1 || expectedThreads > 8 || !Number.isFinite(timeoutMs) || timeoutMs < 1000) throw new Error('Invalid thread expectation or inference timeout.');
const root = fileURLToPath(new URL('../', import.meta.url)), jsRoot = resolve(root, 'js'), fixtures = join(tmpdir(), 'drummer-ai-feasibility');
const output = resolve(process.env.DRUMMER_COMPARE_OUTPUT || join(tmpdir(), 'drummer-audio-comparison'));
const inputs = await Promise.all(requested.map(async (inputPath, index) => {
  const path = resolve(inputPath), info = await stat(path);
  if (!info.isFile() || !info.size || info.size > 100 * 1024 * 1024) throw new Error(`Audio must be a file of 1–100 MB: ${path}`);
  const name = basename(path), slug = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80) || 'audio';
  return { id: `${String(index + 1).padStart(2, '0')}-${slug}`, path, name, bytes: info.size, endpoint: `/_input/${index}` };
}));
const paths = {
  'htdemucs-ft-drums-fp16-55f929d3': process.env.DRUMMER_DEMUCS_MODEL || join(fixtures, 'htdemucs_ft_drums_fp16weights.onnx'),
  'scnet-large-int8': process.env.DRUMMER_SCNET_MODEL || join(fixtures, 'scnet-large.int8.onnx'),
  'scnet-int8': process.env.DRUMMER_SCNET_SMALL_MODEL || join(fixtures, 'scnet.int8.onnx'),
};
const models = SEPARATOR_MODELS.filter(model => paths[model.id]);
const runtime = process.env.DRUMMER_AI_WASM || join(fixtures, 'package/dist/ort-wasm-simd-threaded.wasm');
const assets = new Map([['wasm', runtime], ...models.map(model => [model.id, paths[model.id]])]);
for (const asset of [...models, { ...AI_WASM_ASSET, id: 'wasm' }]) {
  const path = assets.get(asset.id), info = await stat(path), hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (info.size !== asset.bytes || hash.digest('hex') !== asset.sha256) throw new Error(`Model/runtime integrity check failed: ${asset.id}`);
}
await mkdir(join(output, 'audio'), { recursive: true });
const report = {
  created: new Date().toISOString(), referenceAvailable: false,
  caveat: 'No clean reference drums were supplied: these results report runtime and audio integrity only. They do not rank accuracy, SDR or separation quality. Listen to the same excerpt from each model.',
  method: { requestedOffsetSeconds: offset, requestedDurationSeconds: seconds, backend: 'wasm', expectedThreads, sampleRate: 44100, gain: 'One shared gain per input, chosen from the peak of its input excerpt and all successful outputs. PCM16 WAV exports have 5% peak headroom; relative model loudness is preserved.', execution: 'Each input is decoded once. All models receive identical decoded samples. Sessions are reused across input files. One model runs at a time.' },
  inputs: inputs.map(({ endpoint, ...input }) => input), models: [], network: [], exports: [],
};
const save = async () => {
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2));
  const lines = [report.caveat, '', `Requested excerpt: offset ${offset}s, length ${seconds}s.`, ''];
  for (const input of report.inputs) if (input.error) lines.push(`${input.name}: FAILED TO DECODE ${input.error}`);
  for (const model of report.models) {
    lines.push(model.name);
    if (model.error) lines.push(`  FAILED: ${model.error}`);
    for (const row of model.results || []) lines.push(row.error ? `  ${row.inputId}: FAILED ${row.error}` : `  ${row.inputId}: ${(row.inferenceMs / 1000).toFixed(3)}s processing / ${row.durationSeconds.toFixed(3)}s audio, ${row.backend}/${row.threads} threads, finite ${row.finite}`);
  }
  for (const row of report.exports) lines.push(`Audio: ${row.inputId}; shared gain ${row.gain}; ${row.files.join(', ')}`);
  await writeFile(join(output, 'results.txt'), lines.join('\n') + '\n');
};
const server = createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Local audio comparison</title>'); return; }
  let file;
  if (pathname.startsWith('/_assets/')) file = assets.get(pathname.slice(9));
  else if (pathname.startsWith('/_input/')) file = inputs.find(input => input.endpoint === pathname)?.path;
  else if (pathname.startsWith('/js/')) { const candidate = resolve(root, '.' + pathname); if (candidate.startsWith(jsRoot + sep)) file = candidate; }
  if (!file) { res.writeHead(404); res.end(); return; }
  try {
    res.setHeader('Content-Length', (await stat(file)).size);
    res.setHeader('Content-Type', { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' }[extname(file).toLowerCase()] || 'application/octet-stream');
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ serviceWorkers: 'block' }), page = await context.newPage();
page.on('console', message => { if (message.type() === 'log') console.log(message.text()); });
await page.exposeFunction('saveComparisonWav', async (name, base64) => {
  if (!/^[a-z0-9-]+\.wav$/.test(name)) throw new Error('Invalid comparison output name');
  await writeFile(join(output, 'audio', name), Buffer.from(base64, 'base64'));
});
const approved = new Map([[AI_WASM_ASSET.url, 'wasm'], ...models.map(model => [model.url, model.id])]);
await context.route('https://**/*', async route => {
  const url = route.request().url(), asset = approved.get(url); report.network.push({ url, suppliedLocally: !!asset });
  if (!asset) return route.abort();
  return route.fulfill({ status: 302, headers: { location: `${origin}/_assets/${asset}`, 'Access-Control-Allow-Origin': '*' } });
});
try {
  await page.goto(origin);
  report.environment = await page.evaluate(() => ({ browser: navigator.userAgent, cores: navigator.hardwareConcurrency, crossOriginIsolated }));
  if (!report.environment.crossOriginIsolated) throw new Error('Comparison requires cross-origin isolation');
  const decoded = await page.evaluate(async ({ inputs, offset, seconds }) => {
    const { decodeAiAudio } = await import('/js/ai-audio.js');
    window.comparisonInputs = [];
    const summaries = [];
    for (const input of inputs) {
      try {
        const response = await fetch(input.endpoint); if (!response.ok) throw new Error('Local file could not be read');
        const blob = await response.blob(), audio = await decodeAiAudio(new File([blob], input.name, { type: blob.type }));
        const start = Math.round(offset * audio.sampleRate), length = Math.min(Math.round(seconds * audio.sampleRate), audio.length - start);
        if (length < Math.ceil(.05 * audio.sampleRate)) throw new Error('Offset is outside the audio, or the remaining excerpt is shorter than 0.05s');
        const channels = [0, 1].map(c => audio.getChannelData(Math.min(c, audio.numberOfChannels - 1)).slice(start, start + length));
        window.comparisonInputs.push({ id: input.id, channels, outputs: [] });
        summaries.push({ id: input.id, decodedSampleRate: audio.sampleRate, decodedSourceChannels: audio.numberOfChannels, sourceDurationSeconds: audio.duration, actualOffsetSeconds: start / audio.sampleRate, durationSeconds: length / audio.sampleRate, frames: length, outputChannels: 2 });
      } catch (error) { summaries.push({ id: input.id, error: error.message }); }
    }
    return summaries;
  }, { inputs, offset, seconds });
  for (const summary of decoded) Object.assign(report.inputs.find(input => input.id === summary.id), summary);
  await save();
  if (decoded.every(input => input.error)) throw new Error('None of the explicitly supplied inputs could be decoded at the requested offset.');
  for (const model of models) {
    const row = { id: model.id, name: model.name, bytes: model.bytes, sha256: model.sha256, status: 'running' }; report.models.push(row);
    console.log(`Comparing ${model.name}`);
    try {
      const result = await page.evaluate(async ({ modelId, expectedThreads, timeoutMs }) => {
        const { createDrumSeparator } = await import('/js/drum-separator.js');
        const separator = createDrumSeparator({ modelId }), started = performance.now(), results = [];
        try {
          const info = await separator.prepare({ allowDownload: true, backend: 'wasm' }), prepareMs = performance.now() - started;
          if (info.backend !== 'wasm' || info.threads !== expectedThreads) throw new Error(`Backend/threads mismatch: ${info.backend}/${info.threads}; expected wasm/${expectedThreads}`);
          for (const input of comparisonInputs) {
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
              const result = await separator.separate({ channels: input.channels, sampleRate: 44100 }, { signal: controller.signal });
              const finite = result.channels.every(channel => channel.every(Number.isFinite));
              if (!finite || result.channels.length !== 2 || result.channels.some(channel => channel.length !== input.channels[0].length)) throw new Error('Invalid output audio');
              input.outputs.push({ modelId, channels: result.channels });
              const row = { inputId: input.id, backend: result.backend, threads: result.threads, durationSeconds: input.channels[0].length / 44100, inferenceMs: result.inferenceMs, realTimeFactor: result.inferenceMs / 1000 / (input.channels[0].length / 44100), finite };
              results.push(row); console.log(JSON.stringify({ modelId, ...row }));
            } catch (error) { results.push({ inputId: input.id, error: error.name === 'AbortError' ? 'Comparison cancelled after its time limit' : error.message }); }
            finally { clearTimeout(timer); }
          }
          return { prepareMs, results };
        } finally { separator.dispose(); }
      }, { modelId: model.id, expectedThreads, timeoutMs });
      Object.assign(row, result, { status: result.results.some(result => result.error) ? 'failed' : 'passed' });
    } catch (error) { row.status = 'failed'; row.error = error.message; }
    await save();
  }
  report.exports = await page.evaluate(async () => {
    const { encodeAiWav } = await import('/js/ai-audio.js'), exports = [];
    for (const input of comparisonInputs) {
      const sounds = [{ suffix: 'input', channels: input.channels }, ...input.outputs.map(output => ({ suffix: output.modelId + '-drums', channels: output.channels }))];
      let peak = 0; for (const sound of sounds) for (const channel of sound.channels) for (const value of channel) peak = Math.max(peak, Math.abs(value));
      const gain = peak > 0 ? Math.min(1, .95 / peak) : 1, files = [];
      for (const sound of sounds) {
        const bytes = new Uint8Array(encodeAiWav(sound.channels.map(channel => Float32Array.from(channel, value => value * gain)), 44100)), chunks = [];
        for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
        const name = `${input.id}-${sound.suffix}.wav`;
        await saveComparisonWav(name, btoa(chunks.join(''))); files.push(name);
      }
      exports.push({ inputId: input.id, unscaledPeak: peak, gain, files });
    }
    return exports;
  });
  if (report.inputs.some(input => input.error) || report.models.some(model => model.status !== 'passed')) process.exitCode = 1;
  console.log(`Saved ${join(output, 'results.json')}`);
} catch (error) { report.error = error.message; process.exitCode = 1; console.error(error.message); }
finally { await save(); await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
