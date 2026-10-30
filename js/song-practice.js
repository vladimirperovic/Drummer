// Režim Pesma: sviraš uz snimak, indikator uživo pokazuje rano (plavo), tačno (ljubičasto) ili kasno (crveno),
// a na kraju izveštaj poredi tvoje udarce sa udarcima bubnja iz pesme.
import { INST } from './patterns.js';
import { LEVELS } from './scoring.js';
import { t, getLanguage } from './i18n.js';
import { navigate, adoptPane } from './navigation.js';
import { FAMILIES, songFamily, timingColor, prepareReference, matchSongHit, smoothError, songReport } from './song-practice-model.js';

const HISTORY_KEY = 'drummer.songRuns.v1', HISTORY_MAX = 5, METER_MS = 80;
const words = (sr, en) => getLanguage() === 'en' ? en : sr;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const familyLabel = id => t(FAMILIES.find(f => f[0] === id)?.[1] || id);
export const timingText = err => err == null ? '—' : Math.abs(err) < 8 ? words('U tempu', 'On time')
  : err < 0 ? words(`Žuriš ${Math.round(-err)} ms`, `${Math.round(-err)} ms early`) : words(`Kasniš ${Math.round(err)} ms`, `${Math.round(err)} ms late`);

export class SongPractice {
  constructor(host) {
    this.host = host; this.reference = null; this.active = false; this.hits = []; this.refs = []; this.avg = null; this.report = null;
    this.backing = 'original'; this.rate = 1; this.from = 0; this.to = 0; this.volume = .8; this.laneStart = 0; this.frameId = 0;
    try { this.history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; if (!Array.isArray(this.history)) this.history = []; } catch { this.history = []; }
    this.buildStage(); this.buildPlay(); this.buildReport();
    document.addEventListener('drummer:language', () => { this.renderStage(); this.renderPlay(); this.renderReport(); });
    document.addEventListener('drummer:mode', () => this.renderStage());
    new ResizeObserver(() => this.drawTimeline()).observe(this.stage);
    this.renderStage(); this.renderPlay(); this.renderReport();
  }

  // ---------- Pozornica gore: indikator i tok pesme ----------
  buildStage() {
    this.stage = document.getElementById('songStage');
    this.stage.innerHTML = `<div class="song-stage-head"><h1 data-song-title data-user-text>Pesma</h1><span class="muted" data-song-meta></span></div>
      <div class="song-stage-body" data-song-body>
        <div class="song-meter" data-song-meter role="meter" aria-label="Rano ili kasno u odnosu na pesmu" aria-valuemin="-${METER_MS}" aria-valuemax="${METER_MS}" aria-valuenow="0">
          <div class="song-meter-head"><span class="song-meter-label">Tajming</span><strong class="song-meter-value" data-song-value>—</strong></div>
          <div class="song-meter-track" aria-hidden="true"><span class="song-meter-zone"></span>
            ${[-80, -40, 0, 40, 80].map(ms => `<span class="song-meter-tick${ms ? '' : ' center'}" style="left:${50 + ms / METER_MS * 50}%"><b>${ms > 0 ? '+' : ms < 0 ? '−' : ''}${Math.abs(ms)}</b></span>`).join('')}
            <i class="song-meter-needle" data-song-needle></i></div>
          <div class="song-meter-scale"><span>← Rano</span><span>Tačno</span><span>Kasno →</span></div>
        </div>
        <canvas class="song-timeline" data-song-timeline height="120" aria-hidden="true"></canvas>
      </div>
      <div class="song-empty" data-song-empty><p>Učitaj pesmu i analiziraj bubanj, pa sviraj uz nju. Indikator pokazuje da li žuriš ili kasniš.</p><button type="button" class="primary" data-song-goto="ai">1 Učitaj i analiziraj</button></div>`;
    this.q = selector => this.stage.querySelector(selector);
    this.stage.addEventListener('click', e => { const go = e.target.closest('[data-song-goto]'); if (go) navigate(go.dataset.songGoto, { reveal: true }); });
  }

