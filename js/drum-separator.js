import { DRUM_SEPARATOR_MODEL, SEPARATOR_RATE, validateSeparatorAudio } from './drum-separator-core.js';

export const getSeparatorModelInfo = () => ({ ...DRUM_SEPARATOR_MODEL });
const aborted = () => new DOMException('Separation cancelled', 'AbortError');

async function stereo44k(channels, sampleRate, signal) {
  validateSeparatorAudio(channels, sampleRate);
  if (signal?.aborted) throw aborted();
  if (sampleRate === SEPARATOR_RATE) return [channels[0].slice(), (channels[1] || channels[0]).slice()];
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline) throw new Error('SEPARATOR_RESAMPLING_UNAVAILABLE');
  const context = new Offline(2, Math.max(1, Math.round(channels[0].length * SEPARATOR_RATE / sampleRate)), SEPARATOR_RATE);
  const buffer = context.createBuffer(2, channels[0].length, sampleRate);
  for (let c = 0; c < 2; c++) buffer.copyToChannel(channels[c] || channels[0], c);
  const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();
  const result = await context.startRendering();
  if (signal?.aborted) throw aborted();
  return [result.getChannelData(0), result.getChannelData(1)];
}

export function createDrumSeparator({ onProgress = () => {} } = {}) {
  let worker, counter = 0, current, prepared = false, processing = false, generation = 0;
  function terminate(error = aborted()) {
    generation++;
    worker?.terminate(); worker = undefined; prepared = false;
    if (current) { const request = current; current = undefined; request.cleanup(); request.reject(error); }
  }
  function getWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./drum-separator-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (!current || data.id !== current.id) return;
      if (data.type === 'progress') { onProgress(data.progress); return; }
      const request = current; current = undefined; request.cleanup();
      if (data.type === 'error') { worker.terminate(); worker = undefined; prepared = false; request.reject(Object.assign(new Error(data.error), { code: data.code })); }
      else request.resolve(data.result);
    };
    worker.onerror = event => { event.preventDefault(); terminate(new Error(event.message || 'SEPARATOR_WORKER_FAILED')); };
    return worker;
  }
  function request(type, payload, signal, transfer = []) {
    if (current) return Promise.reject(new Error('SEPARATOR_BUSY'));
    if (signal?.aborted) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      const id = ++counter, cancel = () => terminate();
      current = { id, resolve, reject, cleanup: () => signal?.removeEventListener('abort', cancel) };
      signal?.addEventListener('abort', cancel, { once: true });
      try { getWorker().postMessage({ id, type, ...payload }, transfer); }
      catch (error) { terminate(error); }
    });
  }
  async function prepare({ allowDownload = false, signal, backend = 'auto' } = {}) {
    if (prepared) { if (signal?.aborted) throw aborted(); return getSeparatorModelInfo(); }
    const result = await request('prepare', { allowDownload, backend }, signal); prepared = true; return result;
  }
  return {
    prepare(options) { if (processing) return Promise.reject(new Error('SEPARATOR_BUSY')); return prepare(options); },
    async separate({ channels, sampleRate }, { signal } = {}) {
      if (processing || current) throw new Error('SEPARATOR_BUSY');
      processing = true; const token = generation;
      try {
        const stereo = await stereo44k(channels, sampleRate, signal);
        if (token !== generation) throw aborted();
        await prepare({ signal });
        if (token !== generation) throw aborted();
        return await request('separate', { channels: stereo }, signal, stereo.map(c => c.buffer));
      } finally { processing = false; }
    },
    dispose() { terminate(); },
  };
}
