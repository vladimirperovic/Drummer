import { getAiAsset, chooseAiSession } from './ai-model-cache.js';
import { ADTOF_MODEL, ADTOF_SAMPLE_RATE, ADTOF_FPS } from './ai-transcription-model.js';

let runtime, session, model, backend = 'wasm', threads = 1, benchmark = null, downloads = false, preparing, processing = false;
// Probni ulaz za merenje GPU/CPU: deset sekundi kratkih tonova, kao isečak koji model inače dobija.
const sample = ort => ({ waveform: new ort.Tensor('float32', Float32Array.from({ length: 441000 }, (_, i) => (i % 22050 < 400 ? Math.sin(i * .3) : 0) * .5), [1, 441000]) });
async function prepare(id, allowDownload, preference = 'auto') {
  if (session) return;
  if (preparing) return preparing;
  const onProgress = progress => self.postMessage({ id, type: 'progress', progress });
  downloads ||= allowDownload;
  preparing = (async () => {
    model ||= await getAiAsset(ADTOF_MODEL, { allowDownload: downloads, onProgress });
    onProgress({ stage: 'loading', progress: 0 });
    ({ runtime, session, backend, threads, benchmark } = await chooseAiSession(model, {}, { allowDownload: downloads, onProgress, preference, sample }));
  })();
  try { await preparing; } finally { preparing = null; }
}
// GPU greška ili neispravan izlaz: isti deo se ponavlja na CPU sa svim nitima.
async function fallBackToCpu(id) {
  await Promise.resolve(session?.release?.()).catch(() => {}); runtime?.release(); session = runtime = undefined;
  await prepare(id, downloads, 'wasm');
  benchmark = { ...benchmark, chosen: 'wasm', reason: 'GPU greška tokom obrade' };
}

async function transcribe(id, audio, allowDownload, preference) {
  if (processing) throw new Error('AI obrada je već pokrenuta.');
  processing = true;
  try {
    if (!(audio instanceof Float32Array) || audio.length < 2205 || audio.length > ADTOF_SAMPLE_RATE * 600) throw new Error('Za AI izaberi snimak od 0,05 sekundi do 10 minuta.');
    if (!audio.every(Number.isFinite)) throw new Error('Audio sadrži neispravne uzorke.');
    await prepare(id, allowDownload, preference);
    const frames = Math.ceil(audio.length / 441), activations = new Float32Array(frames * 5), started = performance.now();
    // Eight-second central windows plus one second of context on each side.
    // Bidirectional GRU cannot carry a streaming state; overlap avoids hard
    // context resets at each displayed segment and bounds inference memory.
    for (let core = 0; core < frames; core += 800) {
      const end = Math.min(core + 800, frames), from = Math.max(0, core - 100), to = Math.min(frames, end + 100);
      const chunk = audio.slice(from * 441, Math.min(audio.length, to * 441));
      for (let attempt = 0; ; attempt++) {
        const input = new runtime.ort.Tensor('float32', chunk, [1, chunk.length]);
        let result;
        try {
          result = await session.run({ waveform: input }); const output = result.activations;
          if (!output || output.dims[2] !== 5 || output.dims[1] < end - from || !output.data.every(Number.isFinite)) throw new Error('Neispravan izlaz AI modela.');
          activations.set(output.data.subarray((core - from) * 5, (end - from) * 5), core * 5);
          break;
        } catch (error) {
          if (backend !== 'webgpu' || attempt) throw error;
        } finally { input.dispose(); if (result) for (const output of Object.values(result)) output.dispose(); }
        await fallBackToCpu(id);
      }
      self.postMessage({ id, type: 'progress', progress: { stage: 'transcribing', completed: end, total: frames, progress: end / frames } });
    }
    return { activations, fps: ADTOF_FPS, durationSeconds: audio.length / ADTOF_SAMPLE_RATE, backend, threads, benchmark, inferenceMs: performance.now() - started };
  } finally { processing = false; }
}

self.onmessage = async ({ data }) => {
  const { id, type, allowDownload = false, backend: preference = 'auto' } = data;
  try {
    if (type === 'prepare') { await prepare(id, allowDownload, preference); self.postMessage({ id, type: 'result', result: { backend, threads, benchmark } }); }
    else if (type === 'transcribe') {
      const result = await transcribe(id, data.audio, allowDownload, preference);
      self.postMessage({ id, type: 'result', result }, [result.activations.buffer]);
    }
  } catch (error) { self.postMessage({ id, type: 'error', error: { message: error?.message || 'AI analiza nije uspela.', code: error?.code } }); }
};
