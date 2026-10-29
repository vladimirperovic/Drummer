import { blankPattern, barMs, beatMs, groupStarts, INSTRUMENTS, DYN_VEL, slotOffsetMs } from './patterns.js';
import { quantizeTake } from './rhythm-capture-model.js';
import { renderNotation } from './notation.js';
import { t, getLanguage } from './i18n.js';

const words = (sr, en) => getLanguage() === 'en' ? en : sr;
export class RhythmCapture {
  constructor(host) {
    this.host = host; this.state = 'idle'; this.token = 0; this.hits = [];
    this.dialog = document.createElement('dialog'); this.dialog.id = 'rhythmCapture'; this.dialog.className = 'rhythm-capture';
    this.dialog.innerHTML = `<h2>Snimaj novi ritam</h2><p>Odsviraj uz klik. Udarci će biti poravnati na najbliže note, pa možeš preslušati i sačuvati ritam.</p>
      <div class="capture-fields"><label>Naziv <input data-capture-name maxlength="100"></label><label>BPM <input data-capture-bpm type="number" min="30" max="260"></label>
      <label>Taktovi <select data-capture-bars>${[1,2,3,4,5,6,7,8].map(n => `<option>${n}</option>`).join('')}</select></label>
      <label>Mera <select data-capture-beats>${[2,3,4,5,6,7].map(n => `<option>${n}</option>`).join('')}</select> / <select data-capture-unit><option>4</option><option>8</option></select></label>
      <label>Poravnanje <select data-capture-grid><option value="auto">Automatski</option><option value="8">Osmine</option><option value="16">Šesnaestine</option><option value="12">Triole</option></select></label>
      <label>Swing % <input data-capture-swing type="number" min="50" max="75" value="50"></label></div>
      <p data-capture-info role="status"></p><div data-capture-preview></div><div class="capture-actions"><button data-capture-start>Snimaj uz odbrojavanje</button><button data-capture-listen hidden>Preslušaj poravnato</button><button data-capture-save hidden>Sačuvaj ritam</button><button data-capture-close>Zatvori</button></div>`;
    document.body.append(this.dialog);
    this.banner = document.createElement('div'); this.banner.className = 'capture-banner'; this.banner.hidden = true;
    this.banner.innerHTML = '<strong data-capture-progress aria-live="polite"></strong><button data-capture-stop>Zaustavi i pregledaj</button>';
    document.querySelector('.bar').after(this.banner);
    this.find('[data-capture-start]').onclick = () => this.start();
    this.find('[data-capture-close]').onclick = () => this.close();
    this.find('[data-capture-listen]').onclick = () => this.listen();
    this.find('[data-capture-save]').onclick = async () => {
      if (this.busy || !this.result?.accepted.length) return;
      this.result.pattern.name = this.find('[data-capture-name]').value.trim() || t('Snimljen ritam');
      if (await this.host.save(this.result.pattern)) { this.dialog.close(); this.state = 'idle'; }
    };
    this.find('[data-capture-grid]').onchange = () => { if (this.state === 'preview') this.preview(); };
    for (const field of ['bpm','bars','beats','unit','swing']) this.find(`[data-capture-${field}]`).onchange = () => {
      if (this.state === 'preview') { this.take = {...this.take,...this.options()}; this.preview(); }
    };
    this.banner.querySelector('button').onclick = () => this.finish();
    this.dialog.addEventListener('cancel', e => { e.preventDefault(); this.close(); });
    this.dialog.addEventListener('keydown', e => e.stopPropagation());
    document.addEventListener('drummer:language', () => { if (this.state === 'preview') this.preview(); });
  }
  find(selector) { return this.dialog.querySelector(selector); }
  get busy() { return ['starting','recording','listening'].includes(this.state); }
  open() {
    if (this.host.isBusy()) return;
    if (this.state !== 'preview') {
      const p = this.host.getPattern();
      this.find('[data-capture-name]').value = t('Snimljen ritam');
      for (const [key,value] of Object.entries({bpm:p.bpm,bars:p.bars,beats:p.beats,unit:p.beatUnit,swing:p.swing})) this.find(`[data-capture-${key}]`).value = value;
      this.find('[data-capture-info]').textContent = words('Jedan takt odbrojavanja. MIDI, tastatura i klik na bubanj su podržani.', 'One bar of count-in. MIDI, keyboard and clickable pads are supported.');
    }
    this.dialog.showModal(); document.dispatchEvent(new Event('drummer:translate'));
  }
  options() {
    return { name:this.find('[data-capture-name]').value, bpm:+this.find('[data-capture-bpm]').value,
      bars:+this.find('[data-capture-bars]').value, beats:+this.find('[data-capture-beats]').value,
      beatUnit:+this.find('[data-capture-unit]').value, swing:+this.find('[data-capture-swing]').value,
      quantize:this.find('[data-capture-grid]').value, calib:this.host.calibration() };
  }
  async start() {
    if (this.busy || this.host.isBusy()) return;
    const token = ++this.token; this.state = 'starting'; this.controls(); this.host.onBusyChange();
    try {
      await this.host.audio.ensure(); if (token !== this.token) return;
      this.take = this.options(); this.clockPattern = blankPattern(this.take); this.hits = []; this.result = null;
      this.startAudio = this.host.audio.time + .15; this.firstAudio = this.startAudio + barMs(this.clockPattern) / 1000;
      this.firstPerf = this.host.audio.ctxToPerf(this.firstAudio);
      this.endPerf = this.firstPerf + barMs(this.clockPattern) * this.clockPattern.bars;
      this.nextBeat = -this.clockPattern.beats; this.state = 'recording'; this.dialog.close(); this.banner.hidden = false;
      this.host.showKit(); this.timer = setInterval(() => this.tick(), 25); this.tick();
    } catch (error) { if(token === this.token) { this.state = this.result ? 'preview' : 'idle'; this.host.toast(error.message || t('Zvuk nije dostupan.')); } }
    finally { this.controls(); this.host.onBusyChange(); }
  }
  tick() {
    const p = this.clockPattern, audio = this.host.audio, total = p.beats * p.bars, now = performance.now();
    while (this.nextBeat < total && this.firstAudio + this.nextBeat * beatMs(p) / 1000 < audio.time + .12) {
      const beat = this.nextBeat++, inBar = ((beat % p.beats) + p.beats) % p.beats;
      audio.click(this.firstAudio + beat * beatMs(p) / 1000, groupStarts(p).includes(inBar));
    }
    const elapsed = now - this.firstPerf;
    this.banner.querySelector('strong').textContent = elapsed < 0
      ? words(`Odbrojavanje: ${Math.ceil(-elapsed / beatMs(p))}`, `Count-in: ${Math.ceil(-elapsed / beatMs(p))}`)
      : words(`Snimanje · takt ${Math.min(p.bars,Math.floor(elapsed / barMs(p)) + 1)} / ${p.bars} · ${this.hits.length} udaraca`, `Recording · bar ${Math.min(p.bars,Math.floor(elapsed / barMs(p)) + 1)} / ${p.bars} · ${this.hits.length} hits`);
    if (now > this.endPerf + 150) this.finish(false);
  }
  hit(inst, vel, perf, source, midiNote, metadata) {
    if (this.state !== 'recording' || this.hits.length >= 10000) return;
    const timeMs = perf - this.firstPerf;
    if (timeMs - this.take.calib < -Math.min(250,beatMs(this.clockPattern)/2) || timeMs - this.take.calib > this.endPerf-this.firstPerf) return;
    this.hits.push({inst,vel,timeMs,source,midiNote,...(metadata ? {metadata} : {})});
  }
  finish(manual = true) {
    if (this.state === 'starting') return this.close();
    if (this.state !== 'recording') return;
    clearInterval(this.timer); this.host.audio.stopScheduled(); this.banner.hidden = true;
    if (manual) this.take.bars = Math.min(this.take.bars,Math.max(1,Math.ceil((performance.now()-this.firstPerf)/barMs(this.clockPattern))));
    this.find('[data-capture-bars]').value = this.take.bars;
    this.state = 'preview'; this.host.onBusyChange(); this.preview(); this.dialog.showModal();
  }
  preview() {
    this.result = quantizeTake(this.hits, {...this.take,quantize:this.find('[data-capture-grid]').value});
    const r = this.result;
    renderNotation(this.find('[data-capture-preview]'),r.pattern,{pageWidth:Math.max(340,this.dialog.clientWidth-48 || 800),barsPerLine:1,zoom:65});
    this.find('[data-capture-info]').textContent = words(
      `${r.accepted.length} udaraca · poravnanje ${r.mode} · prosečna korekcija ${Math.round(r.meanErrorMs)} ms · spojeno ${r.collisions} · van takta ${r.rejected.length}`,
      `${r.accepted.length} hits · grid ${r.mode} · average adjustment ${Math.round(r.meanErrorMs)} ms · merged ${r.collisions} · outside take ${r.rejected.length}`);
    for (const name of ['listen','save']) { this.find(`[data-capture-${name}]`).hidden = false; this.find(`[data-capture-${name}]`).disabled = !r.accepted.length; }
    this.find('[data-capture-start]').textContent = 'Snimi ponovo';
    this.controls();
    document.dispatchEvent(new Event('drummer:translate'));
  }
  async listen() {
    if (this.busy || !this.result) return;
    const token = ++this.token; this.state = 'listening'; this.host.onBusyChange();
    this.controls();
    try {
      await this.host.audio.ensure(); if (token !== this.token) return;
      const p = this.result.pattern, start = this.host.audio.time + .1;
      for (const inst of INSTRUMENTS) p.steps[inst.id].forEach((v,s) => { if (v) this.host.audio.play(inst.id,start+slotOffsetMs(p,s)/1000,DYN_VEL[v]/127,'pattern'); });
      this.listenTimer = setTimeout(() => { if (token !== this.token) return; this.state = 'preview'; this.controls(); this.host.onBusyChange(); },barMs(p)*p.bars+200);
    } catch (error) { if (token === this.token) { this.host.audio.stopScheduled();this.state='preview';this.controls();this.host.onBusyChange();this.host.toast(error.message || t('Zvuk nije dostupan.')); } }
  }
  controls() {
    for (const control of this.dialog.querySelectorAll('.capture-fields input,.capture-fields select,[data-capture-start]')) control.disabled=this.busy;
    for (const name of ['listen','save']) this.find(`[data-capture-${name}]`).disabled=this.busy || !this.result?.accepted.length;
  }
  close() {
    this.token++; clearInterval(this.timer); clearTimeout(this.listenTimer);
    if (this.busy) this.host.audio.stopScheduled();
    this.banner.hidden = true; this.dialog.close(); this.state = this.result ? 'preview' : 'idle'; this.controls(); this.host.onBusyChange();
  }
}
