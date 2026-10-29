import { getAiAsset, createAiWasmRuntime } from './ai-model-cache.js';
import { DRUM_SEPARATOR_MODEL, SEPARATOR_RATE, SEPARATOR_FRAMES, segmentStarts, transitionWindow, accumulateDrums, normalizeDrums, validateSeparatorAudio } from './drum-separator-core.js';

let session, runtime, working = false;
const progress = (id, value) => postMessage({ id, type: 'progress', progress: value });

async function prepare(id, allowDownload) {
  if (session) return;
  const onProgress = value => progress(id, value);
  runtime = await createAiWasmRuntime({ allowDownload, onProgress });
  const model = await getAiAsset(DRUM_SEPARATOR_MODEL, { allowDownload, onProgress });
  progress(id, { stage: 'loading', progress: 0 });
  // Enabling ORT's graph optimizer exhausts wasm32 memory for this graph,
  // even on a host with ample RAM. These settings were validated in Chromium.
  session = await runtime.ort.InferenceSession.create(model, {
    executionProviders: ['wasm'], graphOptimizationLevel: 'disabled', enableCpuMemArena: false, enableMemPattern: false,
  });
  if (session.inputNames.length !== 1 || session.inputNames[0] !== 'mix' || !session.outputNames.includes('stems')) throw new Error('SEPARATOR_INVALID_MODEL');
}

async function separate(id, channels) {
  validateSeparatorAudio(channels, SEPARATOR_RATE);
  const length = channels[0].length, starts = segmentStarts(length), window = transitionWindow();
  const output = [new Float32Array(length), new Float32Array(length)], weight = new Float32Array(length), chunk = new Float32Array(2 * SEPARATOR_FRAMES);
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index], end = Math.min(length, start + SEPARATOR_FRAMES);
    chunk.fill(0); for (let c = 0; c < 2; c++) chunk.set((channels[c] || channels[0]).subarray(start, end), c * SEPARATOR_FRAMES);
    progress(id, { stage: 'separating', completed: index, total: starts.length, progress: index / starts.length });
    const tensor = new runtime.ort.Tensor('float32', chunk, [1, 2, SEPARATOR_FRAMES]);
    let predictions;
    try {
      predictions = await session.run({ mix: tensor });
      const stems = predictions.stems;
      if (!stems || stems.dims.join(',') !== `1,4,2,${SEPARATOR_FRAMES}`) throw new Error('SEPARATOR_INVALID_OUTPUT');
      // Specialist outputs use [drums, bass, other, vocals]. Only row zero is
      // the trained drums result; do not mix the remaining rows back in.
      accumulateDrums(output, weight, stems.data, start, window);
    } finally { tensor.dispose(); if (predictions) for (const value of Object.values(predictions)) value.dispose(); }
    progress(id, { stage: 'separating', completed: index + 1, total: starts.length, progress: (index + 1) / starts.length });
  }
  return normalizeDrums(output, weight);
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  if (working) { postMessage({ id, type: 'error', error: 'SEPARATOR_BUSY' }); return; }
  working = true;
  try {
    if (!['prepare', 'separate'].includes(type)) throw new Error('SEPARATOR_INVALID_REQUEST');
    await prepare(id, data.allowDownload === true);
    if (type === 'prepare') postMessage({ id, type: 'result', result: { ...DRUM_SEPARATOR_MODEL } });
    else {
      const channels = await separate(id, data.channels);
      postMessage({ id, type: 'result', result: { channels, sampleRate: SEPARATOR_RATE, backend: 'wasm', model: DRUM_SEPARATOR_MODEL.id } }, channels.map(c => c.buffer));
    }
  } catch (error) {
    if (!session) { runtime?.release(); runtime = undefined; }
    const message = error?.message || 'SEPARATOR_FAILED';
    postMessage({ id, type: 'error', error: message, code: /bad_alloc|out of memory|memory access|OOM/i.test(message) ? 'SEPARATOR_MEMORY' : error?.code || (/^SEPARATOR_/.test(message) ? message : 'SEPARATOR_FAILED') });
  } finally { working = false; }
};
