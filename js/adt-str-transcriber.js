import { createAiWasmRuntime, getAiAsset, aiThreadCount } from './ai-model-cache.js';
import { ADT_STR_MODEL, ADT_STR_ASSETS, ADT_STR_SAMPLE_RATE, ADT_STR_CHUNK, ADT_STR_FRAMES, decodeAdtStrTokens } from './adt-str-model.js';
import { logmel, resampleAdtStr } from './adt-str-dsp.js';

const dispose = tensors => { for (const tensor of Object.values(tensors || {})) tensor?.dispose?.(); };
export async function createAdtStrTranscriber(options = {}) {
  let runtime, encoder, decoder;
  try {
    // Keep original verified int8 graphs on WASM. The exported graph's
    // DequantizeLinear -> MatMul path is not validated on ORT WebGPU.
    const encoderBytes = await getAiAsset(ADT_STR_ASSETS[0], options);
    const decoderBytes = await getAiAsset(ADT_STR_ASSETS[1], options);
    options.onProgress?.({ stage: 'loading', progress: 0 });
    runtime = await createAiWasmRuntime(options);
    encoder = await runtime.ort.InferenceSession.create(encoderBytes, { executionProviders: ['wasm'] });
    decoder = await runtime.ort.InferenceSession.create(decoderBytes, { executionProviders: ['wasm'] });
  } catch (error) {
    await Promise.resolve(encoder?.release()).catch(() => {});
    await Promise.resolve(decoder?.release()).catch(() => {});
    runtime?.release(); throw error;
  }
  const threads = aiThreadCount();
  return {
    backend: 'wasm', threads, benchmark: null,
    async release() { try { await encoder.release(); } finally { try { await decoder.release(); } finally { runtime.release(); } } },
    async transcribe(audio, { onProgress = () => {} } = {}) {
      const started = performance.now(), durationSeconds = audio.length / 44100;
      onProgress({ stage: 'transcribing', progress: 0, completed: 0, total: audio.length });
      const waveform = resampleAdtStr(audio, 44100), events = [], seen = new Set();
      let truncatedChunks = 0;
      for (let start = 0; start < waveform.length; start += ADT_STR_CHUNK) {
        const chunk = new Float32Array(ADT_STR_CHUNK);
        chunk.set(waveform.subarray(start, start + ADT_STR_CHUNK));
        const input = new runtime.ort.Tensor('float32', logmel(chunk), [1, ADT_STR_FRAMES, 128]);
        let cross;
        try {
          cross = await encoder.run({ logmel: input });
          if (!Object.keys(cross).length || !Object.values(cross).every(tensor => tensor.data.every(Number.isFinite))) throw new Error('Neispravan izlaz ADT_STR encoder-a.');
          const tokens = [2];
          // Full prefix decoding is part of this trained model's behavior. A KV
          // cache changes its additive causal mask semantics; do not substitute it.
          while (tokens.length < 512 && tokens.at(-1) !== 3) {
            const tokenInput = new runtime.ort.Tensor('int64', BigInt64Array.from(tokens, BigInt), [1, tokens.length]);
            let outputs;
            try {
              outputs = await decoder.run({ tokens: tokenInput, ...cross });
              const logits = outputs.logits?.data;
              if (!logits || logits.length !== 1400 || !logits.every(Number.isFinite)) throw new Error('Neispravan izlaz ADT_STR decoder-a.');
              let next = 0;
              for (let i = 1; i < logits.length; i++) if (logits[i] > logits[next]) next = i;
              tokens.push(next);
            } finally { tokenInput.dispose(); dispose(outputs); }
          }
          if (tokens.at(-1) !== 3) truncatedChunks++;
          for (const event of decodeAdtStrTokens(tokens, { offsetSeconds: start / ADT_STR_SAMPLE_RATE, durationSeconds })) {
            const key = `${event.timeSeconds.toFixed(6)}:${event.group}:${event.velocity}`;
            if (!seen.has(key)) { seen.add(key); events.push(event); }
          }
        } finally { input.dispose(); dispose(cross); }
        const completed = Math.min(start + ADT_STR_CHUNK, waveform.length);
        onProgress({ stage: 'transcribing', completed, total: waveform.length, progress: completed / waveform.length });
      }
      events.sort((a, b) => a.timeSeconds - b.timeSeconds || a.midi - b.midi);
      return { modelId: ADT_STR_MODEL.id, events, durationSeconds, backend: 'wasm', threads, benchmark: null,
        truncatedChunks, inferenceMs: performance.now() - started };
    },
  };
}
