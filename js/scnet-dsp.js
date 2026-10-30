// SCNet-large's documented complex-spectrogram contract, with normalization and
// segment fades following audiojs/neural's MIT pipeline. See vendor/SCNET-LICENSE.txt
// and vendor/AUDIOJS-NEURAL-LICENSE.txt. FFT/STFT implementation is local: no CDN code.
// https://huggingface.co/audiojs/scnet-large
// https://github.com/audiojs/neural/blob/main/packages/neural-separate/separate.js
export const SCNET_FFT = 4096, SCNET_HOP = 1024, SCNET_BINS = 2049, SCNET_FRAMES = 476;
export const SCNET_SAMPLES = 485100, SCNET_STRIDE = 121275, SCNET_FADE = 48510;
const PADDED_SAMPLES = (SCNET_FRAMES - 1) * SCNET_HOP;
const PLANE = SCNET_BINS * SCNET_FRAMES;
const reverse = new Uint16Array(SCNET_FFT), cosine = new Float64Array(SCNET_FFT / 2), sine = new Float64Array(SCNET_FFT / 2);
for (let i = 0; i < SCNET_FFT; i++) {
  let bits = i, value = 0;
  for (let bit = 0; bit < 12; bit++) { value = (value << 1) | (bits & 1); bits >>>= 1; }
  reverse[i] = value;
}
for (let i = 0; i < cosine.length; i++) { cosine[i] = Math.cos(2 * Math.PI * i / SCNET_FFT); sine[i] = Math.sin(2 * Math.PI * i / SCNET_FFT); }

function fft(real, imaginary, inverse = false) {
  for (let i = 0; i < SCNET_FFT; i++) {
    const j = reverse[i];
    if (j > i) { const r = real[i], im = imaginary[i]; real[i] = real[j]; imaginary[i] = imaginary[j]; real[j] = r; imaginary[j] = im; }
  }
  for (let size = 2; size <= SCNET_FFT; size *= 2) {
    const half = size / 2, step = SCNET_FFT / size;
    for (let start = 0; start < SCNET_FFT; start += size) for (let i = 0; i < half; i++) {
      const a = start + i, b = a + half, wr = cosine[i * step], wi = sine[i * step] * (inverse ? 1 : -1);
      const r = wr * real[b] - wi * imaginary[b], im = wr * imaginary[b] + wi * real[b];
      real[b] = real[a] - r; imaginary[b] = imaginary[a] - im; real[a] += r; imaginary[a] += im;
    }
  }
  if (inverse) for (let i = 0; i < SCNET_FFT; i++) { real[i] /= SCNET_FFT; imaginary[i] /= SCNET_FFT; }
}

export function scnetReflect(index, length) {
  if (length < 2) return 0;
  const period = 2 * (length - 1), folded = ((index % period) + period) % period;
  return folded < length ? folded : period - folded;
}

// Compute the same whole-song, mono-mean sample standard deviation as the source
// pipeline, without retaining a second full copy of the song in the worker.
export function scnetNormalization(channels) {
  const length = channels[0].length, right = channels[1] || channels[0];
  let mean = 0, squared = 0;
  for (let i = 0; i < length; i++) mean += (channels[0][i] + right[i]) / 2;
  mean /= length;
  for (let i = 0; i < length; i++) squared += ((channels[0][i] + right[i]) / 2 - mean) ** 2;
  return { mean, scale: Math.sqrt(squared / Math.max(1, length - 1)) + 1e-8 };
}

export function scnetPlan(length) {
  if (!Number.isSafeInteger(length) || length < 1) throw new Error('SEPARATOR_INVALID_AUDIO');
  const border = length > 2 * (SCNET_SAMPLES - SCNET_STRIDE) ? SCNET_SAMPLES - SCNET_STRIDE : 0;
  const paddedLength = length + 2 * border, count = Math.max(1, Math.ceil((paddedLength - SCNET_SAMPLES) / SCNET_STRIDE) + 1);
  return { length, border, paddedLength, starts: Array.from({ length: count }, (_, i) => i * SCNET_STRIDE) };
}