  renderStage() {
    const ref = this.reference;
    this.q('[data-song-empty]').hidden = !!ref; this.q('[data-song-body]').hidden = !ref;
    this.q('[data-song-title]').textContent = ref ? ref.fileName.replace(/\.[^.]+$/, '') : t('Pesma');
    this.q('[data-song-meta]').textContent = ref ? [`${ref.events.length} ${words('udaraca u pesmi', 'drum hits in the song')}`, clock(ref.durationSeconds),
      ref.bpm ? `${ref.bpm} BPM` : '', this.active ? words('svira…', 'playing…') : ''].filter(Boolean).join(' · ') : '';
    this.renderMeter(); this.drawTimeline();
  }

  renderMeter() {
    const meter = this.q('[data-song-meter]'), avg = this.avg, k = avg == null ? 0 : Math.max(-1, Math.min(1, avg / METER_MS));
    meter.style.setProperty('--tone', timingColor(avg ?? 0));
    meter.classList.toggle('idle', avg == null);
    this.q('[data-song-needle]').style.left = `${50 + k * 50}%`;
    this.q('[data-song-value]').textContent = avg == null ? words('Čeka prvi udarac', 'Waiting for the first hit') : timingText(avg);
    meter.setAttribute('aria-valuenow', String(Math.round(avg ?? 0)));
  }

  peaks(width) {
    const buffer = this.buffer();
    if (!buffer) return null;
    const key = `${this.backing}:${width}:${this.from}:${this.end()}`;
    if (this.peakCache?.key === key) return this.peakCache.values;
    const data = buffer.getChannelData(0), rate = buffer.sampleRate, start = Math.floor(this.from * rate), end = Math.floor(this.end() * rate);
    const values = new Float32Array(width), stride = (end - start) / width;
    for (let x = 0; x < width; x++) {
      let max = 0; const a = Math.floor(start + x * stride), b = Math.min(end, Math.floor(start + (x + 1) * stride)), step = Math.max(1, Math.floor((b - a) / 60));
      for (let i = a; i < b; i += step) max = Math.max(max, Math.abs(data[i]));
      values[x] = max;
    }
    this.peakCache = { key, values }; return values;
  }

  drawTimeline() {
    const canvas = this.q('[data-song-timeline]');
    if (!canvas || !this.reference || canvas.closest('[hidden]')) return;
    const ratio = devicePixelRatio || 1, width = Math.max(200, Math.round(canvas.clientWidth * ratio)), height = Math.round(120 * ratio);
    if (canvas.width !== width) canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d'), from = this.from, span = Math.max(.01, this.end() - from), x = time => (time - from) / span * width, mid = height / 2;
    ctx.clearRect(0, 0, width, height);
    const peaks = this.peaks(width);
    if (peaks) { ctx.fillStyle = '#e4e4e2'; for (let i = 0; i < width; i++) { const h = peaks[i] * (height * .42); ctx.fillRect(i, mid - h, 1, h * 2); } }
    ctx.strokeStyle = '#c8c8c5'; ctx.lineWidth = ratio; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(width, mid); ctx.stroke();
    const now = this.active ? this.songTime(performance.now() - this.host.settings.calib) : null, reached = now ?? this.lastEnd ?? -Infinity;
    for (const ref of this.refs) {
      if (ref.matched || ref.t > reached - .1) continue;
      ctx.fillStyle = '#d93025'; ctx.fillRect(x(ref.t) - ratio / 2, height - 7 * ratio, ratio, 6 * ratio);
    }
    for (const hit of this.hits) {
      if (hit.err == null) continue;
      const y = mid + Math.max(-1, Math.min(1, hit.err / METER_MS)) * (mid - 6 * ratio);
      ctx.fillStyle = timingColor(hit.err); ctx.beginPath(); ctx.arc(x(hit.t), y, 3.2 * ratio, 0, Math.PI * 2); ctx.fill();
    }
    if (now != null) { ctx.fillStyle = '#111'; ctx.fillRect(Math.max(0, Math.min(width - 2, x(now))), 0, 2 * ratio, height); }
    ctx.fillStyle = '#7a7a7a'; ctx.font = `${11 * ratio}px system-ui`;
    ctx.fillText(words('rano ↑', 'early ↑'), 6 * ratio, 13 * ratio); ctx.fillText(words('kasno ↓', 'late ↓'), 6 * ratio, height - 12 * ratio);
  }

