// Zvuk: metronom, sintetizovani bubanj i kitovi od snimljenih WAV semplova (kits/<id>/kit.json).
//
// kit.json: { "name": "...", "license": "...", "instruments": { "snare": [ { "file": "sn_v1.wav", "lo": 1, "hi": 60 }, ... ] } }
// Više fajlova u istom rasponu jačine se smjenjuju (round robin).

const CHOKE = { hho: 'hihat' };

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.kit = null;
    this.vol = { click: 0.7, pattern: 0.6, live: 0.9 };
    this.voices = [];
    this.offset = null;
  }

  async ensure() {
    if (!this.ctx) {
      const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.ratio.value = 8;
      limiter.connect(ctx.destination);
      this.buses = {};
      for (const name of Object.keys(this.vol)) {
        const g = ctx.createGain();
        g.gain.value = this.vol[name];
        g.connect(limiter);
        this.buses[name] = g;
      }
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  get ready() { return this.ctx?.state === 'running'; }
  get time() { return this.ctx.currentTime; }
  latencyMs() { return this.ctx ? ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000 : 0; }

  setVolume(bus, v) {
    this.vol[bus] = v;
    if (this.buses) this.buses[bus].gain.value = v;
  }

  // Vrijeme zvuka (AudioContext) -> trenutak kad se čuje (performance.now)
  ctxToPerf(t) {
    const ts = this.ctx.getOutputTimestamp?.();
    let raw;
    if (ts && ts.performanceTime > 0) raw = ts.performanceTime - ts.contextTime * 1000;
    else raw = performance.now() - this.ctx.currentTime * 1000 + (this.ctx.outputLatency || 0) * 1000;
    this.offset = this.offset == null || Math.abs(raw - this.offset) > 50 ? raw : this.offset * 0.95 + raw * 0.05;
    return t * 1000 + this.offset;
  }

  click(t, accent, level = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = accent ? 1760 : 1180;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((accent ? 0.9 : 0.6) * level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(this.buses.click);
    o.start(t);
    o.stop(t + 0.06);
  }

  play(instId, t, v, bus = 'pattern') {
    if (!this.ready) return;
    t = Math.max(t, this.ctx.currentTime);
    if (instId === 'hh' || instId === 'hhp') this.choke('hho', t);
    const out = this.ctx.createGain();
    out.connect(this.buses[bus]);
    const sample = this.kit && this.pickSample(instId, v);
    const end = sample ? this.playSample(sample, t, v, out) : SYNTH[instId]?.(this, t, v, out) ?? t;
    this.voices.push({ instId, out, end });
    this.voices = this.voices.filter(x => x.end > this.ctx.currentTime);
  }

  playNow(instId, v) { if (this.ready) this.play(instId, this.ctx.currentTime, v, 'live'); }

  // Gušenje: zatvoren hi-hat gasi otvoreni, a hvatanje činele (aftertouch) gasi tu činelu
  choke(instId, t = this.ctx?.currentTime) {
    if (!this.ctx) return;
    const group = CHOKE[instId] || instId;
    for (const v of this.voices) {
      if ((CHOKE[v.instId] || v.instId) !== group || v.end <= t) continue;
      v.out.gain.setTargetAtTime(0, t, 0.015);
      v.end = t + 0.1;
    }
  }

  async loadKit(url) {
    await this.ensure();
    const def = await (await fetch(`${url}/kit.json`)).json();
    const layers = {};
    await Promise.all(Object.entries(def.instruments).flatMap(([inst, list]) => list.map(async s => {
      const buf = await this.ctx.decodeAudioData(await (await fetch(`${url}/${s.file}`)).arrayBuffer());
      (layers[inst] ||= []).push({ buf, lo: s.lo ?? 1, hi: s.hi ?? 127, gain: s.gain ?? 1 });
    })));
    this.kit = { def, layers, rr: {} };
    return def;
  }

  useSynth() { this.kit = null; }

  pickSample(instId, v) {
    const list = this.kit.layers[instId];
    if (!list) return null;
    const vel = Math.max(1, Math.round(v * 127));
    const fits = list.filter(s => vel >= s.lo && vel <= s.hi);
    const pool = fits.length ? fits : list;
    const i = (this.kit.rr[instId] = ((this.kit.rr[instId] ?? -1) + 1) % pool.length);
    return pool[i];
  }

  playSample(s, t, v, out) {
    const src = this.ctx.createBufferSource();
    src.buffer = s.buf;
    const g = this.ctx.createGain();
    g.gain.value = s.gain * (0.35 + 0.65 * v);
    src.connect(g).connect(out);
    src.start(t);
    return t + s.buf.duration;
  }
}

// ---- Sintetizovani bubanj ----

function env(ctx, t, peak, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  return g;
}

function noise(a, t, dur, filters, peak, decay, out) {
  const ctx = a.ctx;
  const src = ctx.createBufferSource();
  src.buffer = a.noise;
  let node = src;
  for (const [type, freq, q = 0.7] of filters) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    node.connect(f);
    node = f;
  }
  node.connect(env(ctx, t, peak, decay)).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur);
}

