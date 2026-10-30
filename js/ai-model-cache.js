// Optional model/runtime data is kept outside the application/service-worker cache.
// Nothing is fetched until the caller explicitly grants allowDownload.
export const AI_CACHE_NAME = 'drummer-ai-models-v1';
export const AI_WASM_ASSET = Object.freeze({
  id: 'ort-wasm-1.31.1', bytes: 14848852,
  url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort-wasm-simd-threaded.wasm',
  sha256: '4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d',
});
// WebGPU izvršavanje koristi drugu (asyncify) WASM gradnju istog ONNX Runtime-a.
export const AI_WEBGPU_WASM_ASSET = Object.freeze({
  id: 'ort-webgpu-wasm-1.31.1', bytes: 28747738,
  url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort-wasm-simd-threaded.asyncify.wasm',
  sha256: 'ca319e9539cd0f1e291cf56074760121eaf39650f5dbf84b6e52c07f4b2944ec',
});

// Više niti samo kada je stranica cross-origin isolated (COOP/COEP zaglavlja ili service worker);
// bez toga browser ne dozvoljava deljenu memoriju. Pola logičkih jezgara je izmereno najbrže:
// na M1 (4 brza + 4 štedljiva) Demucs traje 13,9 s po isečku sa 1 niti, 6,3 s sa 4 i 7,0 s sa 8.
export function aiThreadCount(isolated = globalThis.crossOriginIsolated === true, cores = globalThis.navigator?.hardwareConcurrency) {
  return isolated ? Math.max(1, Math.min(8, Math.ceil((Math.round(cores) || 4) / 2))) : 1;
}
export async function hasWebGpu() {
  try { return !!(await globalThis.navigator?.gpu?.requestAdapter()); } catch { return false; }
}

function checkAsset(asset) {
  if (!asset || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 400 * 1024 * 1024
    || !/^[a-f0-9]{64}$/i.test(asset.sha256) || !/^https?:\/\//.test(asset.url)) throw new Error('Neispravan opis AI modela.');
}
function aborted(signal) { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); }
async function verified(bytes, asset) {
  if (bytes.byteLength !== asset.bytes) return false;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('') === asset.sha256.toLowerCase();
}
async function openCache() { try { return await caches.open(AI_CACHE_NAME); } catch { return null; } }
export async function isAiAssetCached(asset) {
  checkAsset(asset); const cache = await openCache();
  return !!(await cache?.match(asset.url));
}
export async function clearAiModelCache() { return globalThis.caches ? caches.delete(AI_CACHE_NAME) : false; }

export async function getAiAsset(asset, { allowDownload = false, onProgress = () => {}, signal } = {}) {
  checkAsset(asset); aborted(signal);
  const cache = await openCache(), cached = await cache?.match(asset.url);
  if (cached) {
    const bytes = new Uint8Array(await cached.arrayBuffer()); aborted(signal);
    if (await verified(bytes, asset)) { onProgress({ stage: 'cached', id: asset.id, loaded: asset.bytes, total: asset.bytes }); return bytes; }
    await cache.delete(asset.url);
  }
  if (!allowDownload) throw Object.assign(new Error('Prvo odobri preuzimanje AI modela.'), { code: 'AI_DOWNLOAD_REQUIRED' });
  aborted(signal);
  const response = await fetch(asset.url, { signal, credentials: 'omit', cache: 'no-cache' });
  if (!response.ok) throw new Error('Preuzimanje AI modela nije uspelo. Proveri internet vezu.');
  const bytes = new Uint8Array(asset.bytes); let loaded = 0;
  onProgress({ stage: 'download', id: asset.id, loaded, total: asset.bytes });
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        aborted(signal); const { done, value } = await reader.read(); if (done) break;
        if (loaded + value.byteLength > bytes.length) throw new Error('AI datoteka ima neočekivanu veličinu.');
        bytes.set(value, loaded); loaded += value.byteLength;
        onProgress({ stage: 'download', id: asset.id, loaded, total: asset.bytes });
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  } else {
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.length !== bytes.length) throw new Error('AI datoteka ima neočekivanu veličinu.');
    bytes.set(body); loaded = body.length;
  }
  aborted(signal); onProgress({ stage: 'verify', id: asset.id, loaded, total: asset.bytes });
  if (loaded !== asset.bytes || !await verified(bytes, asset)) throw new Error('Provera AI datoteke nije uspela. Preuzimanje je odbačeno.');
  aborted(signal);
  try { await cache?.put(asset.url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })); }
  catch { onProgress({ stage: 'cache-unavailable', id: asset.id, loaded, total: asset.bytes }); }
  if (!cache) onProgress({ stage: 'cache-unavailable', id: asset.id, loaded, total: asset.bytes });
  return bytes;
}