export function scnetSegment(channels, plan, start, normalization) {
  const available = Math.min(SCNET_SAMPLES, plan.paddedLength - start);
  return [0, 1].map(channel => {
    const source = channels[channel] || channels[0], segment = new Float32Array(SCNET_SAMPLES);
    for (let i = 0; i < SCNET_SAMPLES; i++) {
      if (i >= available && available <= SCNET_SAMPLES / 2) break;
      const position = start + (i < available ? i : scnetReflect(i, available)) - plan.border;
      const value = source[scnetReflect(position, source.length)];
      segment[i] = (value - normalization.mean) / normalization.scale;
    }
    return segment;
  });
}

// torch.stft: rectangular window, centered reflect padding, normalized=True.
// The 11-second segment is first zero-padded to 486400 samples (476 STFT frames).
export function scnetSpectrogram(channels) {
  if (channels.length !== 2 || channels.some(channel => !(channel instanceof Float32Array) || channel.length !== SCNET_SAMPLES)) throw new Error('SEPARATOR_INVALID_AUDIO');
  const data = new Float32Array(4 * PLANE), real = new Float64Array(SCNET_FFT), imaginary = new Float64Array(SCNET_FFT);
  for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < SCNET_FRAMES; frame++) {
    const start = frame * SCNET_HOP - SCNET_FFT / 2;
    imaginary.fill(0);
    for (let i = 0; i < SCNET_FFT; i++) {
      const position = scnetReflect(start + i, PADDED_SAMPLES);
      real[i] = position < SCNET_SAMPLES ? channels[channel][position] : 0;
    }
    fft(real, imaginary);
    for (let bin = 0; bin < SCNET_BINS; bin++) {
      const index = channel * 2 * PLANE + bin * SCNET_FRAMES + frame;
      data[index] = real[bin] / 64; data[index + PLANE] = imaginary[bin] / 64;
    }
  }
  return data;
}

// Recover only the first source (drums), [L real,L imaginary,R real,R imaginary].
// Other sources are deliberately never added to the result.
export function scnetDrums(spectrogram) {
  if (!(spectrogram instanceof Float32Array) || spectrogram.length < 4 * PLANE) throw new Error('SEPARATOR_INVALID_OUTPUT');
  const length = PADDED_SAMPLES + SCNET_FFT, weight = new Uint8Array(length);
  for (let frame = 0; frame < SCNET_FRAMES; frame++) for (let i = 0; i < SCNET_FFT; i++) weight[frame * SCNET_HOP + i]++;
  return [0, 1].map(channel => {
    const sum = new Float64Array(length), real = new Float64Array(SCNET_FFT), imaginary = new Float64Array(SCNET_FFT);
    for (let frame = 0; frame < SCNET_FRAMES; frame++) {
      for (let bin = 0; bin < SCNET_BINS; bin++) {
        const index = channel * 2 * PLANE + bin * SCNET_FRAMES + frame;
        const r = spectrogram[index] * 64, im = spectrogram[index + PLANE] * 64;
        if (!Number.isFinite(r) || !Number.isFinite(im)) throw new Error('SEPARATOR_INVALID_OUTPUT');
        real[bin] = r; imaginary[bin] = im;
        if (bin > 0 && bin < SCNET_FFT / 2) { real[SCNET_FFT - bin] = r; imaginary[SCNET_FFT - bin] = -im; }
      }
      fft(real, imaginary, true);
      for (let i = 0; i < SCNET_FFT; i++) sum[frame * SCNET_HOP + i] += real[i];
    }
    return Float32Array.from({ length: SCNET_SAMPLES }, (_, i) => sum[i + SCNET_FFT / 2] / weight[i + SCNET_FFT / 2]);
  });
}

export function accumulateScnet(output, weight, drums, plan, segmentIndex) {
  const start = plan.starts[segmentIndex], available = Math.min(SCNET_SAMPLES, plan.paddedLength - start);
  for (let i = Math.max(0, plan.border - start); i < available && start + i - plan.border < plan.length; i++) {
    let fade = 1;
    if (segmentIndex > 0 && i < SCNET_FADE) fade = i / (SCNET_FADE - 1);
    if (segmentIndex < plan.starts.length - 1 && i >= SCNET_SAMPLES - SCNET_FADE) fade = Math.min(fade, (SCNET_SAMPLES - 1 - i) / (SCNET_FADE - 1));
    const position = start + i - plan.border;
    weight[position] += fade;
    output[0][position] += drums[0][i] * fade; output[1][position] += drums[1][i] * fade;
  }
}
