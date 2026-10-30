export const SEPARATOR_RATE = 44100;
export const SEPARATOR_FRAMES = 343980;
export const SEPARATOR_OVERLAP = Math.floor(SEPARATOR_FRAMES / 4);
export const SEPARATOR_MAX_SECONDS = 600;

export const DRUM_SEPARATOR_MODEL = Object.freeze({
  id: 'htdemucs-ft-drums-fp16-55f929d3',
  name: 'HT-Demucs FT · drums',
  bytes: 165612636,
  downloadBytes: 165612636,
  sha256: '047764dff888cfb87da917013377d4ec7a134f7419cbe486d9c339aa17975ddd',
  url: 'https://huggingface.co/StemSplitio/htdemucs-ft-drums-onnx/resolve/55f929d333054c69ae0e829b15e8f8826a39d6eb/htdemucs_ft_drums_fp16weights.onnx',
  source: 'https://huggingface.co/StemSplitio/htdemucs-ft-drums-onnx',
  license: 'Unresolved: upstream research use / ONNX publisher MIT',
  sampleRate: SEPARATOR_RATE,
  segmentSeconds: SEPARATOR_FRAMES / SEPARATOR_RATE,
  maxSeconds: SEPARATOR_MAX_SECONDS,
  backend: 'wasm',
  pipeline: 'demucs',
});

export const SCNET_MODEL = Object.freeze({
  id: 'scnet-large-int8',
  name: 'SCNet-large · drums',
  bytes: 45082486,
  downloadBytes: 45082486,
  sha256: 'b2dc586a1e0e6c0afe4915e9057ea29111397b7bbf589edc3d85de91de79cd72',
  url: 'https://huggingface.co/audiojs/scnet-large/resolve/95f22d9e68f6cab78aef358f1a0de248d4edf805/scnet-large.int8.onnx',
  source: 'https://huggingface.co/audiojs/scnet-large',
  sourceUrl: 'https://huggingface.co/audiojs/scnet-large',
  license: 'MIT',
  sampleRate: SEPARATOR_RATE,
  segmentSeconds: 11,
  maxSeconds: SEPARATOR_MAX_SECONDS,
  backend: 'wasm',
  pipeline: 'scnet',
});

export const SCNET_SMALL_MODEL = Object.freeze({
  ...SCNET_MODEL,
  id: 'scnet-int8',
  name: 'SCNet · drums (small)',
  bytes: 12900277,
  downloadBytes: 12900277,
  sha256: '98228931494151762a1c4ab1ec7899a894b1f81fd4a509921a9d2f9bacc50845',
  url: 'https://huggingface.co/audiojs/scnet/resolve/e71bcdb42bce1d62b7fae25ba90fcbcf90f73f46/scnet.int8.onnx',
  source: 'https://huggingface.co/audiojs/scnet',
  sourceUrl: 'https://huggingface.co/audiojs/scnet',
});

export const SEPARATOR_MODELS = Object.freeze([DRUM_SEPARATOR_MODEL, SCNET_MODEL, SCNET_SMALL_MODEL]);
export function separatorModel(modelId = DRUM_SEPARATOR_MODEL.id) {
  const model = SEPARATOR_MODELS.find(candidate => candidate.id === modelId);
  if (!model) throw new Error('SEPARATOR_INVALID_MODEL');
  return model;
}

export function validateSeparatorAudio(channels, sampleRate) {
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2 || !channels.every(c => c instanceof Float32Array) || !channels[0].length || channels.some(c => c.length !== channels[0].length)) throw new Error('SEPARATOR_INVALID_AUDIO');
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('SEPARATOR_INVALID_RATE');
  if (channels[0].length / sampleRate > SEPARATOR_MAX_SECONDS) throw new Error('SEPARATOR_TOO_LONG');
  for (const channel of channels) for (const sample of channel) if (!Number.isFinite(sample)) throw new Error('SEPARATOR_INVALID_AUDIO');
}

export function segmentStarts(length, segment = SEPARATOR_FRAMES, overlap = SEPARATOR_OVERLAP) {
  if (!Number.isInteger(length) || length < 1 || !Number.isInteger(segment) || segment < 1 || !Number.isInteger(overlap) || overlap < 0 || overlap >= segment) throw new Error('SEPARATOR_INVALID_SEGMENTS');
  const stride = segment - overlap;
  return Array.from({ length: Math.max(1, Math.ceil((length - segment) / stride) + 1) }, (_, i) => i * stride);
}

// Positive edge weights preserve the first and last samples. Normalizing the
// accumulated weights also handles a short padded final segment without fades.
export function transitionWindow(segment = SEPARATOR_FRAMES, overlap = SEPARATOR_OVERLAP) {
  const window = new Float32Array(segment).fill(1);
  for (let i = 0; i < overlap; i++) window[i] = window[segment - 1 - i] = (i + 1) / (overlap + 1);
  return window;
}

export function accumulateDrums(output, weight, prediction, start, window) {
  const segment = window.length, length = Math.min(segment, weight.length - start);
  if (prediction.length < segment * 2) throw new Error('SEPARATOR_INVALID_OUTPUT');
  for (let i = 0; i < length; i++) {
    const left = prediction[i], right = prediction[segment + i];
    if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error('SEPARATOR_INVALID_OUTPUT');
    const w = window[i]; output[0][start + i] += left * w; output[1][start + i] += right * w; weight[start + i] += w;
  }
}

export function normalizeDrums(output, weight) {
  for (let i = 0; i < weight.length; i++) {
    if (!(weight[i] > 0)) throw new Error('SEPARATOR_INVALID_OUTPUT');
    output[0][i] /= weight[i]; output[1][i] /= weight[i];
  }
  return output;
}