async function createRuntime(asset, load, options) {
  const bytes = await getAiAsset(asset, options);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
  try {
    const ort = await load();
    // A dedicated Worker keeps the UI responsive; ORT starts its own thread workers when isolated.
    ort.env.wasm.numThreads = aiThreadCount(); ort.env.wasm.proxy = false; ort.env.wasm.wasmPaths = { wasm: url };
    return { ort, release: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
export const createAiWasmRuntime = (options = {}) => createRuntime(AI_WASM_ASSET, () => import('./vendor/ort-wasm-1.31.1.min.mjs'), options);
export const createAiWebGpuRuntime = (options = {}) => createRuntime(AI_WEBGPU_WASM_ASSET, () => import('./vendor/ort-webgpu-1.31.1.min.mjs'), options);

async function openSession(create, model, sessionOptions, providers, options) {
  const runtime = await create(options);
  try { return { runtime, session: await runtime.ort.InferenceSession.create(model, { ...sessionOptions, executionProviders: providers }), backend: providers[0] }; }
  catch (error) { runtime.release(); throw error; }
}
async function closeSession(choice) { if (!choice) return; await Promise.resolve(choice.session?.release?.()).catch(() => {}); choice.runtime.release(); }
async function timeSession({ runtime, session }, sample) {
  const feeds = sample(runtime.ort), started = performance.now();
  let outputs;
  try {
    outputs = await session.run(feeds);
    if (!Object.values(outputs).every(output => output.data.every(Number.isFinite))) throw new Error('AI_INVALID_OUTPUT');
    return performance.now() - started;
  } finally { for (const tensor of [...Object.values(feeds), ...Object.values(outputs || {})]) tensor.dispose(); }
}
const stopping = error => error?.name === 'AbortError';

// Pozadina po modelu: 'wasm' (CPU sa više niti), 'webgpu' (GPU, uz CPU za čvorove koje GPU nema) ili 'auto':
// tada se oba otvore i izmere na istom probnom ulazu (sample) i zadržava se brži. GPU koji ne može da otvori
// model ili daje neispravan izlaz ostaje van izbora. Rezultat merenja pozivalac pamti, pa se meri samo jednom.
export async function chooseAiSession(model, sessionOptions = {}, { preference = 'auto', sample, allowDownload = false, onProgress, signal } = {}) {
  const options = { allowDownload, onProgress, signal }, threads = aiThreadCount();
  const cpu = () => openSession(createAiWasmRuntime, model, sessionOptions, ['wasm'], options);
  if (preference === 'wasm' || !(await hasWebGpu())) return { ...(await cpu()), threads, benchmark: null };
  let gpu = null, gpuMs = null, reason = null;
  try {
    gpu = await openSession(createAiWebGpuRuntime, model, sessionOptions, ['webgpu', 'wasm'], options);
    if (sample) gpuMs = await timeSession(gpu, sample);
  } catch (error) {
    await closeSession(gpu); gpu = null;
    if (stopping(error)) throw error;
    reason = String(error?.message || error).replace(/\s+/g, ' ').slice(0, 200);
  }
  if (gpu && (preference === 'webgpu' || !sample)) return { ...gpu, threads, benchmark: { chosen: 'webgpu', gpuMs, cpuMs: null, reason } };
  let cpuChoice;
  try { cpuChoice = await cpu(); }
  catch (error) {
    if (gpu && !stopping(error)) return { ...gpu, threads, benchmark: { chosen: 'webgpu', gpuMs, cpuMs: null, reason: String(error?.message || error).slice(0, 200) } };
    await closeSession(gpu); throw error;
  }
  let cpuMs = null;
  if (gpu) {
    try { cpuMs = await timeSession(cpuChoice, sample); }
    catch (error) { await closeSession(cpuChoice); if (stopping(error)) { await closeSession(gpu); throw error; } return { ...gpu, threads, benchmark: { chosen: 'webgpu', gpuMs, cpuMs: null, reason } }; }
    if (gpuMs < cpuMs) { await closeSession(cpuChoice); return { ...gpu, threads, benchmark: { chosen: 'webgpu', gpuMs, cpuMs, reason } }; }
    await closeSession(gpu);
  }
  return { ...cpuChoice, threads, benchmark: { chosen: 'wasm', gpuMs, cpuMs, reason } };
}
