import { getAiAsset, chooseAiSession } from './ai-model-cache.js';
import { DRUM_SEPARATOR_MODEL, SEPARATOR_RATE, SEPARATOR_FRAMES, segmentStarts, transitionWindow, accumulateDrums, normalizeDrums, validateSeparatorAudio, separatorModel } from './drum-separator-core.js';
import { SCNET_BINS, SCNET_FRAMES, SCNET_SAMPLES, scnetNormalization, scnetPlan, scnetSegment, scnetSpectrogram, scnetDrums, accumulateScnet } from './scnet-dsp.js';

let session, runtime, model, backend = 'wasm', threads = 1, benchmark = null, downloads = false, working = false;
let descriptor = DRUM_SEPARATOR_MODEL;
const progress = (id, value) => postMessage({ id, type: 'progress', progress: value });
// Enabling ORT's graph optimizer exhausts wasm32 memory for this graph,
// even on a host with ample RAM. These settings were validated in Chromium.
const SESSION = { graphOptimizationLevel: 'disabled', enableCpuMemArena: false, enableMemPattern: false };

// Probni ulaz za merenje GPU/CPU: tihi šum (nule bi dale deljenje nulom u normalizaciji modela).
const sample = ort => {
  if (descriptor.pipeline === 'scnet') {
    const audio = Float32Array.from({ length: SCNET_SAMPLES }, (_, i) => Math.sin(i * .03) * .1);
    return { mix_spec: new ort.Tensor('float32', scnetSpectrogram([audio, audio]), [1, 4, SCNET_BINS, SCNET_FRAMES]) };
  }
  return { mix: new ort.Tensor('float32', Float32Array.from({ length: 2 * SEPARATOR_FRAMES }, (_, i) => Math.sin(i * 12.9898) * .01), [1, 2, SEPARATOR_FRAMES]) };
};

async function prepare(id, allowDownload, preference = 'auto') {
  if (session) return;
  const onProgress = value => progress(id, value);
  downloads ||= allowDownload;
  model ||= await getAiAsset(descriptor, { allowDownload: downloads, onProgress });
  progress(id, { stage: 'loading', progress: 0 });
  const options = descriptor.pipeline === 'scnet' ? { ...SESSION, graphOptimizationLevel: 'all' } : SESSION;
  ({ runtime, session, backend, threads, benchmark } = await chooseAiSession(model, options, { allowDownload: downloads, onProgress, preference, sample }));
  const names = descriptor.pipeline === 'scnet' ? ['mix_spec', 'stems_spec'] : ['mix', 'stems'];
  if (session.inputNames.length !== 1 || session.inputNames[0] !== names[0] || !session.outputNames.includes(names[1])) throw new Error('SEPARATOR_INVALID_MODEL');
}
// GPU greška ili neispravan izlaz usred obrade: isti deo se ponavlja na CPU sa svim nitima.
async function fallBackToCpu(id) {
  await Promise.resolve(session?.release?.()).catch(() => {}); runtime?.release(); session = runtime = undefined;
  await prepare(id, downloads, 'wasm');
  benchmark = { ...benchmark, chosen: 'wasm', reason: 'GPU greška tokom obrade' };
}

async function separate(id, channels) {
  validateSeparatorAudio(channels, SEPARATOR_RATE);
  const length = channels[0].length, starts = segmentStarts(length), window = transitionWindow();
  const output = [new Float32Array(length), new Float32Array(length)], weight = new Float32Array(length), chunk = new Float32Array(2 * SEPARATOR_FRAMES);
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index], end = Math.min(length, start + SEPARATOR_FRAMES);
    chunk.fill(0); for (let c = 0; c < 2; c++) chunk.set((channels[c] || channels[0]).subarray(start, end), c * SEPARATOR_FRAMES);
    progress(id, { stage: 'separating', completed: index, total: starts.length, progress: index / starts.length });
    for (let attempt = 0; ; attempt++) {
      const tensor = new runtime.ort.Tensor('float32', chunk, [1, 2, SEPARATOR_FRAMES]);
      let predictions;
      try {
        predictions = await session.run({ mix: tensor });
        const stems = predictions.stems;
        if (!stems || stems.dims.join(',') !== `1,4,2,${SEPARATOR_FRAMES}`) throw new Error('SEPARATOR_INVALID_OUTPUT');
        if (backend === 'webgpu' && !stems.data.every(Number.isFinite)) throw new Error('SEPARATOR_INVALID_OUTPUT');
        // Specialist outputs use [drums, bass, other, vocals]. Only row zero is
        // the trained drums result; do not mix the remaining rows back in.
        accumulateDrums(output, weight, stems.data, start, window);
        break;
      } catch (error) {
        if (backend !== 'webgpu' || attempt) throw error;
      } finally { tensor.dispose(); if (predictions) for (const value of Object.values(predictions)) value.dispose(); }
      await fallBackToCpu(id);
    }
    progress(id, { stage: 'separating', completed: index + 1, total: starts.length, progress: (index + 1) / starts.length });
  }
  return normalizeDrums(output, weight);
}

