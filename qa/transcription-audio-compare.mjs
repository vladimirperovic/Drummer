// Explicit local audio only; no search, download or upload of user audio.
// DRUMMER_TRANSCRIBE_FILES='["C:/explicit/clip.wav",{"path":"C:/explicit/drums.wav","label":"drums","sourceOffsetSeconds":45}]'
// Each input is decoded once; one warm WASM session/model processes all inputs.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, extname, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { TRANSCRIBER_MODELS, ADTOF_MODEL } from '../js/ai-transcription-model.js';
import { AI_WASM_ASSET } from '../js/ai-model-cache.js';

let requested;
try { requested = JSON.parse(process.env.DRUMMER_TRANSCRIBE_FILES || 'null'); } catch { throw new Error('DRUMMER_TRANSCRIBE_FILES must be a JSON array of explicit paths or {path,label,sourceOffsetSeconds} objects.'); }
if (!Array.isArray(requested) || !requested.length || requested.length > 16) throw new Error('Supply 1–16 explicit audio paths in DRUMMER_TRANSCRIBE_FILES. No folders are searched.');
const expectedThreads = Number(process.env.DRUMMER_TRANSCRIBE_THREADS || 8), timeoutMs = Number(process.env.DRUMMER_TRANSCRIBE_TIMEOUT_MS || 300000);
if (!Number.isInteger(expectedThreads) || expectedThreads < 1 || expectedThreads > 8 || !Number.isFinite(timeoutMs) || timeoutMs < 1000) throw new Error('Invalid thread expectation or inference timeout.');
const maxSeconds = Number(process.env.DRUMMER_TRANSCRIBE_MAX_SECONDS || 60);
if (!Number.isFinite(maxSeconds) || maxSeconds < .05 || maxSeconds > 600) throw new Error('Clip duration limit must be between 0.05 and 600 seconds. The default is 60 seconds.');
const output = resolve(process.env.DRUMMER_TRANSCRIBE_OUTPUT || join(tmpdir(), 'drummer-transcription-comparison'));
const root = fileURLToPath(new URL('../', import.meta.url)), jsRoot = resolve(root, 'js'), fixtures = join(tmpdir(), 'drummer-ai-feasibility');
const digest = async path => { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); };
const inputs = await Promise.all(requested.map(async (item, index) => {
  const entry = typeof item === 'string' ? { path: item } : item;
  if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) throw new Error('Each input needs an explicit audio path.');
  const path = resolve(entry.path), info = await stat(path), sourceOffsetSeconds = Number(entry.sourceOffsetSeconds ?? 0);
  if (!info.isFile() || !info.size || info.size > 100 * 1024 * 1024) throw new Error(`Input must be a nonempty file of at most 100 MiB: ${path}`);
  if (!Number.isFinite(sourceOffsetSeconds) || sourceOffsetSeconds < 0) throw new Error('sourceOffsetSeconds must be nonnegative. It annotates a precut clip; it does not trim audio.');
  const name = basename(path), label = String(entry.label || name), slug = label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80) || 'audio';
  return { id: `${String(index + 1).padStart(2, '0')}-${slug}`, path, name, label, sourceOffsetSeconds, bytes: info.size, sha256: await digest(path), endpoint: `/_input/${index}` };
}));
const adtFolder = process.env.DRUMMER_ADT_DIR || join(tmpdir(), 'drummer-adtstr');
const descriptors = [...TRANSCRIBER_MODELS.flatMap(model => model.assets), { ...AI_WASM_ASSET, id: 'wasm' }];
const assets = new Map(descriptors.map(asset => [asset.id, asset.id === 'wasm'
  ? process.env.DRUMMER_AI_WASM || join(fixtures, 'package/dist/ort-wasm-simd-threaded.wasm')
  : asset.id === ADTOF_MODEL.id ? process.env.DRUMMER_ADTOF_MODEL || join(fixtures, 'adtof_frame_rnn.onnx')
    : join(adtFolder, asset.url.split('/').at(-1))]));