  // ---------- Korak 2: sviranje ----------
  buildPlay() {
    const panel = this.play = document.createElement('section');
    panel.id = 'song-play'; panel.className = 'studio-panel song-panel'; panel.hidden = true;
    panel.innerHTML = `<h2>Sviraj uz pesmu</h2><p data-play-info class="muted"></p>
      <div class="form-row song-controls">
        <label>Pratnja<select data-play-backing><option value="original">Original</option><option value="drums">Samo bubanj</option><option value="without">Bez bubnja</option></select></label>
        <label>Brzina<select data-play-rate><option value="0.5">50%</option><option value="0.75">75%</option><option value="1" selected>100%</option></select></label>
        <label>Od (s)<input data-play-from type="number" min="0" step="0.5" value="0"></label>
        <label>Do (s)<input data-play-to type="number" min="0" step="0.5" value="0"></label>
        <label>Glasnoća<input data-play-volume type="range" min="0" max="1" step="0.05" value="0.8"></label>
      </div>
      <div class="row"><button type="button" class="primary" data-play-start>▶ Sviraj uz pesmu</button><button type="button" data-song-goto="songreport">Izveštaj</button></div>
      <p class="muted">Start gore ili razmak takođe pokreću pesmu. Odbrojavanje iz zaglavlja daje jedan takt klika pre prvog udarca kada je tempo poznat. Promena brzine menja i visinu tona.</p>
      <p class="muted">Poređenje je po grupama kao u AI analizi (bas, doboš, tomovi, hi-hat, činele). Višak udaraca ne smanjuje ocenu, jer AI ne čuje svaku ghost notu.</p>`;
    adoptPane(panel, 'songplay', 'song');
    const q = selector => panel.querySelector(selector);
    q('[data-play-backing]').onchange = e => { this.backing = e.target.value; this.peakCache = null; this.drawTimeline(); };
    q('[data-play-rate]').onchange = e => { this.rate = Number(e.target.value) || 1; };
    q('[data-play-from]').onchange = e => { this.setRange(Number(e.target.value), this.to); };
    q('[data-play-to]').onchange = e => { this.setRange(this.from, Number(e.target.value)); };
    q('[data-play-volume]').oninput = e => { this.volume = Number(e.target.value); if (this.gain) this.gain.gain.value = this.volume; };
    q('[data-play-start]').onclick = () => this.toggle();
    panel.addEventListener('click', e => { const go = e.target.closest('[data-song-goto]'); if (go) navigate(go.dataset.songGoto, { reveal: true }); });
  }

  setRange(from, to) {
    const duration = this.reference?.durationSeconds || 0;
    this.from = Math.max(0, Math.min(duration - .5, Number(from) || 0));
    this.to = to > this.from + .5 ? Math.min(duration, to) : duration;
    this.peakCache = null; this.renderPlay(); this.drawTimeline();
  }
  end() { return this.to || this.reference?.durationSeconds || 0; }

  renderPlay() {
    const q = selector => this.play.querySelector(selector), ref = this.reference;
    for (const option of q('[data-play-backing]').options) option.disabled = option.value !== 'original' && !ref?.buffers?.[option.value];
    q('[data-play-backing]').value = this.backing; q('[data-play-rate]').value = String(this.rate);
    q('[data-play-from]').value = this.from; q('[data-play-to]').value = this.end().toFixed(1); q('[data-play-volume]').value = this.volume;
    q('[data-play-from]').max = q('[data-play-to]').max = ref?.durationSeconds || 0;
    for (const control of this.play.querySelectorAll('select,input')) control.disabled = !ref || this.busy;
    q('[data-play-start]').disabled = !ref;
    q('[data-play-start]').textContent = this.busy ? words('■ Zaustavi', '■ Stop') : words('▶ Sviraj uz pesmu', '▶ Play along');
    q('[data-play-info]').textContent = ref
      ? words(`${ref.fileName} · ${ref.events.length} udaraca bubnja · ${clock(ref.durationSeconds)}${ref.buffers?.drums ? '' : ' · za „Samo bubanj” i „Bez bubnja” prvo izdvoji bubnjeve u koraku 1'}`,
        `${ref.fileName} · ${ref.events.length} drum hits · ${clock(ref.durationSeconds)}${ref.buffers?.drums ? '' : ' · separate the drums in step 1 for “Drums only” and “Without drums”'}`)
      : words('Prvo u koraku 1 učitaj pesmu i prepoznaj udarce bubnja.', 'First load a song and detect the drum hits in step 1.');
  }

