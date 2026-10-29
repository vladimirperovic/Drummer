import { ADTOF_MODEL, ADTOF_SAMPLE_RATE } from './ai-transcription-model.js';
import { AI_WASM_ASSET } from './ai-model-cache.js';

export const getTranscriberModelInfo = () => ({ ...ADTOF_MODEL, downloadBytes: ADTOF_MODEL.bytes,
  totalDownloadBytes: ADTOF_MODEL.bytes + AI_WASM_ASSET.bytes, backend: 'wasm', sampleRate: ADTOF_SAMPLE_RATE, maxSeconds: 600 });

export function createDrumTranscriber({ onProgress = () => {} } = {}) {
  let worker, sequence = 0; const pending = new Map();
  function dispose() {
    worker?.terminate(); worker = null;
    for (const call of pending.values()) { call.cleanup(); call.reject(new DOMException('Aborted', 'AbortError')); }
    pending.clear();
  }
  function ready() {
    if (worker) return;
    worker = new Worker(new URL('./ai-transcription-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const call = pending.get(data.id); if (!call) return;
      if (data.type === 'progress') { onProgress(data.progress); return; }
      pending.delete(data.id); call.cleanup();
      if (data.type === 'error') call.reject(Object.assign(new Error(data.error.message), { code: data.error.code }));
      else call.resolve(data.result);
    };
    worker.onerror = () => {
      for (const call of pending.values()) { call.cleanup(); call.reject(new Error('AI worker nije dostupan u ovom browseru.')); }
      pending.clear(); worker?.terminate(); worker = null;
    };
  }
  function request(type, payload = {}, { signal } = {}, transfer = []) {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    ready(); const id = ++sequence;
    return new Promise((resolve, reject) => {
      const abort = () => dispose(), cleanup = () => signal?.removeEventListener('abort', abort);
      signal?.addEventListener('abort', abort, { once: true }); pending.set(id, { resolve, reject, cleanup });
      worker.postMessage({ id, type, ...payload }, transfer);
    });
  }
  return {
    prepare: ({ allowDownload = false, signal } = {}) => request('prepare', { allowDownload }, { signal }),
    async transcribe({ channels, sampleRate }, { allowDownload = false, signal } = {}) {
      if (sampleRate !== ADTOF_SAMPLE_RATE || !Array.isArray(channels) || !channels.length || channels.length > 2
        || channels.some(channel => !(channel instanceof Float32Array) || channel.length !== channels[0].length)) throw new Error('AI transkripcija zahteva audio na 44.100 Hz.');
      const audio = new Float32Array(channels[0].length);
      if (!audio.length || audio.length > ADTOF_SAMPLE_RATE * 600) throw new Error('Za AI izaberi snimak od 0,05 sekundi do 10 minuta.');
      for (let start = 0; start < audio.length; start += 1000000) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const end = Math.min(audio.length, start + 1000000);
        for (let i = start; i < end; i++) { let value = 0; for (const channel of channels) value += channel[i]; audio[i] = value / channels.length; }
        if (end < audio.length) await new Promise(resolve => setTimeout(resolve, 0));
      }
      return request('transcribe', { audio, allowDownload }, { signal }, [audio.buffer]);
    },
    dispose,
  };
}
