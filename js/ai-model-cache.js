// Optional model/runtime data is kept outside the application/service-worker cache.
// Nothing is fetched until the caller explicitly grants allowDownload.
export const AI_CACHE_NAME = 'drummer-ai-models-v1';
export const AI_WASM_ASSET = Object.freeze({
  id: 'ort-wasm-1.31.1', bytes: 14848852,
  url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort-wasm-simd-threaded.wasm',
  sha256: '4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d',
});

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

export async function createAiWasmRuntime(options = {}) {
  const bytes = await getAiAsset(AI_WASM_ASSET, options);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
  try {
    const ort = await import('./vendor/ort-wasm-1.31.1.min.mjs');
    // Works on static hosting without COOP/COEP. A dedicated Worker keeps the UI responsive.
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; ort.env.wasm.wasmPaths = { wasm: url };
    return { ort, release: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