  // Referenca iz AI analize: vremena udaraca, mapirani instrumenti i izdvojeni zvuk.
  setReference(candidate) {
    if (this.busy) return false;
    const events = (candidate.events || []).filter(e => Number.isFinite(e.timeSeconds) && INST[e.inst]).map(e => ({ timeSeconds: e.timeSeconds, inst: e.inst }));
    if (!events.length) throw new Error('AI analiza nema udarce bubnja za poređenje.');
    this.reference = { events, fileName: candidate.fileName || 'Pesma', durationSeconds: candidate.durationSeconds, bpm: candidate.bpm || null,
      meter: candidate.meter || { beats: 4, beatUnit: 4 }, offsetSeconds: candidate.offsetSeconds || 0, buffers: candidate.buffers };
    if (!this.reference.buffers?.[this.backing]) this.backing = 'original';
    this.refs = []; this.hits = []; this.avg = null; this.from = 0; this.to = this.reference.durationSeconds; this.peakCache = null;
    this.renderStage(); this.renderPlay(); return true;
  }

  buffer() { const b = this.reference?.buffers; return b?.[this.backing] || b?.original || null; }
  songTime(perf) { return this.from + (perf - this.perfStart) / 1000 * this.rate; }

  get busy() { return this.active || !!this.starting; }

  toggle() { return this.busy ? this.stop('manual') : this.start(); }

  async start() {
    const { audio, settings } = this.host;
    if (this.busy) return false;
    if (!this.reference) { this.host.toast('Prvo učitaj pesmu i prepoznaj udarce bubnja.'); navigate('ai', { reveal: true }); return false; }
    if (this.host.isBusy()) { this.host.toast('Zaustavi vežbu pre sviranja uz pesmu.'); return false; }
    const token = this.startToken = (this.startToken || 0) + 1;
    this.starting = true; this.renderPlay(); this.host.onBusyChange?.();
    try {
      await audio.ensure();
      if (token !== this.startToken) return false;
      const ctx = audio.ctx, buffer = this.buffer(), from = this.from, to = this.end(), rate = this.rate;
      let startAt = ctx.currentTime + .25;
      const clicks = [], ref = this.reference;
      if (settings.countIn && ref.bpm) {
        const beat = 60 / ref.bpm * 4 / (ref.meter?.beatUnit || 4), beats = ref.meter?.beats || 4, next = ref.offsetSeconds + Math.max(0, Math.ceil((from - ref.offsetSeconds) / beat - 1e-6)) * beat;
        const lead = (next - from) / rate, need = beats * beat / rate - lead;
        if (need > 0) startAt += need;
        for (let i = beats; i >= 1; i--) clicks.push({ time: startAt + lead - i * beat / rate, accent: i === beats });
      }
      for (const click of clicks) audio.click(click.time, click.accent);
      const source = this.source = ctx.createBufferSource(), gain = this.gain = ctx.createGain();
      source.buffer = buffer; source.playbackRate.value = rate; gain.gain.value = this.volume;
      source.connect(gain).connect(ctx.destination); source.start(startAt, from, to - from);
      source.onended = () => { if (this.source === source && this.active) this.stop('complete'); };
      this.perfStart = audio.ctxToPerf(startAt); this.endPerf = this.perfStart + (to - from) / rate * 1000;
      this.refs = prepareReference(ref.events, { from, to }); this.hits = []; this.avg = null; this.lastEnd = null; this.active = true;
      this.run = { date: new Date().toISOString(), rate, backing: this.backing, from, to, level: settings.level };
      this.host.onBusyChange?.(); this.renderPlay(); this.renderStage(); this.loop();
      return true;
    } catch (error) {
      if (token === this.startToken) { try { this.source?.stop(); } catch {} this.source = null; this.gain = null; this.active = false; this.host.toast(error.message); }
      return false;
    } finally { if (token === this.startToken) { this.starting = false; this.renderPlay(); this.host.onBusyChange?.(); } }
  }