for (const asset of descriptors) {
  const path = assets.get(asset.id);
  if ((await stat(path)).size !== asset.bytes || await digest(path) !== asset.sha256) throw new Error(`Local model/runtime integrity check failed: ${asset.id}`);
}
await mkdir(output, { recursive: true });
const report = {
  created: new Date().toISOString(), referenceAvailable: false,
  caveat: 'No validated score or clean onset reference is supplied. Event counts are predictions, not accuracy scores. Raw ADT_STR GM events retain auxiliary percussion and articulation before application mapping; mapped events use default app assignments. No F1 or quality ranking is computed.',
  method: { backend: 'wasm', expectedThreads, maxClipSeconds: maxSeconds, sampleRate: 44100, sensitivity: 1, gain: 'Input WAV samples are used without gain changes. Supply files exported with a shared gain when comparing separators.',
    timing: 'timeSeconds is relative to the clip; sourceTimeSeconds adds the supplied sourceOffsetSeconds. MIDI files start at clip time zero and preserve onset times without quantization. Their 120 BPM and 4/4 metadata are placeholders, not estimates.',
    execution: 'Decode once; sequential inference; one reusable session per transcription model; first inference cold, subsequent inferences warm. ADTOF groups are coarser than ADT_STR articulations and cannot be compared by raw event count.' },
  inputs: inputs.map(({ endpoint, ...input }) => input), models: [], network: [],
};
const save = async () => {
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2));
  const lines = [report.caveat, '', report.method.timing, ''];
  for (const input of report.inputs) if (input.error) lines.push(`${input.label}: FAILED TO DECODE ${input.error}`);
  for (const model of report.models) {
    lines.push(model.name);
    if (model.error) lines.push(`  FAILED: ${model.error}`);
    for (const row of model.results) lines.push(row.error ? `  ${row.inputId}: FAILED ${row.error}` : `  ${row.inputId}: ${(row.inferenceMs / 1000).toFixed(3)}s, raw ${row.rawCount}, mapped ${row.mappedCount}, skipped ${row.skippedByDefaultMapping}, truncatedChunks ${row.truncatedChunks ?? 'n/a'}, ${row.backend}/${row.threads} threads`);
  }
  await writeFile(join(output, 'results.txt'), lines.join('\n') + '\n');
};
const server = createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Local transcription comparison</title>'); return; }
  let file;
  if (pathname.startsWith('/_assets/')) file = assets.get(pathname.slice(9));
  else if (pathname.startsWith('/_input/')) file = inputs.find(input => input.endpoint === pathname)?.path;
  else if (pathname.startsWith('/js/')) { const candidate = resolve(root, '.' + pathname); if (candidate.startsWith(jsRoot + sep)) file = candidate; }
  if (!file) { res.writeHead(404); res.end(); return; }
  try {
    res.setHeader('Content-Length', (await stat(file)).size);
    res.setHeader('Content-Type', { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' }[extname(file).toLowerCase()] || 'application/octet-stream');
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ serviceWorkers: 'block' }), page = await context.newPage();
page.on('console', message => { if (message.type() === 'log') console.log(message.text()); });
await page.exposeFunction('saveTranscription', async (summary, raw, mapped, rawMidi, mappedMidi, activations) => {
  const model = report.models.find(model => model.id === summary.modelId), input = inputs.find(input => input.id === summary.inputId);
  if (!model || !input) throw new Error('Unknown comparison output');
  const prefix = `${input.id}-${model.id}`, common = { modelId: model.id, inputId: input.id, sourceOffsetSeconds: input.sourceOffsetSeconds, durationSeconds: summary.durationSeconds };
  const files = {};
  for (const [kind, events] of [['raw', raw], ['mapped', mapped]]) {
    files[kind + 'Events'] = `${prefix}.${kind}.json`;
    await writeFile(join(output, files[kind + 'Events']), JSON.stringify({ ...common, kind, events }, null, 2));
    files[kind + 'Midi'] = `${prefix}.${kind}.mid`;
    await writeFile(join(output, files[kind + 'Midi']), Buffer.from(kind === 'raw' ? rawMidi : mappedMidi, 'base64'));
  }
  if (activations) {
    files.activations = `${prefix}.activations.f32`;
    const activationBytes = Buffer.from(activations, 'base64');
    await writeFile(join(output, files.activations), activationBytes);
    summary.activationFormat = { dtype: 'float32-little-endian', shape: [activationBytes.length / 20, 5], fps: 100, classes: ['kick', 'snare', 'toms', 'hihat', 'cymbals'] };
  }
  model.results.push({ ...summary, files }); await save();
});
const approved = new Map(descriptors.map(asset => [asset.url, asset.id]));
await context.route('https://**/*', async route => {
  const url = route.request().url(), asset = approved.get(url); report.network.push({ url, suppliedLocally: !!asset });
  if (!asset) return route.abort();
  return route.fulfill({ status: 302, headers: { location: `${origin}/_assets/${asset}`, 'Access-Control-Allow-Origin': '*' } });
});
try {
  await page.goto(origin);
  report.environment = await page.evaluate(() => ({ browser: navigator.userAgent, cores: navigator.hardwareConcurrency, crossOriginIsolated }));
  if (!report.environment.crossOriginIsolated) throw new Error('Comparison requires cross-origin isolation');
  const decoded = await page.evaluate(async ({ inputs, maxSeconds }) => {
    const { decodeAiAudio } = await import('/js/ai-audio.js'); window.transcriptionInputs = []; const summaries = [];
    for (const input of inputs) {
      try {
        const response = await fetch(input.endpoint); if (!response.ok) throw new Error('Local file could not be read');
        const blob = await response.blob(), audio = await decodeAiAudio(new File([blob], input.name, { type: blob.type }));
        if (audio.duration > maxSeconds) throw new Error(`Supply a precut clip of at most ${maxSeconds} seconds, or explicitly raise DRUMMER_TRANSCRIBE_MAX_SECONDS.`);
        const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c).slice());
        window.transcriptionInputs.push({ ...input, channels });
        summaries.push({ id: input.id, decodedSampleRate: audio.sampleRate, channels: audio.numberOfChannels, durationSeconds: audio.duration, frames: audio.length });
      } catch (error) { summaries.push({ id: input.id, error: error.message }); }
    }
    return summaries;
  }, { inputs, maxSeconds });
  for (const summary of decoded) Object.assign(report.inputs.find(input => input.id === summary.id), summary);
  await save();
  if (decoded.every(input => input.error)) throw new Error('None of the explicitly supplied inputs could be decoded.');
  for (const model of TRANSCRIBER_MODELS) {
    const row = { id: model.id, name: model.name, assets: model.assets.map(({ id, bytes, sha256 }) => ({ id, bytes, sha256 })), status: 'running', results: [] }; report.models.push(row);
    try {
      const result = await page.evaluate(async ({ modelId, expectedThreads, timeoutMs }) => {
        const { createDrumTranscriber } = await import('/js/ai-transcriber.js');
        const { transcriptionEvents, transcriptionMidi, ADTOF_MODEL } = await import('/js/ai-transcription-model.js');
        const base64 = bytes => { const parts = []; for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192))); return btoa(parts.join('')); };
        const counts = (events, property) => { const result = {}; for (const event of events) result[event[property] || '(unmapped)'] = (result[event[property] || '(unmapped)'] || 0) + 1; return result; };
        let currentInput;
        const transcriber = createDrumTranscriber({ onProgress: event => {
          if (event.stage === 'transcribing') console.log(JSON.stringify({ modelId, inputId: currentInput, progress: event.progress }));
        } }), started = performance.now(), failures = [];
        try {
          const info = await transcriber.prepare({ modelId, allowDownload: true, backend: 'wasm' }), prepareMs = performance.now() - started;
          if (info.backend !== 'wasm' || info.threads !== expectedThreads) throw new Error(`Backend/threads mismatch: ${info.backend}/${info.threads}; expected wasm/${expectedThreads}`);
          for (const input of transcriptionInputs) {
            currentInput = input.id;
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs), start = performance.now();
            try {
              const result = await transcriber.transcribe({ channels: input.channels, sampleRate: 44100 }, { modelId, backend: 'wasm', allowDownload: false, signal: controller.signal });
              if (result.backend !== 'wasm' || result.threads !== expectedThreads) throw new Error('Inference changed backend or thread count');
              const mapped = transcriptionEvents(result, { sensitivity: 1 }), raw = modelId === ADTOF_MODEL.id ? mapped.map(event => ({ ...event })) : result.events;
              if (![...raw, ...mapped].every(event => Number.isFinite(event.timeSeconds) && event.timeSeconds >= 0 && event.timeSeconds < result.durationSeconds && Number.isInteger(event.velocity) && event.velocity >= 1 && event.velocity <= 127)) throw new Error('Invalid predicted event');
              for (const event of [...raw, ...mapped]) event.sourceTimeSeconds = input.sourceOffsetSeconds + event.timeSeconds;
              const rawMidiEvents = raw.map(event => Number.isInteger(event.midi) ? { ...event, inst: `gm-${event.midi}` } : event);
              const noteMap = Object.fromEntries(raw.filter(event => Number.isInteger(event.midi)).map(event => [`gm-${event.midi}`, event.midi]));
              const summary = { modelId, inputId: input.id, durationSeconds: result.durationSeconds, inferenceMs: result.inferenceMs, totalMs: performance.now() - start, backend: result.backend, threads: result.threads,
                rawCount: raw.length, mappedCount: mapped.length, skippedByDefaultMapping: raw.length - mapped.length, truncatedChunks: result.truncatedChunks ?? null,
                rawGroups: counts(raw, 'group'), mappedInstruments: counts(mapped, 'inst') };
              await saveTranscription(summary, raw, mapped, base64(transcriptionMidi(rawMidiEvents, { durationSeconds: result.durationSeconds, noteMap })),
                base64(transcriptionMidi(mapped, { durationSeconds: result.durationSeconds })), result.activations ? base64(new Uint8Array(result.activations.buffer, result.activations.byteOffset, result.activations.byteLength)) : null);
              console.log(JSON.stringify({ complete: true, ...summary }));
            } catch (error) { const failure = { inputId: input.id, error: error.name === 'AbortError' ? 'Transcription cancelled after its time limit' : error.message }; failures.push(failure); console.log(JSON.stringify(failure)); }
            finally { clearTimeout(timer); }
          }
          return { prepareMs, failures };
        } finally { transcriber.dispose(); }
      }, { modelId: model.id, expectedThreads, timeoutMs });
      row.prepareMs = result.prepareMs; row.results.push(...result.failures); row.status = result.failures.length ? 'failed' : 'passed';
    } catch (error) { row.status = 'failed'; row.error = error.message; }
    await save();
  }
  if (report.inputs.some(input => input.error) || report.models.some(model => model.status !== 'passed')) process.exitCode = 1;
  console.log(`Saved ${join(output, 'results.json')}`);
} catch (error) { report.error = error.message; process.exitCode = 1; console.error(error.message); }
finally { await save(); await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
