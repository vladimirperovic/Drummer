import { bounded } from './practice.js';
import { beatMs } from './patterns.js';
import { t } from './i18n.js';

export class BackingTrack {
  constructor(audio) {
    this.audio = audio; this.buffer = null; this.name = ''; this.enabled = false;
    this.bpm = 90; this.offset = 0; this.volume = .6; this.sources = new Set(); this.loadId = 0; this.loading = false;
  }

  async load(file) {
    const id = ++this.loadId;
    this.loading = true;
    try {
      await this.audio.ensure();
      const buffer = await this.audio.ctx.decodeAudioData(await file.arrayBuffer());
      if (id !== this.loadId) return false;
      this.stop(); this.buffer = buffer; this.name = file.name; this.offset = 0; this.enabled = true;
      return true;
    } finally { if (id === this.loadId) this.loading = false; }
  }

  clear() { this.loadId++; this.loading = false; this.stop(); this.buffer = null; this.name = ''; this.enabled = false; }
  segment(pattern, range) {
    const beatSeconds = beatMs({ ...pattern, bpm: this.bpm }) / 1000;
    return { offset: this.offset + (range.from - 1) * pattern.beats * beatSeconds,
      duration: (range.to - range.from + 1) * pattern.beats * beatSeconds, rate: pattern.bpm / this.bpm };
  }

  validate(pattern, range) {
    if (this.loading) throw new Error('Sačekaj da se pesma učita.');
    if (!this.enabled) return;
    if (!this.buffer) throw new Error('Izaberi audio fajl za pesmu.');
    const segment = this.segment(pattern, range);
    if (segment.offset < 0 || segment.offset + segment.duration > this.buffer.duration + .01)
      throw new Error('Odabrani taktovi izlaze iz pesme. Pomeri prvi takt ili skrati A–B deo.');
  }

  schedule(t, pattern, range) {
    if (!this.enabled || !this.buffer) return;
    const { offset, duration, rate } = this.segment(pattern, range);
    const ctx = this.audio.ctx, source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = this.buffer; source.playbackRate.value = rate; gain.gain.value = this.volume;
    source.mixGain = gain;
    source.connect(gain).connect(ctx.destination);
    source.onended = () => { this.sources.delete(source); source.disconnect(); gain.disconnect(); };
    this.sources.add(source); source.start(t, offset, duration);
  }

  scheduleSong(t, rate = 1) {
    if (!this.enabled || !this.buffer) return;
    const ctx=this.audio.ctx,source=ctx.createBufferSource(),gain=ctx.createGain();
    source.buffer=this.buffer;source.playbackRate.value=rate;gain.gain.value=this.volume;source.mixGain=gain;
    source.connect(gain).connect(ctx.destination);
    source.onended=()=>{this.sources.delete(source);source.disconnect();gain.disconnect();};
    this.sources.add(source);source.start(t,this.offset);
  }

  stop() { for (const source of this.sources) { try { source.stop(); } catch {} } this.sources.clear(); }
  setVolume(value) {
    this.volume = bounded(value, 0, 1, .6);
    for (const source of this.sources) source.mixGain.gain.setTargetAtTime(this.volume, this.audio.time, .01);
  }

  draw(canvas, pattern, range) {
    const ctx = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
    ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#f6f6f4'; ctx.fillRect(0, 0, width, height);
    if (!this.buffer) { ctx.fillStyle = '#666'; ctx.font = '16px system-ui'; ctx.fillText(t('Izaberi audio fajl'), 16, height / 2); return; }
    const samples = this.buffer.getChannelData(0), stride = samples.length / width;
    ctx.strokeStyle = '#333'; ctx.beginPath();
    for (let x = 0; x < width; x++) {
      let min = 0, max = 0;
      // Ograničen broj uzoraka po pikselu drži prikaz brz i za duge pesme.
      const start = Math.floor(x * stride), end = Math.min(samples.length, Math.ceil((x + 1) * stride));
      const step = Math.max(1, Math.floor((end - start) / 80));
      for (let i = start; i < end; i += step) { min = Math.min(min, samples[i]); max = Math.max(max, samples[i]); }
      ctx.moveTo(x, height / 2 + min * height * .42); ctx.lineTo(x, height / 2 + max * height * .42);
    }
    ctx.stroke();
    const segment = this.segment(pattern, range), x = segment.offset / this.buffer.duration * width;
    ctx.fillStyle = 'rgba(30,142,62,.12)'; ctx.fillRect(x, 0, segment.duration / this.buffer.duration * width, height);
    ctx.strokeStyle = '#1e8e3e'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.font = '13px system-ui';
    ctx.fillText(`${this.buffer.duration.toFixed(1)} s`, width - 70, height - 8);
  }

  setOffset(value) { this.offset = bounded(value, 0, this.buffer?.duration || 0, 0); }
}
