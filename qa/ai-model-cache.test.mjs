import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the production selection/verification/lifetime code. Only external
// model bytes and the two ORT module imports are replaced with controlled local
// fixtures; no decision branches are reimplemented in this test.
test('AI backend fallback keeps a working cached runtime and releases resources on abort', async () => {
  const bytes = Uint8Array.of(1, 2, 3, 4);
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  let source = await readFile(new URL('../js/ai-model-cache.js', import.meta.url), 'utf8');
  const fixture = id => ({ id, bytes: bytes.length, url: `https://cache.invalid/${id}`, sha256: sha });
  source = source.replace(/export const AI_WASM_ASSET = Object.freeze\(\{[\s\S]*?\}\);/, `export const AI_WASM_ASSET=Object.freeze(${JSON.stringify(fixture('cpu'))});`)
    .replace(/export const AI_WEBGPU_WASM_ASSET = Object.freeze\(\{[\s\S]*?\}\);/, `export const AI_WEBGPU_WASM_ASSET=Object.freeze(${JSON.stringify(fixture('gpu'))});`);
  for (const [kind, file] of [['cpu', 'ort-wasm-1.31.1.min.mjs'], ['gpu', 'ort-webgpu-1.31.1.min.mjs']]) {
    const dependency = `import('./vendor/${file}')`;
    assert.ok(source.includes(dependency), 'runtime dependency injection must target an actual import');
    const mock = `export const env={wasm:{}};export const InferenceSession={create:async()=>globalThis.__drummerCacheRuntimes.create('${kind}')};`;
    source = source.replace(dependency, `import(${JSON.stringify('data:text/javascript;base64,' + Buffer.from(mock).toString('base64'))})`);
  }
  const saved = Object.fromEntries(['navigator', 'caches', 'fetch', '__drummerCacheRuntimes'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const revoke = URL.revokeObjectURL;
  let available, scenario, closed, created, revoked;
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { hardwareConcurrency: 8, gpu: { requestAdapter: async () => ({}) } } });
    globalThis.caches = { open: async () => ({ match: async url => available.has(url.split('/').at(-1)) ? new Response(bytes) : undefined,
      delete: async () => true, put: async () => { throw new Error('Unexpected cache write'); } }) };
    globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
    URL.revokeObjectURL = url => { revoked++; revoke(url); };
    globalThis.__drummerCacheRuntimes = { create: async kind => {
      created.push(kind);
      if (kind === 'cpu' && scenario === 'failure') throw new Error('CPU allocation failed');
      if (kind === 'cpu' && scenario === 'abort') throw new DOMException('Cancelled', 'AbortError');
      return { run: async () => ({ result: { data: Float32Array.of(1), dispose() {} } }), release: async () => closed.push(kind) };
    } };
    const { chooseAiSession } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    for (const row of [
      { name: 'cached CPU while GPU runtime is absent', cache: ['cpu'], expected: 'wasm', created: ['cpu'] },
      { name: 'cached GPU while CPU runtime is absent', cache: ['gpu'], expected: 'webgpu', created: ['gpu'] },
      { name: 'CPU allocation failure preserves benchmarked GPU', cache: ['cpu', 'gpu'], scenario: 'failure', expected: 'webgpu', created: ['gpu', 'cpu'] },
      { name: 'abort during CPU creation closes GPU', cache: ['cpu', 'gpu'], scenario: 'abort', created: ['gpu', 'cpu'] },
    ]) {
      available = new Set(row.cache); scenario = row.scenario; closed = []; created = []; revoked = 0;
      let chosen;
      try {
        if (scenario === 'abort') {
          await assert.rejects(chooseAiSession(bytes, {}, { allowDownload: false, sample: () => ({}) }), error => error.name === 'AbortError', row.name);
          assert.deepEqual(closed, ['gpu']); assert.equal(revoked, 2, 'both failed CPU runtime and prior GPU runtime release blob URLs');
        } else {
          chosen = await chooseAiSession(bytes, {}, { allowDownload: false, sample: () => ({}) });
          assert.equal(chosen.backend, row.expected, row.name);
          assert.deepEqual(closed, [], 'chosen session remains usable');
          if (scenario === 'failure') assert.equal(revoked, 1, 'failed CPU runtime releases its blob URL');
        }
        assert.deepEqual(created, row.created, row.name);
      } finally { if (chosen) { await chosen.session.release(); chosen.runtime.release(); } }
    }
  } finally {
    URL.revokeObjectURL = revoke;
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
