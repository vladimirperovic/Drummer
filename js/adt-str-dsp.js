// Adapted from Coming Undone browser/src/drums.js at 46d9aacc81371a0dd098f5dfb3435379c4de9158.
// Copyright (c) 2026 Bengisu Ozaydin (MIT); the ADT_STR preprocessing port derives
// from ADT_STR (Melucci, Merialdo, Akama), CC BY-SA 4.0. This module is distributed
// under CC BY-SA 4.0; see vendor/ADT-STR-NOTICE.txt for both source notices.
// Changes: retain DSP only; inference, validation, lifetime and decoding are separate.
export const SR = 24000;
export const CHUNK = 61440;        // 2.56 s
const N_FFT = 2048;
const HOP = 240;                   // 10 ms
const N_MELS = 128;
const F_MIN = 20;
const PAD_IDX = Math.floor(N_FFT / 2 / HOP) + 1;
export const FRAMES = 1 + CHUNK / HOP - PAD_IDX - (PAD_IDX + 1);   // 246


// torchaudio.functional.melscale_fbanks, htk scale, norm=None. [mel][bin].
export function melFilterbank(sr = SR, nFft = N_FFT, nMels = N_MELS, fMin = F_MIN, fMax = sr / 2) {
  const nFreqs = nFft / 2 + 1;
  const hz2mel = (f) => 2595 * Math.log10(1 + f / 700);
  const mel2hz = (m) => 700 * (10 ** (m / 2595) - 1);
  const allFreqs = Float64Array.from({ length: nFreqs }, (_, i) => (i * Math.floor(sr / 2)) / (nFreqs - 1));
  const mMin = hz2mel(fMin), mMax = hz2mel(fMax);
  const fPts = Float64Array.from({ length: nMels + 2 }, (_, i) => mel2hz(mMin + ((mMax - mMin) * i) / (nMels + 1)));
  const fb = [];
  for (let m = 0; m < nMels; m++) {
    const row = new Float32Array(nFreqs);
    const dl = fPts[m + 1] - fPts[m], du = fPts[m + 2] - fPts[m + 1];
    for (let k = 0; k < nFreqs; k++) {
      row[k] = Math.max(0, Math.min(-(fPts[m] - allFreqs[k]) / dl, (fPts[m + 2] - allFreqs[k]) / du));
    }
    fb.push(row);
  }
  return fb;
}

// In-place radix-2 complex FFT.
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

let FB = null, WIN = null;

// ComputeMelSpectrogram.forward for one 61440-sample chunk -> Float32Array(246 * 128).
export function logmel(chunk) {
  if (!(chunk instanceof Float32Array) || chunk.length !== CHUNK || !chunk.every(Number.isFinite)) throw new Error('ADT_STR_INVALID_AUDIO');
  FB ||= melFilterbank();
  WIN ||= Float64Array.from({ length: N_FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT));
  const pad = N_FFT / 2, n = chunk.length;
  const at = (i) => chunk[i < 0 ? -i : i >= n ? 2 * (n - 1) - i : i];
  const out = new Float32Array(FRAMES * N_MELS);
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT), pow = new Float64Array(N_FFT / 2 + 1);
  for (let f = 0; f < FRAMES; f++) {
    const start = (f + PAD_IDX) * HOP - pad;
    for (let i = 0; i < N_FFT; i++) { re[i] = at(start + i) * WIN[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= N_FFT / 2; k++) pow[k] = re[k] * re[k] + im[k] * im[k];
    for (let m = 0; m < N_MELS; m++) {
      const row = FB[m];
      let s = 0;
      for (let k = 0; k < pow.length; k++) if (row[k]) s += row[k] * pow[k];
      const v = Math.min(12, Math.max(-23, Math.log(s + 1e-10)));
      out[f * N_MELS + m] = (v + 23) / 35;
    }
  }
  return out;
}

// torchaudio's default sinc_interp_hann resampler (lowpass width 6, rolloff .99).
// Read bounded source samples directly: a ten-minute file needs no padded copy.
// Removing the effectively-zero wings keeps the same filter while avoiding most
// multiplies for 44.1 -> 24 kHz. Offsets remain relative to the original recording.
export function resampleAdtStr(input, sampleRate = 44100) {
  if (!(input instanceof Float32Array) || !input.every(Number.isFinite)
    || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('ADT_STR_INVALID_AUDIO');
  if (sampleRate === SR) return input;
  const gcd = (a, b) => b ? gcd(b, a % b) : a, divisor = gcd(sampleRate, SR);
  const original = sampleRate / divisor, target = SR / divisor, cutoff = Math.min(original, target) * .99;
  const width = Math.ceil(6 * original / cutoff), kernels = [];
  for (let phase = 0; phase < target; phase++) {
    const taps = [];
    for (let j = -width; j < width + original; j++) {
      const time = Math.max(-6, Math.min(6, (j / original - phase / target) * cutoff));
      const angle = Math.PI * time;
      const weight = Math.fround((angle ? Math.sin(angle) / angle : 1) * Math.cos(angle / 12) ** 2 * cutoff / original);
      if (Math.abs(weight) > 1e-15) taps.push([j, weight]);
    }
    kernels.push(taps);
  }
  const output = new Float32Array(Math.ceil(input.length * target / original));
  for (let i = 0; i < output.length; i++) {
    const origin = Math.floor(i / target) * original;
    let sum = 0;
    for (const [offset, weight] of kernels[i % target]) {
      const position = origin + offset;
      if (position >= 0 && position < input.length) sum += input[position] * weight;
    }
    output[i] = sum;
  }
  return output;
}