  loop() {
    cancelAnimationFrame(this.frameId);
    if (!this.active) return;
    this.drawTimeline();
    if (performance.now() > this.endPerf + 600) { this.stop('complete'); return; }
    this.frameId = requestAnimationFrame(() => this.loop());
  }

  // Udarac sa bubnja tokom pesme. Vraća rezultat u istom obliku kao obična ocena (kind, err, inst).
  hit(inst, vel, perf) {
    if (!this.active) return null;
    const { settings } = this.host, [good, ok] = LEVELS[settings.level] || LEVELS.normalno, rate = this.rate;
    const time = this.songTime(perf - settings.calib);
    if (time < this.from - ok / 1000 * rate) return null;
    const result = matchSongHit(this.refs, { inst, t: time, vel }, { windowMs: ok * rate, goodMs: good * rate });
    if (result.err != null) { result.err /= rate; this.avg = smoothError(this.avg, result.err); }
    this.hits.push(result); this.renderMeter();
    return result;
  }

  stop(reason = 'manual') {
    this.startToken = (this.startToken || 0) + 1;
    const wasStarting = this.starting; this.starting = false;
    if (!this.active) { if (wasStarting) { this.renderPlay(); this.host.onBusyChange?.(); } return null; }
    this.active = false; cancelAnimationFrame(this.frameId);
    try { this.source?.stop(); } catch {}
    this.source = null; this.gain = null;
    const endTime = this.lastEnd = reason === 'complete' ? this.end() : Math.min(this.end(), this.songTime(performance.now()));
    const played = this.refs.filter(r => r.t <= endTime);
    if (this.hits.length || played.some(r => r.matched)) {
      const ref = this.reference;
      this.report = { id: `song-${Date.now().toString(36)}`, name: ref.fileName.replace(/\.[^.]+$/, ''), ...this.run, to: endTime, reason,
        bpm: ref.bpm, meter: ref.meter, offsetSeconds: ref.offsetSeconds, durationSeconds: endTime,
        reference: played.map(r => ({ t: r.t, inst: r.inst, family: r.family, matched: r.matched })), hits: this.hits.filter(h => h.t <= endTime + .2) };
      this.saveHistory(this.report); this.laneStart = this.laneOrigin();
      this.renderReport(); navigate('songreport');
    }
    this.host.onBusyChange?.(); this.renderPlay(); this.renderStage();
    return this.report;
  }

