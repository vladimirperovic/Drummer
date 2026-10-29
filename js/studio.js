import { INSTRUMENTS, INST, normalize, slotsPerBar } from './patterns.js';
import { normalizeFocus, practiceRange, acceptsInstrument, patternSignature, sessionKey, compactStats,
  normalizeSession, progressFor, recommendFocus, normalizeProgram, performanceMidi, bounded } from './practice.js';
import { BackingTrack } from './backing.js';
import { ReplayPlayer } from './replay.js';
import { renderPerformanceReport } from './performance-report.js';
import { JournalStore, sessionSummary } from './journal-store.js';
import { ArrangementEditor, compileArrangement } from './arrangements.js';
import { BackupRestore } from './backup-restore.js';
import * as store from './storage.js';
import { getLanguage, t } from './i18n.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const patternLabel = p => `<span${p.preset ? '' : ' data-user-text'}>${esc(p.name)}</span>`;
const time = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const percent = value => value == null ? '–' : `${value}%`;
const date = value => new Date(value).toLocaleString(getLanguage() === 'en' ? 'en-GB' : 'sr-Latn', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export class PracticeStudio {
  constructor(host) {
    this.host = host;
    this.focus = normalizeFocus(host.getPattern());
    this.sessions = store.loadSessions().map(normalizeSession).filter(Boolean);
    this.sessionCache = new Map(this.sessions.map(s => [s.id, s]));
    this.pendingSessions = new Map(); this.sessionLoads = new Map(); this.journalPage = 1; this.journalPageSize = 12; this.loadingSessionId = ''; this.journalError = false;
    this.programs = store.loadPrograms().map(normalizeProgram).filter(p => p.id);
    const programDraft = store.loadProgramDraft();
    this.program = normalizeProgram(programDraft || { name: t('Moj program') }); this.programDirty = !!programDraft;
    this.selectedId = this.sessions[0]?.id || '';
    this.backing = new BackingTrack(host.audio);
    this.replay = new ReplayPlayer(host.audio, ms => this.replayPosition(ms), () => { $('replayPlay').textContent = '▶ Slušaj'; this.host.onBusyChange?.(); });
    this.capture = null; this.run = null; this.runToken = 0;
    this.bind(); this.renderFocus(); this.renderJournal(); this.renderPrograms(); this.renderBacking();
    this.mountJournalControls();
    this.arrangements = new ArrangementEditor(this);
    this.backupRestore = new BackupRestore(this);
    this.initializeJournal();
    window.addEventListener('beforeunload', event => { if (this.pendingSessions.size) { event.preventDefault(); event.returnValue = ''; } });
  }

  initializeJournal() {
    this.journal?.db?.close(); this.journal = new JournalStore();
    this.journalReady = this.journal.ready.then(async () => {
      const saved = await this.journal.list(), known = new Map(saved.map(s => [s.id, s]));
      for (const session of this.sessions) if (!known.has(session.id)) known.set(session.id, session);
      this.sessions = [...known.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      this.selectedId ||= this.sessions[0]?.id || '';
      // A retained legacy copy can be older than an already committed IDB row.
      // Re-read migrated sessions, while keeping in-flight captures in memory.
      for (const id of this.sessionCache.keys()) if (!this.pendingSessions.has(id)) this.sessionCache.delete(id);
      this.journalError = false; this.updateJournalStatus(); this.renderJournal(); return true;
    }).catch(() => { this.journalError = true; this.updateJournalStatus(); return false; });
  }

  get range() { return practiceRange(this.host.getPattern(), this.focus); }
  get selected() {
    const cached = this.sessionCache.get(this.selectedId), entry = this.sessions.find(s => s.id === this.selectedId);
    return Array.isArray(entry?.hits) ? entry : cached || null;
  }

  mountJournalControls() {
    const status = document.createElement('p'); status.id = 'journalStorageStatus'; status.className = 'muted'; status.setAttribute('role', 'status');
    $('studio-journal').prepend(status);
    const nav = document.createElement('div'); nav.className = 'row journal-pagination';
    nav.innerHTML = '<button id="journalPrev">Prethodna strana</button><span id="journalPageInfo" aria-live="polite"></span><button id="journalNext">Sledeća strana</button>';
    $('sessionList').closest('.table-wrap')?.after(nav);
    $('journalPrev').onclick = () => { this.journalPage--; this.renderJournal(); };
    $('journalNext').onclick = () => { this.journalPage++; this.renderJournal(); };
    this.updateJournalStatus();
  }
  updateJournalStatus() {
    if (!$('journalStorageStatus')) return;
    $('journalStorageStatus').textContent = this.journalError ? 'Dnevnik nije sačuvan. Izvezi podatke ili pokušaj ponovo.'
      : this.pendingSessions.size ? 'Čuvam snimak sesije…' : this.journal?.fallback ? 'Dnevnik koristi ograničeno lokalno skladište ovog browsera.' : 'Snimci se čuvaju u IndexedDB; detalji se učitavaju po izboru sesije.';
  }
  async loadSession(id = this.selectedId) {
    if (!id) return null;
    const existing = this.sessions.find(s => s.id === id);
    if (Array.isArray(existing?.hits)) return existing;
    if (this.sessionCache.has(id)) return this.sessionCache.get(id);
    if (this.sessionLoads.has(id)) return this.sessionLoads.get(id);
    this.loadingSessionId = id;
    const loading = (async () => { try {
      await this.journalReady;
      const session = normalizeSession(await this.journal.get(id));
      if (!session) throw new Error('Snimak sesije nije dostupan.');
      this.sessionCache.set(id, session);
      for (const key of this.sessionCache.keys()) if (this.sessionCache.size > 3 && key !== this.selectedId && !this.pendingSessions.has(key)) this.sessionCache.delete(key);
      return session;
    } catch (error) { this.journalError = true; store.reportError(error); this.updateJournalStatus(); return null; }
    finally { if (this.loadingSessionId === id) this.loadingSessionId = ''; }
    })();
    this.sessionLoads.set(id, loading);
    try { return await loading; } finally { this.sessionLoads.delete(id); }
  }
  persistSession(session) {
    this.pendingSessions.set(session.id, session); this.updateJournalStatus();
    const saved = this.journal.put(session).then(() => {
      this.pendingSessions.delete(session.id); this.journalError = false;
      this.sessions = this.sessions.map(s => s.id === session.id ? sessionSummary(session) : s);
      this.updateJournalStatus();
    }).catch(() => { this.journalError = true; this.updateJournalStatus(); });
    return saved;
  }
  async flushJournal() {
    if (!await this.journalReady) { this.initializeJournal(); if (!await this.journalReady) return false; }
    for (const session of [...this.pendingSessions.values()]) await this.persistSession(session);
    try { await this.journal.flush(); return this.pendingSessions.size === 0; }
    catch { return false; }
  }
  async exportSessions() {
    let saved = [];
    try { saved = await this.journal.exportAll(); } catch { if (!this.sessions.every(s => Array.isArray(s.hits) || this.sessionCache.has(s.id))) throw new Error('Sve snimke nije moguće izvesti. Pokušaj ponovo.'); }
    const all = new Map(saved.map(s => [s.id, s]));
    for (const s of this.sessionCache.values()) all.set(s.id, s);
    for (const s of this.sessions) if (Array.isArray(s.hits)) all.set(s.id, s);
    for (const s of this.pendingSessions.values()) all.set(s.id, s);
    return [...all.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  show(panel) {
    document.querySelector('[data-view=practice]').click();
    for (const button of document.querySelectorAll('[data-studio]')) button.classList.toggle('active', button.dataset.studio === panel);
    for (const name of ['focus', 'journal', 'backing', 'program', 'replay', 'arrangement']) if ($(`studio-${name}`)) $(`studio-${name}`).hidden = name !== panel;
    if (panel === 'journal') this.renderJournal();
    if (panel === 'replay') this.renderReplay();
  }

  bind() {
    for (const button of document.querySelectorAll('[data-studio]')) button.onclick = () => this.show(button.dataset.studio);
    const changeFocus = () => {
      if (this.host.isPlaying()) return;
      this.focus = normalizeFocus(this.host.getPattern(), { enabled: $('focusOn').checked,
        from: +$('focusFrom').value, to: +$('focusTo').value,
        instruments: [...$('focusInstruments').querySelectorAll('input:checked')].map(e => e.value) });
      this.renderFocus(); this.host.refreshNotation(); this.renderBacking();
    };
    for (const id of ['focusOn', 'focusFrom', 'focusTo', 'focusInstruments']) $(id).onchange = changeFocus;
    for (const [id, predicate] of [['focusAll', () => true], ['focusHands', i => !['kick', 'kick2', 'hhp'].includes(i.id)], ['focusFeet', i => ['kick', 'kick2', 'hhp'].includes(i.id)]]) {
      $(id).onclick = () => { this.focus.instruments = (this.host.getInstruments?.() || INSTRUMENTS).filter(predicate).map(i => i.id); this.focus.enabled = true; this.renderFocus(); this.host.refreshNotation(); };
    }
    $('focusSuggest').onclick = async () => {
      const latest = this.sessions.find(s => patternSignature(s.pattern) === patternSignature(this.host.getPattern()));
      const suggestion = recommendFocus(latest ? await this.loadSession(latest.id) : null);
      if (!suggestion) return this.host.toast('Nema dovoljno grešaka iz ovog ritma za predlog.');
      this.focus = normalizeFocus(this.host.getPattern(), { enabled: true, from: suggestion.bar, to: suggestion.bar, instruments: [suggestion.inst] });
      this.host.setBpm(suggestion.bpm); this.renderFocus(); this.host.refreshNotation(); this.renderBacking();
      this.host.toast(`Vežbaj takt ${suggestion.bar}, ${INST[suggestion.inst].label}, na ${suggestion.bpm} BPM.`);
    };
    $('journalFilter').onchange = () => { this.journalPage = 1; this.renderJournal(); };
    $('sessionList').onclick = async e => {
      const button = e.target.closest('[data-session]'); if (!button) return;
      this.replay.stop(); this.selectedId = button.dataset.session; await this.loadSession(); this.renderJournal();
    };
    $('sessionDetail').onclick = async e => {
      if (e.target.closest('[data-replay-selected]')) { this.show('replay'); return; }
      if (e.target.closest('[data-delete-session]')) {
        if (!confirm('Obrisati ovu sesiju i njeno izvođenje?')) return;
        const list = this.sessions.filter(s => s.id !== this.selectedId);
        try { await this.journal.delete(this.selectedId); } catch { return; }
        this.sessionCache.delete(this.selectedId); this.pendingSessions.delete(this.selectedId);
        this.replay.stop(); this.sessions = list; this.selectedId = list[0]?.id || ''; this.renderJournal();
      }
    };
    $('exportJournal').onclick = async () => { try { store.download('drummer-dnevnik.json', { version: 2, sessions: await this.exportSessions() }); } catch (error) { this.host.toast(error.message); } };
    this.bindBacking(); this.bindPrograms(); this.bindReplay();
  }

  patternChanged() {
    this.focus = normalizeFocus(this.host.getPattern());
    this.renderFocus(); this.renderBacking(); this.renderJournal();
  }

  renderFocus() {
    const pattern = this.host.getPattern(); this.focus = normalizeFocus(pattern, this.focus);
    const options = Array.from({ length: pattern.bars }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    $('focusFrom').innerHTML = options; $('focusTo').innerHTML = options;
    $('focusFrom').value = this.focus.from; $('focusTo').value = this.focus.to; $('focusOn').checked = this.focus.enabled;
    $('focusInstruments').innerHTML = '<legend>Instrumenti za ocenjivanje</legend>' + (this.host.getInstruments?.() || INSTRUMENTS).map(i =>
      `<label class="tog"><input type="checkbox" value="${i.id}" ${this.focus.instruments.includes(i.id) ? 'checked' : ''}> ${esc(i.label)}</label>`).join('');
    const range = this.range;
    $('focusHint').textContent = this.focus.enabled
      ? `Taktovi ${range.from}–${range.to} · ${range.instruments.length} instrumenata. Ostali udarci se čuju i snimaju, ali ne utiču na ocenu.`
      : 'Ocenjuje se ceo ritam, sa svim instrumentima.';
    this.renderStatus(); this.playState();
  }

  renderStatus(text) {
    const range = this.range, pieces = [];
    if (this.focus.enabled) pieces.push(`Fokus: ${range.from}–${range.to} · ${range.instruments.length} instrumenata`);
    if (this.backing.enabled && this.backing.buffer) pieces.push(`Pesma: ${this.backing.name}`);
    if (text) pieces.push(text);
    $('practiceStatus').textContent = pieces.join(' / '); $('practiceStatus').hidden = !pieces.length;
  }

  playState() {
    this.host.onBusyChange?.();
    const busy = this.host.isPlaying() || !!this.run;
    for (const id of ['focusOn', 'focusFrom', 'focusTo', 'focusInstruments', 'focusAll', 'focusHands', 'focusFeet', 'focusSuggest',
      'backingFile', 'backingBpm', 'backingOffset', 'backingSpeed', 'programAdd', 'programName', 'programSelect', 'programNew', 'programSave', 'programDelete', 'programStart']) $(id).disabled = busy;
    for (const e of $('programEntries').querySelectorAll('button,input')) e.disabled = busy;
    $('backingOn').disabled = busy || !this.backing.buffer;
    $('backingRemove').disabled = busy || !this.backing.buffer;
    $('programStop').disabled = !this.run;
    $('replayPlay').disabled = busy || !this.selected;
    $('replaySession').disabled = busy;
    $('replaySeek').disabled = busy || !this.selected;
    this.arrangements?.playState();
    this.backupRestore?.playState();
  }

  beginSession(pattern, range, firstPerf, options) {
    this.replay.stop();
    this.capture = { id: store.newId(), startedAt: new Date().toISOString(), pattern: structuredClone(pattern),
      range: structuredClone(range), firstPerf, bpmStart: pattern.bpm, level: options.level, calib: options.calib,
      hits: [], expected: [], timeline: [], passes: [],
      routine: this.run ? { id: this.run.id, name: this.run.name, index: this.run.index, target: this.run.entries[this.run.index].target } : null };
  }

  recordSlot(event, bpm) {
    if (!this.capture || event.n < 0) return;
    this.capture.timeline.push({ timeMs: Math.max(0, event.perf - this.capture.firstPerf), slot: event.slot, loop: event.loop, bpm });
  }
  expect(note) {
    if (this.capture) this.capture.expected.push({ id: note.id, timeMs: Math.max(0, note.perf - this.capture.firstPerf),
      inst: note.inst, dyn: note.dyn, slot: note.slot, loop: note.loop });
  }
  hit(inst, vel, perf, source, midiNote, result, position) {
    if (!this.capture) return;
    this.capture.hits.push({ timeMs: perf - this.capture.firstPerf, inst, vel,
      source, note: midiNote ?? INST[inst].midiOut, kind: result?.kind || 'free', err: result?.err ?? null,
      expectedId: result?.note?.id || null, slot: position.slot, loop: position.loop,
      adjustedVelocity: position.adjustedVelocity ?? vel });
  }
  pass(loop, score, bpm) { this.capture?.passes.push({ loop, score, bpm }); }

  finishSession(stats, results, endPerf, reason) {
    const capture = this.capture; this.capture = null;
    if (!capture || endPerf <= capture.firstPerf) return null;
    const durationMs = endPerf - capture.firstPerf;
    const session = { ...capture, durationMs, bpmEnd: this.host.getPattern().bpm, reason, stats: compactStats(stats),
      expected: capture.expected.filter(e => e.timeMs <= durationMs),
      timeline: capture.timeline.filter(e => e.timeMs <= durationMs),
      results: results.map(r => ({ kind: r.kind, inst: r.inst, err: r.err ?? null,
        slot: r.note?.slot ?? r.slot ?? null, loop: r.note?.loop ?? r.loop ?? 0, expectedId: r.note?.id || null })) };
    delete session.firstPerf;
    this.sessions.unshift(session); this.selectedId = session.id;
    this.sessionCache.set(session.id, session); this.journalPage = 1;
    this.persistSession(session); this.renderJournal();
    if (!this.run && ['manual', 'complete', 'duration'].includes(reason)) this.show('journal');
    return session;
  }

  renderJournal() {
    const pattern = this.host.getPattern(), reference = { pattern, range: this.range, level: this.host.getLevel() };
    const data = progressFor(this.sessions, $('journalFilter').value === 'current' ? reference : null);
    const best = progressFor(this.sessions, reference).bestBpm;
    $('journalSummary').innerHTML = `<div><strong>${data.matching.length}</strong><span>sesija</span></div><div><strong>${Math.round(data.matching.reduce((sum, s) => sum + s.durationMs, 0) / 60000)}</strong><span>minuta vežbanja</span></div><div><strong>${best ?? '–'}</strong><span>najbolji BPM ≥90%, trenutni ritam i fokus</span></div>`;
    $('journalEmpty').textContent = data.matching.length ? '' : 'Pokreni vežbu. Posle Stop, ovde će se pojaviti sesija i izvođenje.';
    const pages = Math.max(1, Math.ceil(data.matching.length / this.journalPageSize));
    this.journalPage = Math.min(pages, Math.max(1, this.journalPage));
    const pageSessions = [...data.matching].reverse().slice((this.journalPage - 1) * this.journalPageSize, this.journalPage * this.journalPageSize);
    $('sessionList').innerHTML = pageSessions.map(s => `<tr class="${s.id === this.selectedId ? 'selected' : ''}"><td><button data-session="${esc(s.id)}">${patternLabel(s.pattern)}<br><small>${date(s.startedAt)}</small></button></td><td>${s.bpmStart} → ${s.bpmEnd}</td><td>${time(s.durationMs)}</td><td>${percent(s.stats?.accuracy)}</td></tr>`).join('');
    if ($('journalPageInfo')) { $('journalPageInfo').textContent = `${this.journalPage} / ${pages}`; $('journalPrev').disabled = this.journalPage <= 1; $('journalNext').disabled = this.journalPage >= pages; }
    this.drawProgress(data.daily);
    const selected = this.selected;
    if (selected) {
      const previous = this.sessions.find(s => s.id !== selected.id && s.startedAt < selected.startedAt && sessionKey(s) === sessionKey(selected));
      const delta = previous?.stats?.accuracy != null && selected.stats?.accuracy != null ? selected.stats.accuracy - previous.stats.accuracy : null;
      const compare = delta == null ? 'Nema ranije uporedive sesije.' : `Prethodna uporediva sesija: ${percent(previous.stats.accuracy)}. Promena: ${delta >= 0 ? '+' : ''}${delta} procentnih poena.`;
      const rows = Object.entries(selected.stats?.per || {}).filter(([id]) => INST[id]).map(([id, s]) => `<tr><td>${esc(INST[id].label)}</td><td>${s.good + s.ok}/${s.expected}</td><td>${s.mean == null ? '–' : `${s.mean > 0 ? '+' : ''}${Math.round(s.mean)} ms`}</td><td>${s.spread == null ? '–' : `±${Math.round(s.spread)} ms`}</td><td>${percent(s.dynamics)}</td></tr>`).join('');
      $('sessionDetail').innerHTML = `<h3>${patternLabel(selected.pattern)} · ${date(selected.startedAt)}</h3><p>${esc(compare)}</p><p class="muted">Taktovi ${selected.range.from}–${selected.range.to} · ${selected.range.instruments.length} instrumenata · ${esc(selected.level)} · ${selected.hits.length} stvarnih udaraca</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Instrument</th><th>Pogođeno</th><th>Rano/kasno</th><th>Rasipanje</th><th>Dinamika</th></tr></thead><tbody>${rows}</tbody></table></div><div class="row"><button data-replay-selected>Otvori replay</button><button data-delete-session>Obriši ovu sesiju</button></div>`;
      const report = document.createElement('section');
      report.id = 'performanceReport';
      $('sessionDetail').prepend(report);
      renderPerformanceReport(report, selected);
    } else {
      $('sessionDetail').textContent = this.selectedId ? 'Učitavam snimak sesije…' : '';
      if (this.selectedId && this.journal && !this.loadingSessionId && !this.journalError) this.loadSession().then(session => { if (session) this.renderJournal(); });
    }
    const replayPage = [...new Map([...pageSessions, ...(selected ? [selected] : [])].map(s => [s.id, s])).values()];
    $('replaySession').innerHTML = '<option value="">Izaberi snimljenu sesiju…</option>' + replayPage.map(s => `<option${s.pattern.preset ? '' : ' data-user-text'} value="${esc(s.id)}">${esc(s.pattern.name)} · ${date(s.startedAt)} · ${percent(s.stats?.accuracy)}</option>`).join('');
    $('replaySession').value = this.selectedId;
    if (!$('studio-replay').hidden) this.renderReplay();
    this.playState();
  }

  drawProgress(days) {
    const recent = days.slice(-30), width = 720 / Math.max(1, recent.length);
    $('progressChart').innerHTML = '<line x1="45" x2="780" y1="125" y2="125" stroke="#aaa"/><text x="6" y="22" font-size="12">100%</text><text x="18" y="126" font-size="12">0%</text>' + recent.map((d, i) => {
      const x = 50 + i * width, h = d.accuracy == null ? 2 : d.accuracy;
      return `<g><title>${d.day}: ${percent(d.accuracy)}, ${d.minutes.toFixed(1)} min, ${d.count} sesija</title><rect x="${x}" y="${125 - h}" width="${Math.max(2, width - 8)}" height="${Math.max(2, h)}" fill="${h >= 90 ? '#1e8e3e' : '#444'}"/><text x="${x}" y="145" font-size="10">${d.day.slice(5)}</text></g>`;
    }).join('');
  }

  bindBacking() {
    $('backingFile').onchange = async e => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      this.host.stop(); this.replay.stop(); $('backingName').textContent = 'Učitavam pesmu…';
      try {
        if (await this.backing.load(file)) {
          this.backing.bpm = this.host.getPattern().bpm; $('backingSpeed').value = '1';
          this.renderBacking();
        }
      } catch { this.host.toast('Audio fajl nije mogao da se učita. Probaj WAV ili MP3.'); this.renderBacking(); }
    };
    $('backingRemove').onclick = () => { this.backing.clear(); this.renderBacking(); };
    $('backingOn').onchange = () => { this.backing.enabled = $('backingOn').checked; if (this.backing.enabled) this.backingTempo(); this.renderBacking(); };
    $('backingBpm').onchange = () => { this.backing.bpm = Math.round(bounded($('backingBpm').value, 30, 260, 90)); this.backingTempo(); this.renderBacking(); };
    $('backingSpeed').onchange = () => { this.backingTempo(); this.renderBacking(); };
    $('backingOffset').onchange = () => { this.backing.setOffset($('backingOffset').value); this.renderBacking(); };
    $('backingVolume').oninput = () => this.backing.setVolume($('backingVolume').value);
    $('waveform').onclick = e => {
      if (this.host.isPlaying() || this.run || !this.backing.buffer) return;
      const rect = e.currentTarget.getBoundingClientRect();
      this.backing.setOffset((e.clientX - rect.left) / rect.width * this.backing.buffer.duration); this.renderBacking();
    };
  }

  backingTempo() {
    const requested = this.backing.bpm * Number($('backingSpeed').value);
    if (requested < 30 || requested > 260) {
      $('backingSpeed').value = '1'; this.host.toast('Brzina mora da zadrži tempo između 30 i 260 BPM.');
    }
    this.host.setBpm(Math.round(this.backing.bpm * Number($('backingSpeed').value)));
  }
  renderBacking() {
    $('backingName').textContent = this.backing.buffer ? `${this.backing.name} · ${time(this.backing.buffer.duration * 1000)}` : 'Još nema pesme. Audio fajl se ponovo bira posle osvežavanja stranice.';
    $('backingOn').checked = this.backing.enabled;
    $('backingBpm').value = this.backing.bpm; $('backingOffset').value = this.backing.offset.toFixed(2);
    for (const option of $('backingSpeed').options) option.disabled = this.backing.bpm * Number(option.value) < 30 || this.backing.bpm * Number(option.value) > 260;
    this.backing.draw($('waveform'), this.host.getPattern(), this.range); this.renderStatus(); this.playState();
  }

  bindPrograms() {
    const abandon = () => !this.programDirty || confirm('Odbaciti nesačuvane izmene programa?');
    $('programNew').onclick = () => { if (!abandon()) return; this.program = normalizeProgram({ name: t('Moj program') }); this.programDirty = false; this.renderPrograms(); };
    $('programSelect').onchange = e => {
      if (!abandon()) { e.target.value = this.program.id || ''; return; }
      const saved = this.programs.find(p => p.id === e.target.value);
      if (saved) { this.program = structuredClone(saved); this.programDirty = false; }
      this.renderPrograms();
    };
    $('programName').oninput = e => { this.program.name = e.target.value; this.programDirty = true; store.saveProgramDraft(this.program); };
    $('programAdd').onclick = () => {
      const pattern = structuredClone(this.host.getPattern());
      this.program.entries.push({ pattern, focus: structuredClone(this.focus), seconds: 60, bpm: pattern.bpm, target: 90, rest: 5 });
      this.programDirty = true; this.renderPrograms();
    };
    $('programEntries').onchange = e => {
      const input = e.target.closest('[data-field]'); if (!input) return;
      this.program.entries[Number(input.dataset.index)][input.dataset.field] = Number(input.value);
      this.program = normalizeProgram(this.program); this.programDirty = true; this.renderPrograms();
    };
    $('programEntries').onclick = e => {
      const b = e.target.closest('[data-program-action]'); if (!b) return;
      const i = +b.dataset.index, entries = this.program.entries;
      if (b.dataset.programAction === 'remove') entries.splice(i, 1);
      else { const j = i + (b.dataset.programAction === 'up' ? -1 : 1); if (j >= 0 && j < entries.length) [entries[i], entries[j]] = [entries[j], entries[i]]; }
      this.programDirty = true; this.renderPrograms();
    };
    $('programSave').onclick = () => {
      if (!this.program.entries.length) return this.host.toast('Dodaj bar jednu vežbu u program.');
      const program = normalizeProgram({ ...this.program, id: this.program.id || store.newId() });
      const list = [program, ...this.programs.filter(p => p.id !== program.id)];
      if (!store.savePrograms(list)) return;
      this.programs = list; this.program = structuredClone(program); this.programDirty = false;
      this.renderPrograms(); this.host.toast('Program je sačuvan.');
    };
    $('programDelete').onclick = () => {
      if (!this.program.id || !confirm(`Obrisati program „${this.program.name}“?`)) return;
      const list = this.programs.filter(p => p.id !== this.program.id);
      if (!store.savePrograms(list)) return;
      this.programs = list; this.program = normalizeProgram({ name: t('Moj program') }); this.programDirty = false; this.renderPrograms();
    };
    $('programStart').onclick = () => this.startProgram();
    $('programStop').onclick = () => { this.host.stop(); this.cancelProgram(); };
  }

  renderPrograms() {
    store.saveProgramDraft(this.programDirty ? this.program : null);
    $('programName').value = this.program.name;
    $('programSelect').innerHTML = '<option value="">Izaberi program…</option>' + this.programs.map(p => `<option data-user-text value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    $('programSelect').value = this.program.id || '';
    $('programEntries').innerHTML = this.program.entries.map((e, i) => `<li class="program-entry ${this.run?.index === i ? 'current' : ''}"><header><strong>${patternLabel(e.pattern)}</strong><div class="row"><button data-program-action="up" data-index="${i}" aria-label="Pomeri vežbu ${i + 1} gore">↑</button><button data-program-action="down" data-index="${i}" aria-label="Pomeri vežbu ${i + 1} dole">↓</button><button data-program-action="remove" data-index="${i}">Ukloni</button></div></header><div class="form-row">${[['seconds', 'Trajanje (s)', 1, 3600], ['bpm', 'BPM', 30, 260], ['target', 'Cilj (%)', 0, 100], ['rest', 'Pauza (s)', 0, 600]].map(([field, label, min, max]) => `<label>${label}<input type="number" min="${min}" max="${max}" data-field="${field}" data-index="${i}" value="${e[field]}"></label>`).join('')}</div></li>`).join('');
    if (!this.run) $('programStatus').textContent = this.program.entries.length ? `${this.program.entries.length} vežbi · ${time(this.program.entries.reduce((sum, e, i) => sum + e.seconds + (i < this.program.entries.length - 1 ? e.rest : 0), 0) * 1000)} ukupno${this.programDirty ? ' · nesačuvane izmene' : ''}` : 'Dodaj trenutni ritam da napraviš program.';
    this.playState();
  }

  async startProgram() {
    if (this.run || this.backupRestore?.running || !this.program.entries.length) return;
    this.host.stop(); this.replay.stop();
    const program = normalizeProgram(this.program), token = ++this.runToken;
    this.run = { ...structuredClone(program), id: store.newId(), token, index: 0, results: [] };
    $('programResults').innerHTML = '';
    await this.advanceProgram(token);
  }

  async startArrangement() {
    if (this.run || this.backupRestore?.running || this.host.isPlaying() || this.replay.playing || this.replay.starting) return false;
    const entries = compileArrangement(this.arrangements.draft);
    if (!entries.length) { this.host.toast('Dodaj bar jednu deonicu u aranžman.'); return false; }
    const token = ++this.runToken;
    this.run = { kind: 'arrangement', id: this.arrangements.draft.id || store.newId(), name: this.arrangements.draft.name,
      token, index: 0, entries, results: [] };
    const first = entries[0];
    if (!this.host.loadPattern(first.pattern, { program: true })) { this.cancelProgram(); return false; }
    this.focus = normalizeFocus(first.pattern); this.host.setBpm(first.bpm); this.renderFocus(); this.host.refreshNotation();
    this.arrangements.status(`${this.run.name} · ${first.name} · ${first.bars} ${t('taktova ukupno')}`);
    const started = await this.host.start({ program: true, arrangement: true, durationBars: first.bars, durationSeconds: first.durationSeconds });
    if (!started && this.run?.token === token) this.cancelProgram();
    this.playState(); return started;
  }
  peekNextSection() {
    if (this.run?.kind !== 'arrangement') return null;
    const next = this.run.entries[this.run.index + 1];
    return next ? structuredClone(next) : null;
  }
  prepareNextSection() {
    const next = this.peekNextSection(); if (!next) return null;
    this.run.index++;
    this.arrangements.status(`${this.run.name} · ${next.name} · ${next.bars} ${t('taktova ukupno')}`);
    return next;
  }

  async advanceProgram(token) {
    if (!this.run || token !== this.runToken) return;
    const entry = this.run.entries[this.run.index];
    if (!this.host.loadPattern(entry.pattern, { program: true })) { this.cancelProgram(); return; }
    this.focus = normalizeFocus(entry.pattern, entry.focus); this.host.setBpm(entry.bpm);
    this.renderFocus(); this.renderPrograms(); this.host.refreshNotation();
    const started = await this.host.start({ durationSeconds: entry.seconds, program: true });
    if (!started && this.run?.token === token) this.cancelProgram();
  }

  stopped(reason, session) {
    if (!this.run || reason === 'transition') { this.playState(); return; }
    if (reason !== 'duration') { this.cancelProgram(); return; }
    if (this.run.kind === 'arrangement') {
      this.run = null; this.arrangements.status('Aranžman je završen. Svaka deonica je sačuvana u dnevniku.');
      this.playState(); this.renderStatus(); return;
    }
    const entry = this.run.entries[this.run.index], accuracy = session?.stats?.accuracy;
    this.run.results.push({ name: entry.pattern.name, preset: entry.pattern.preset, accuracy, target: entry.target });
    $('programResults').innerHTML = this.run.results.map((r, i) => `<p class="${r.accuracy != null && r.accuracy >= r.target ? 'pass' : 'fail'}">${i + 1}. ${patternLabel(r)}: ${percent(r.accuracy)} / cilj ${r.target}% · ${r.accuracy != null && r.accuracy >= r.target ? 'cilj ostvaren' : 'ponovi vežbu'}</p>`).join('');
    if (this.run.index + 1 >= this.run.entries.length) {
      this.run = null; this.playState(); this.renderStatus(); $('programStatus').textContent = 'Program je završen. Rezultati svake vežbe su u dnevniku.'; return;
    }
    this.run.index++; this.run.restUntil = performance.now() + entry.rest * 1000;
    const token = this.runToken;
    this.breakTimer = setInterval(() => {
      if (!this.run || this.runToken !== token) { clearInterval(this.breakTimer); return; }
      const seconds = Math.max(0, Math.ceil((this.run.restUntil - performance.now()) / 1000));
      const message = `Pauza ${seconds} s · sledeća vežba ${this.run.index + 1}/${this.run.entries.length}`;
      $('programStatus').textContent = message; this.renderStatus(message);
      if (!seconds) { clearInterval(this.breakTimer); this.run.restUntil = null; this.advanceProgram(token); }
    }, 100);
    this.playState();
  }

  tick(now) {
    if (this.run && this.capture) {
      const entry = this.run.entries[this.run.index];
      const left = Math.max(0, Math.ceil(entry.seconds - (now - this.capture.firstPerf) / 1000));
      if (this.run.kind === 'arrangement') {
        this.arrangements.status(`${this.run.name} · ${entry.name} · ${left} s`); return;
      }
      const message = `${this.run.name} · vežba ${this.run.index + 1}/${this.run.entries.length} · ${left} s`;
      if ($('programStatus').textContent !== t(message)) { $('programStatus').textContent = message; this.renderStatus(message); }
    }
  }

  cancelProgram() {
    if (!this.run) return;
    if (this.run.kind === 'arrangement') this.arrangements.status('Aranžman je prekinut. Završene deonice ostaju u dnevniku.');
    this.runToken++; clearInterval(this.breakTimer); this.run = null;
    $('programStatus').textContent = 'Program je prekinut. Završene sesije ostaju u dnevniku.';
    this.playState(); this.renderStatus();
  }

  bindReplay() {
    $('replaySession').onchange = async e => { this.replay.stop(); this.selectedId = e.target.value; await this.loadSession(); this.renderReplay(); };
    $('replayPlay').onclick = async () => {
      if (!this.selected) return;
      if (this.replay.playing) { this.replay.pause(); $('replayPlay').textContent = '▶ Nastavi'; this.host.onBusyChange?.(); return; }
      this.host.stop();
      try {
        const starting = this.replay.start(this.selected, { speed: +$('replaySpeed').value, position: +$('replaySeek').value, reference: $('replayReference').checked });
        this.host.onBusyChange?.(); await starting;
        if (this.replay.playing) $('replayPlay').textContent = 'Ⅱ Pauza';
      } catch { this.host.toast('Replay nije mogao da pokrene zvuk.'); }
      finally { this.host.onBusyChange?.(); }
    };
    $('replayStop').onclick = () => this.replay.stop();
    for (const id of ['replaySpeed', 'replayReference']) $(id).onchange = () => {
      const wasPlaying = this.replay.playing; this.replay.pause();
      if (wasPlaying) $('replayPlay').click();
    };
    $('replaySeek').oninput = () => { this.replay.pause(); this.host.onBusyChange?.(); $('replayPlay').textContent = '▶ Nastavi'; this.replayPosition(+$('replaySeek').value); };
    $('replayPass').onchange = () => this.drawReplay();
    $('replayMidi').onclick = () => { if (this.selected) store.downloadBlob('drummer-izvodjenje.mid', new Blob([performanceMidi(this.selected)], { type: 'audio/midi' })); };
    $('replayJson').onclick = () => { if (this.selected) store.download('drummer-sesija.json', this.selected); };
  }

  renderReplay() {
    const session = this.selected;
    for (const id of ['replayPlay', 'replayStop', 'replayMidi', 'replayJson', 'replaySeek']) $(id).disabled = !session;
    $('replaySession').value = this.selectedId;
    $('replaySeek').max = Math.max(1, session?.durationMs || 1); $('replaySeek').value = 0;
    const loops = [...new Set((session?.timeline || []).map(e => e.loop))];
    $('replayPass').innerHTML = '<option value="all">Svi prolazi</option>' + loops.map(loop => `<option value="${loop}">Prolaz ${loop + 1}</option>`).join('');
    if (session?.hits.length > 2000 && loops.length) $('replayPass').value = String(loops[0]);
    this.drawReplay(); this.replayPosition(0); this.playState();
  }

  drawReplay() {
    const session = this.selected;
    if (!session) { $('replayChart').innerHTML = ''; $('replayHits').innerHTML = ''; return; }
    const pass = $('replayPass').value, loop = Number(pass), total = Math.max(1, session.durationMs);
    const start = pass === 'all' ? 0 : session.timeline.find(e => e.loop === loop)?.timeMs || 0;
    const end = pass === 'all' ? total : session.timeline.find(e => e.loop === loop + 1)?.timeMs || total;
    this.replayWindow = { start, end: Math.max(start + 1, end) };
    const x = ms => 140 + 840 * (ms - start) / (Math.max(1, end - start));
    const rows = INSTRUMENTS.filter(i => !i.optional || session.hits.some(h => h.inst === i.id) || session.expected.some(e => e.inst === i.id));
    const chartBottom = 42 + rows.length * 26;
    $('replayChart').setAttribute('viewBox', `0 0 1000 ${chartBottom + 20}`);
    const y = id => 32 + rows.findIndex(i => i.id === id) * 26;
    const within = ms => ms >= start && ms <= end;
    const missed = new Set(session.results.filter(r => r.kind === 'miss').map(r => r.expectedId));
    let html = rows.map(i => `<text x="6" y="${y(i.id) + 4}" font-size="12">${esc(i.label)}</text><line x1="140" x2="980" y1="${y(i.id)}" y2="${y(i.id)}" stroke="#ddd"/>`).join('');
    html += session.expected.filter(e => within(e.timeMs)).slice(0, 2000).map(e => `<line x1="${x(e.timeMs)}" x2="${x(e.timeMs)}" y1="${y(e.inst) - 9}" y2="${y(e.inst) + 9}" stroke="#aaa" stroke-width="3"/>${missed.has(e.id) ? `<circle cx="${x(e.timeMs)}" cy="${y(e.inst)}" r="7" fill="none" stroke="#d93025"/>` : ''}`).join('');
    const hits = session.hits.filter(h => within(h.timeMs));
    html += hits.slice(0, 2000).map(h => `<circle cx="${x(h.timeMs)}" cy="${y(h.inst)}" r="${3 + h.vel / 50}" fill="${({ good: '#1e8e3e', ok: '#888', extra: '#d93025', free: '#111' })[h.kind] || '#111'}"><title>${esc(INST[h.inst].label)} · ${h.timeMs.toFixed(1)} ms · ${h.vel} · ${h.err == null ? 'bez ocene' : `${h.err.toFixed(1)} ms`}</title></circle>`).join('');
    if (hits.length > 2000) html += `<text x="140" y="14" font-size="12">${t('Graf prikazuje prvih 2000 udaraca. Izaberi pojedinačni prolaz za detalje.')}</text>`;
    html += `<text x="140" y="${chartBottom}" font-size="12">${time(start)}</text><text x="940" y="${chartBottom}" font-size="12">${time(end)}</text><line id="replayCursor" x1="140" x2="140" y1="12" y2="${chartBottom - 20}" stroke="#d93025"/>`;
    $('replayChart').innerHTML = html;
    $('replayHits').innerHTML = hits.slice(0, 200).map(h => `<tr><td>${(h.timeMs / 1000).toFixed(3)} s</td><td>${esc(INST[h.inst].label)}</td><td>${h.note}</td><td>${h.vel}</td><td>${h.err == null ? '–' : `${h.err > 0 ? '+' : ''}${h.err.toFixed(1)} ms`}</td></tr>`).join('') + (hits.length > 200 ? '<tr><td colspan="5">Tabela prikazuje prvih 200 udaraca ovog prikaza. Izvoz sadrži sve.</td></tr>' : '');
    this.replayPosition(+$('replaySeek').value);
  }

  replayPosition(ms) {
    $('replaySeek').value = ms;
    $('replayTime').textContent = `${time(ms)} / ${time(this.selected?.durationMs || 0)}`;
    const cursor = $('replayCursor'), window = this.replayWindow;
    if (cursor && window) {
      const x = 140 + 840 * bounded((ms - window.start) / (window.end - window.start), 0, 1, 0);
      cursor.setAttribute('x1', x); cursor.setAttribute('x2', x);
    }
  }
}