async function separateScnet(id, channels) {
  validateSeparatorAudio(channels, SEPARATOR_RATE);
  const length = channels[0].length, plan = scnetPlan(length), normalization = scnetNormalization(channels);
  const output = [new Float32Array(length), new Float32Array(length)], weight = new Float32Array(length);
  for (let index = 0; index < plan.starts.length; index++) {
    progress(id, { stage: 'separating', completed: index, total: plan.starts.length, progress: index / plan.starts.length });
    const data = scnetSpectrogram(scnetSegment(channels, plan, plan.starts[index], normalization));
    for (let attempt = 0; ; attempt++) {
      const tensor = new runtime.ort.Tensor('float32', data, [1, 4, SCNET_BINS, SCNET_FRAMES]);
      let predictions;
      try {
        predictions = await session.run({ mix_spec: tensor });
        const stems = predictions.stems_spec;
        if (!stems || stems.dims.join(',') !== `1,16,${SCNET_BINS},${SCNET_FRAMES}` || !stems.data.every(Number.isFinite)) throw new Error('SEPARATOR_INVALID_OUTPUT');
        accumulateScnet(output, weight, scnetDrums(stems.data), plan, index);
        break;
      } catch (error) {
        if (backend !== 'webgpu' || attempt) throw error;
      } finally { tensor.dispose(); if (predictions) for (const value of Object.values(predictions)) value.dispose(); }
      await fallBackToCpu(id);
    }
    progress(id, { stage: 'separating', completed: index + 1, total: plan.starts.length, progress: (index + 1) / plan.starts.length });
  }
  normalizeDrums(output, weight);
  // Mixture DC stays in the residual; adding the mean to every stem would repeat it.
  for (const channel of output) for (let i = 0; i < channel.length; i++) channel[i] *= normalization.scale;
  return output;
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  if (working) { postMessage({ id, type: 'error', error: 'SEPARATOR_BUSY' }); return; }
  working = true;
  try {
    if (!['prepare', 'separate'].includes(type)) throw new Error('SEPARATOR_INVALID_REQUEST');
    const selected = separatorModel(data.modelId);
    if (selected.id !== descriptor.id) {
      await Promise.resolve(session?.release?.()).catch(() => {}); runtime?.release();
      session = runtime = model = undefined; downloads = false; descriptor = selected;
    }
    await prepare(id, data.allowDownload === true, data.backend || 'auto');
    if (type === 'prepare') postMessage({ id, type: 'result', result: { ...descriptor, backend, threads, benchmark } });
    else {
      const started = performance.now(), channels = await (descriptor.pipeline === 'scnet' ? separateScnet(id, data.channels) : separate(id, data.channels));
      postMessage({ id, type: 'result', result: { channels, sampleRate: SEPARATOR_RATE, backend, threads, benchmark, inferenceMs: performance.now() - started, model: descriptor.id } }, channels.map(c => c.buffer));
    }
  } catch (error) {
    if (!session) { runtime?.release(); runtime = undefined; }
    const message = error?.message || 'SEPARATOR_FAILED';
    postMessage({ id, type: 'error', error: message, code: /bad_alloc|out of memory|memory access|OOM/i.test(message) ? 'SEPARATOR_MEMORY' : error?.code || (/^SEPARATOR_/.test(message) ? message : 'SEPARATOR_FAILED') });
  } finally { working = false; }
};