  saveHistory(report) {
    const round = n => Math.round(n * 1000) / 1000;
    const compact = { ...report, reference: report.reference.map(r => [round(r.t), r.inst, r.matched ? Math.round(r.matched.err * 10) / 10 : null]),
      hits: report.hits.map(h => [round(h.t), h.inst, h.vel, h.err == null ? null : Math.round(h.err * 10) / 10, h.kind]) };
    this.history = [compact, ...this.history.filter(h => h.id !== report.id)].slice(0, HISTORY_MAX);
    for (let keep = this.history.length; keep > 0; keep--) {
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history.slice(0, keep))); this.history = this.history.slice(0, keep); return; } catch {}
    }
  }

  expand(compact) {
    if (!Array.isArray(compact.reference?.[0]) && compact.reference?.length) return compact;
    return { ...compact, reference: compact.reference.map(([time, inst, err]) => ({ t: time, inst, family: songFamily(inst), matched: err == null ? null : { err } })),
      hits: compact.hits.map(([time, inst, vel, err, kind]) => ({ t: time, inst, vel, err, kind })) };
  }

  // ---------- Korak 3: izveštaj ----------
  buildReport() {
    const panel = this.reportPanel = document.createElement('section');
    panel.id = 'song-report'; panel.className = 'studio-panel song-panel'; panel.hidden = true;
    panel.innerHTML = `<div class="section-heading"><h2>Izveštaj za pesmu</h2><label class="field compact">Sviranja<select data-report-select data-user-text></select></label></div><div data-report-body></div>`;
    adoptPane(panel, 'songreport', 'song');
    panel.querySelector('[data-report-select]').onchange = e => {
      const found = this.history.find(h => h.id === e.target.value); if (!found) return;
      this.report = this.expand(found); this.laneStart = this.laneOrigin(); this.renderReport();
    };
    panel.addEventListener('click', e => {
      const lane = e.target.closest('[data-lane]'), go = e.target.closest('[data-song-goto]');
      if (go) { navigate(go.dataset.songGoto, { reveal: true }); return; }
      if (!lane || !this.report) return;
      const span = this.laneSpan(), value = lane.dataset.lane;
      this.laneStart = value === 'prev' ? this.laneStart - span : value === 'next' ? this.laneStart + span : Number(value);
      this.laneStart = Math.max(this.laneOrigin(), Math.min(this.laneStart, this.report.to - span / 2));
      this.renderLanes();
    });
  }

  // Pregled udaraca počinje od takta (kad je tempo poznat), a ne od sekunde pre prve dobe.
  laneOrigin() {
    const r = this.report; if (!r) return 0;
    const bar = this.laneSpan() / 2, offset = r.offsetSeconds || 0;
    return !r.bpm ? r.from : r.from <= offset ? offset : offset + Math.floor((r.from - offset) / bar) * bar;
  }
  laneSpan() { const r = this.report, bar = r?.bpm ? (r.meter?.beats || 4) * 4 / (r.meter?.beatUnit || 4) * 60 / r.bpm : null; return bar ? bar * 2 : 4; }

  renderReport() {
    const panel = this.reportPanel, select = panel.querySelector('[data-report-select]'), body = panel.querySelector('[data-report-body]');
    select.replaceChildren(...this.history.map(h => new Option(`${h.name} · ${new Date(h.date).toLocaleString(getLanguage() === 'en' ? 'en-GB' : 'sr-Latn')}`, h.id)));
    select.disabled = !this.history.length;
    if (!this.report && this.history.length) { this.report = this.expand(this.history[0]); this.laneStart = this.laneOrigin(); }
    if (this.report) select.value = this.report.id;
    if (!this.report) {
      body.innerHTML = `<p class="muted">${words('Izveštaj se pojavljuje kada odsviraš pesmu (ili je prekineš posle prvih udaraca).', 'A report appears after you play along with a song (or stop after the first hits).')}</p><button type="button" data-song-goto="songplay">${words('2 Sviraj uz pesmu', '2 Play along')}</button>`;
      return;
    }
    const r = this.report, s = songReport(r.reference, r.hits, { durationSeconds: r.to, bpm: r.bpm, beats: r.meter?.beats, beatUnit: r.meter?.beatUnit, offsetSeconds: r.offsetSeconds });
    s.windows = s.windows.filter(w => w.to > r.from && w.from < r.to);
    this.summary = s;
    const card = (label, value, extra = '') => `<div class="song-card"${extra}><span>${label}</span><strong>${value}</strong></div>`;
    const tone = s.mean == null ? '' : ` style="--tone:${timingColor(s.mean)}"`;
    const where = w => w.bar ? words(`takt ${w.bar}`, `bar ${w.bar}`) : `${clock(w.from)}–${clock(w.to)}`;
    body.innerHTML = `<p class="muted">${esc(r.name)} · ${r.backing === 'drums' ? words('samo bubanj', 'drums only') : r.backing === 'without' ? words('bez bubnja', 'without drums') : 'original'} · ${Math.round(r.rate * 100)}% · ${clock(r.from)}–${clock(r.to)}${r.reason === 'manual' ? words(' · prekinuto', ' · stopped') : ''}</p>
      <div class="song-cards">${card(words('Tačnost', 'Accuracy'), s.accuracy == null ? '–' : s.accuracy + '%')}${card(words('Prosek', 'Average'), esc(timingText(s.mean)), ` data-tone${tone}`)}
        ${card(words('Rasipanje', 'Spread'), s.spread == null ? '–' : `±${Math.round(s.spread)} ms`)}${card(words('Pogođeno', 'Matched'), `${s.good + s.ok}/${s.expected}`)}
        ${card(words('Promašeno', 'Missed'), s.missed)}${card(words('Višak', 'Extra'), s.extra)}</div>
      <h3>${words('Kroz pesmu', 'Through the song')}</h3><p class="muted">${words('Gore je rano (plavo), dole kasno (crveno); ljubičasto je tačno. Crvene tačke su propušteni udarci. Klikni deo za detalje.', 'Up is early (blue), down is late (red); purple is on time. Red dots are missed hits. Click a part for details.')}</p>
      <div class="song-scroll">${this.windowsSvg(s)}</div>
      ${s.weakest.length ? `<p class="song-weak"><strong>${words('Najviše vežbe traži:', 'Practice most:')}</strong> ${s.weakest.map(w => `<button type="button" class="linklike" data-lane="${w.from}">${where(w)}: ${esc(timingText(w.mean))}${w.missed ? words(`, ${w.missed} promašeno`, `, ${w.missed} missed`) : ''}</button>`).join(' · ')}</p>` : ''}
      <h3>${words('Udarci: pesma i ti', 'Hits: the song and you')}</h3><div class="row song-lane-nav"><button type="button" data-lane="prev">◀</button><span data-lane-label></span><button type="button" data-lane="next">▶</button></div>
      <p class="muted">${words('Crne crte su udarci bubnja iz pesme, tačke su tvoji udarci obojeni po odstupanju, prazni krugovi su propušteni udarci, sivo × je višak.', 'Black lines are the song’s drum hits, dots are your hits colored by offset, hollow circles are missed hits, gray × is an extra hit.')}</p>
      <div class="song-scroll" data-lanes></div>
      <table class="data-table song-families"><thead><tr><th>${words('Grupa', 'Group')}</th><th>${words('Pogođeno', 'Matched')}</th><th>${words('Prosek', 'Average')}</th><th>${words('Rasipanje', 'Spread')}</th></tr></thead><tbody>
        ${s.families.map(f => `<tr><td>${esc(familyLabel(f.id))}</td><td>${f.hit}/${f.expected}</td><td style="color:${timingColor(f.mean)}">${esc(timingText(f.mean))}</td><td>${f.spread == null ? '–' : `±${Math.round(f.spread)} ms`}</td></tr>`).join('')}</tbody></table>`;
    this.renderLanes();
  }

  windowsSvg(s) {
    const list = s.windows, n = Math.max(1, list.length), width = Math.max(600, n * 14), height = 150, mid = 70, col = width / n;
    const parts = list.map((w, i) => {
      const x = i * col, h = w.mean == null ? 0 : Math.min(60, Math.abs(w.mean) / METER_MS * 60);
      const y = w.mean == null || w.mean > 0 ? mid : mid - h, label = w.bar && (w.bar === 1 || w.bar % 4 === 1) ? `<text x="${x + 2}" y="146" class="song-axis">${w.bar}</text>` : '';
      return `<g class="song-window" data-lane="${w.from}"><rect x="${x}" y="0" width="${col}" height="${height - 12}" fill="transparent"/>`
        + (w.mean == null ? '' : `<rect x="${x + 1}" y="${y}" width="${Math.max(1, col - 2)}" height="${Math.max(2, h)}" rx="2" fill="${timingColor(w.mean)}"><title>${esc(timingText(w.mean))}</title></rect>`)
        + (w.missed ? `<circle cx="${x + col / 2}" cy="${height - 22}" r="${Math.min(5, 1.5 + w.missed)}" fill="#d93025"/>` : '') + label + '</g>';
    }).join('');
    return `<svg class="song-windows" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${words('Odstupanje kroz pesmu', 'Offset through the song')}">
      <line x1="0" x2="${width}" y1="${mid}" y2="${mid}" class="song-mid"/>${parts}</svg>`;
  }

  renderLanes() {
    const host = this.reportPanel.querySelector('[data-lanes]'); if (!host || !this.report) return;
    const r = this.report, span = this.laneSpan(), pad = span * .04, from = this.laneStart - pad, to = this.laneStart + span + pad;
    const present = FAMILIES.filter(([id]) => r.reference.some(x => x.family === id) || r.hits.some(h => songFamily(h.inst) === id));
    const left = 96, width = 1000, laneH = 38, height = present.length * laneH + 26, x = time => left + (time - from) / (to - from) * (width - left - 10);
    const lanes = new Map(present.map(([id], i) => [id, 22 + i * laneH + laneH / 2]));
    const grid = [];
    if (r.bpm) {
      const beat = 60 / r.bpm * 4 / (r.meter?.beatUnit || 4), beats = r.meter?.beats || 4, first = Math.ceil((from - r.offsetSeconds) / beat - 1e-6);
      for (let k = first; r.offsetSeconds + k * beat <= to; k++) {
        const time = r.offsetSeconds + k * beat, bar = Math.floor(k / beats) + 1, down = ((k % beats) + beats) % beats === 0;
        grid.push(`<line x1="${x(time)}" x2="${x(time)}" y1="16" y2="${height}" class="${down ? 'song-bar' : 'song-beat'}"/>${down ? `<text x="${x(time) + 3}" y="12" class="song-axis">${bar}</text>` : ''}`);
      }
    }
    const rows = present.map(([id]) => `<text x="6" y="${lanes.get(id) + 4}" class="song-lane-label">${esc(familyLabel(id))}</text><line x1="${left}" x2="${width}" y1="${lanes.get(id)}" y2="${lanes.get(id)}" class="song-lane-line"/>`).join('');
    const marks = [];
    for (const ref of r.reference) if (ref.t >= from && ref.t <= to && lanes.has(ref.family)) {
      const y = lanes.get(ref.family);
      marks.push(`<line x1="${x(ref.t)}" x2="${x(ref.t)}" y1="${y - 11}" y2="${y + 11}" class="song-ref"/>`);
      if (!ref.matched) marks.push(`<circle cx="${x(ref.t)}" cy="${y}" r="7" class="song-missed"/>`);
    }
    for (const hit of r.hits) {
      const family = songFamily(hit.inst); if (hit.t < from || hit.t > to || !lanes.has(family)) continue;
      const y = lanes.get(family), hx = x(hit.t);
      if (hit.err == null) marks.push(`<path d="M${hx - 5} ${y - 5}L${hx + 5} ${y + 5}M${hx + 5} ${y - 5}L${hx - 5} ${y + 5}" class="song-extra"/>`);
      else marks.push(`<line x1="${x(hit.t - hit.err / 1000 * r.rate)}" x2="${hx}" y1="${y}" y2="${y}" stroke="${timingColor(hit.err)}" stroke-width="2"/><circle cx="${hx}" cy="${y}" r="6" fill="${timingColor(hit.err)}"><title>${esc(INST[hit.inst]?.label || hit.inst)} · ${esc(timingText(hit.err))}</title></circle>`);
    }
    host.innerHTML = `<svg class="song-lanes" viewBox="0 0 ${width} ${height}" role="img" aria-label="${words('Udarci iz pesme i tvoji udarci', 'Song hits and your hits')}">${grid.join('')}${rows}${marks.join('')}</svg>`;
    const label = this.reportPanel.querySelector('[data-lane-label]');
    const bar = Math.round((this.laneStart - (r.offsetSeconds || 0)) / (span / 2)) + 1;
    if (label) label.textContent = r.bpm ? words(`takt ${bar}–${bar + 1}`, `bars ${bar}–${bar + 1}`) : `${clock(this.laneStart)}–${clock(this.laneStart + span)}`;
  }
}