function tone(a, t, type, f0, f1, sweep, peak, decay, out) {
  const ctx = a.ctx;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
  o.connect(env(ctx, t, peak, decay)).connect(out);
  o.start(t);
  o.stop(t + decay + 0.02);
}

function metal(a, t, peak, decay, hp, out) {
  const ctx = a.ctx;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = env(ctx, t, peak, decay);
  f.connect(g).connect(out);
  for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 40 * r * 1.7;
    o.connect(f);
    o.start(t);
    o.stop(t + decay + 0.02);
  }
}

const tom = f => (a, t, v, out) => {
  tone(a, t, 'sine', f * 1.6, f, 0.08, 0.9 * v, 0.45, out);
  noise(a, t, 0.05, [['lowpass', 3000]], 0.12 * v, 0.04, out);
  return t + 0.5;
};

const SYNTH = {
  kick: (a, t, v, out) => {
    tone(a, t, 'sine', 160, 42, 0.12, 1.0 * v, 0.38, out);
    noise(a, t, 0.02, [['highpass', 1500]], 0.25 * v, 0.012, out);
    return t + 0.4;
  },
  snare: (a, t, v, out) => {
    tone(a, t, 'triangle', 240, 175, 0.04, 0.5 * v, 0.1, out);
    noise(a, t, 0.25, [['highpass', 1300], ['lowpass', 9000]], 0.75 * v, 0.2, out);
    return t + 0.25;
  },
  xstick: (a, t, v, out) => {
    noise(a, t, 0.06, [['bandpass', 1900, 6]], 1.4 * v, 0.05, out);
    tone(a, t, 'sine', 820, null, 0, 0.3 * v, 0.03, out);
    return t + 0.06;
  },
  hh: (a, t, v, out) => { noise(a, t, 0.08, [['highpass', 7500], ['bandpass', 10000, 0.8]], 0.55 * v, 0.055, out); return t + 0.08; },
  hho: (a, t, v, out) => {
    noise(a, t, 0.6, [['highpass', 7000], ['bandpass', 9500, 0.6]], 0.5 * v, 0.5, out);
    metal(a, t, 0.08 * v, 0.45, 7000, out);
    return t + 0.6;
  },
  hhp: (a, t, v, out) => { noise(a, t, 0.05, [['highpass', 5500]], 0.35 * v, 0.04, out); return t + 0.05; },
  ride: (a, t, v, out) => {
    metal(a, t, 0.1 * v, 1.1, 5000, out);
    noise(a, t, 1, [['highpass', 6000]], 0.12 * v, 0.9, out);
    tone(a, t, 'sine', 3300, null, 0, 0.06 * v, 0.5, out);
    return t + 1.1;
  },
  bell: (a, t, v, out) => {
    for (const [f, p] of [[1180, 0.25], [1770, 0.15], [2600, 0.1]]) tone(a, t, 'sine', f, null, 0, p * v, 1.0, out);
    metal(a, t, 0.05 * v, 0.6, 4000, out);
    return t + 1.0;
  },
  crash: (a, t, v, out) => {
    noise(a, t, 2, [['highpass', 3800]], 0.65 * v, 1.7, out);
    metal(a, t, 0.08 * v, 1.2, 4500, out);
    return t + 2;
  },
  tom1: tom(210),
  tom2: tom(165),
  tom3: tom(110),
};
