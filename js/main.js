import {
  INSTRUMENTS, INST, DYN_VEL, PRESETS, blankPattern, normalize, resize, patternInfo,
  slotsPerBeat, slotsPerBar, totalSlots, beatMs, slotOffsetMs, slotDurationMs, slotAtMs, groupStarts,
} from './patterns.js';
import { renderNotation } from './notation.js';
import { createKitView } from './kit-view.js';
import { AudioEngine } from './audio.js';
import { MidiInput } from './midi.js';
import { Scorer, LEVELS } from './scoring.js';
import * as store from './storage.js';
import { PracticeStudio } from './studio.js';
import { practiceRange, acceptsInstrument, bounded, compactStats } from './practice.js';
import { DeviceProfiles, velocityFor } from './profiles.js';
import { Workbench } from './workbench.js';
import { setupPwa } from './pwa.js';
import { initI18n, getLanguage, t } from './i18n.js';
import { WorkspaceView } from './workspace-view.js';
import { PRESET_CATEGORIES, filterPresets } from './preset-catalog.js';
import { setupAgentTools, ToolError } from './agent-tools.js';
import { normalizeKit, kitInstruments, missingKitInstruments } from './kit-config.js';
import { KitConfigurator } from './kit-config-ui.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const settings = store.loadSettings({
  metro: true, clickSub: 1, countIn: true, loop: true, playPattern: false, liveSound: false, record: false,
  calib: 0, level: 'normalno', quiet: 'off', midiOut: '', kit: '',
  vol: { click: 0.7, pattern: 0.6, live: 0.9 },
  trainer: { on: false, step: 2 },
  current: null,
  profileId: '', velocityCurve: 'linear', velocityGain: 1,
});
settings.record = false;
settings.kitConfig = normalizeKit(settings.kitConfig);
settings.level = LEVELS[settings.level] ? settings.level : 'normalno';
settings.calib = bounded(settings.calib, -1000, 1000, 0);
for (const bus of ['click', 'pattern', 'live']) settings.vol[bus] = bounded(settings.vol[bus], 0, 1, .7);
settings.trainer.step = Math.round(bounded(settings.trainer.step, 1, 10, 2));
settings.velocityCurve = ['linear', 'soft', 'hard'].includes(settings.velocityCurve) ? settings.velocityCurve : 'linear';
settings.velocityGain = bounded(settings.velocityGain, .5, 2, 1);
const saveSettings = debounce(() => store.saveSettings(settings), 200);
store.setErrorHandler(() => {
  $('#storageWarning').hidden = false;
  toast('Čuvanje nije uspelo. Izvezi kopiju podataka ili pokušaj ponovo.');
});

const audio = new AudioEngine();
for (const [k, v] of Object.entries(settings.vol)) audio.setVolume(k, v);
const scorer = new Scorer();
const midi = new MidiInput({ onHit, onStatus, onNote, onPedal: v => kit.pedal(v), onChoke: id => audio.choke(id) });
midi.outId = settings.midiOut;

let library = store.loadLibrary();
let favorites = new Set(store.loadFavorites());
const libraryPages = { mine: 1, presets: 1 }, PAGE_SIZE = 12;
settings.favoritesOnly = settings.favoritesOnly === true;
let pattern = normalize(settings.current || structuredClone(PRESETS[0]));
let dirty = false;
let notation, kit, studio, profiles, workbench, workspaceView, agentTools, configurator;
let edCells = [];
let calibration = null;

const play = { on: false, starting: false, token: 0, n: 0, nextTime: 0, timer: 0, queue: [], cur: null, firstAudio: null,
  countIn: 0, endAt: 0, firstPerf: 0, exerciseEndPerf: 0, durationSeconds: 0,
  loopScores: [], loopBpms: new Map(), completed: new Set(), boundaries: [], range: null, nowCol: -1 };
const slotMs = (slot = 0) => slotDurationMs(pattern, slot);
const positionAt = perf => {
  const cur = play.cur;
  if (!cur) return -play.countIn;
  const timed = { ...pattern, bpm: cur.bpm || pattern.bpm };
  return slotAtMs(timed, slotOffsetMs(timed, cur.n) + perf - cur.perf);
};
const activeRange = () => play.on && play.range ? play.range : practiceRange(pattern, studio?.focus);
const repeats = () => settings.loop || play.durationSeconds > 0;
const lateGrace = () => Math.max(300, settings.calib + LEVELS[settings.level][1] + 25);
// Anchor the musical timeline once, at the first note. Re-sampling the output
// clock on every step can shift expected times while the audio device warms up.
const perfForAudio = time => play.on && play.firstAudio != null ? play.firstPerf + (time - play.firstAudio) * 1000 : audio.ctxToPerf(time);

// ---------- Sviranje ----------

async function start(options = {}) {
  if (play.on || play.starting) return false;
  if (missingKitInstruments(pattern, settings.kitConfig).length) { toast('Ritam koristi delove koji nisu u tvom setu. Uključi ih u Moj bubanj ili izmeni ritam.'); return false; }
  if (calibration) { toast('Sačekaj da se kalibracija završi.'); return false; }
  if (!options.program) studio?.cancelProgram();
  const token = ++play.token;
  play.starting = true; renderTransport();
  try {
    const range = practiceRange(pattern, studio?.focus);
    if (!range.instruments.length) throw new Error('Izaberi bar jedan instrument za vežbanje.');
    studio?.backing.validate(pattern, range);
    await audio.ensure();
    if (token !== play.token) return false;
    showLatency(); scorer.reset(); scorer.currentLoop = 0;
    scorer.level = settings.level; scorer.calib = settings.calib; notation.clearMarks();
    Object.assign(play, { on: true, queue: [], cur: null, firstAudio: null, endAt: 0, loopScores: [], range,
      completed: new Set(), loopBpms: new Map(), boundaries: [], durationSeconds: Number(options.durationSeconds) || 0 });
    play.countIn = settings.countIn ? slotsPerBar(pattern) : 0;
    play.n = -play.countIn; play.nextTime = audio.time + 0.15;
    play.firstPerf = audio.ctxToPerf(play.nextTime + play.countIn / slotsPerBeat(pattern) * beatMs(pattern) / 1000);
    play.exerciseEndPerf = play.durationSeconds ? play.firstPerf + play.durationSeconds * 1000 : 0;
    studio?.beginSession(pattern, range, play.firstPerf, settings);
    play.timer = setInterval(schedule, 25); schedule(); renderStats();
    return true;
  } catch (error) { if (play.on) stop('error'); toast(error.message || 'Zvuk nije mogao da se pokrene.'); return false; }
  finally { if (token === play.token) { play.starting = false; renderTransport(); } }
}

function stop(reason = 'manual') {
  play.token++; play.starting = false;
  if (!play.on) { studio?.stopped(reason, null); renderTransport(); return; }
  const now = performance.now();
  const endPerf = ['complete', 'duration'].includes(reason) && play.exerciseEndPerf ? Math.min(now, play.exerciseEndPerf) : now;
  play.on = false;
  clearInterval(play.timer);
  // Ne ocenjuj note zakazane unapred koje se nisu ni čule pre Stop.
  scorer.pending = scorer.pending.filter(n => n.perf <= endPerf);
  for (const r of scorer.sweep(Infinity)) notation.mark(r.note.slot, r.inst, 'miss', r.note.loop);
  for (const boundary of play.boundaries) if (boundary.perf <= endPerf) finishLoop(boundary.loop, false);
  audio.stopScheduled(); midi.stopOutput(); studio?.backing.stop();
  play.queue = []; play.boundaries = [];
  notation.setPlayhead(null);
  $('#countOverlay').hidden = true;
  setNowColumn(-1);
  renderTransport(); renderStats();
  const session = studio?.finishSession(scorer.stats(), scorer.results, endPerf, reason);
  studio?.stopped(reason, session);
}

const toggle = () => (play.on || play.starting ? stop() : start());

function schedule() {
  const total = play.range.length;
  while (play.on && play.nextTime < audio.time + 0.12) {
    const nextPerf = perfForAudio(play.nextTime);
    if ((!repeats() && play.n >= total) || (play.durationSeconds && nextPerf >= play.exerciseEndPerf)) {
      if (!play.exerciseEndPerf) play.exerciseEndPerf = nextPerf;
      if (!play.endAt) play.endAt = play.exerciseEndPerf + lateGrace();
      return;
    }
    scheduleSlot(play.n, play.nextTime);
    play.nextTime += slotMs(play.n) / 1000;
    play.n++;
  }
}

function clickStep() {
  const spb = slotsPerBeat(pattern);
  return spb % settings.clickSub === 0 ? spb / settings.clickSub : spb;
}

function quietBar(b) {
  if (settings.quiet === 'alt') return b % 2 === 1;
  if (settings.quiet === '2of4') return b % 4 >= 2;
  return false;
}

function scheduleSlot(n, t) {
  const range = activeRange();
  const spb = slotsPerBeat(pattern), spBar = slotsPerBar(pattern), total = range.length;
  const perf = perfForAudio(t);
  if (n < 0) {
    const k = n + play.countIn;
    if (k % spb === 0) {
      audio.click(t, groupStarts(pattern).includes(k / spb));
      play.queue.push({ perf, n, count: k / spb + 1, bpm: pattern.bpm });
    }
    return;
  }
  const loop = Math.floor(n / total), slot = range.start + n % total, inBar = slot % spBar;
  if (n === 0 && play.on) {
    play.firstAudio = t;
    play.firstPerf = perf;
    if (play.durationSeconds) play.exerciseEndPerf = perf + play.durationSeconds * 1000;
    if (studio?.capture) studio.capture.firstPerf = perf;
  }
  if (n % total === 0) {
    play.loopBpms.set(loop, pattern.bpm);
    studio?.backing.schedule(t, pattern, range);
  }
  if (settings.metro && !quietBar(Math.floor(n / spBar))) {
    if (inBar % spb === 0) audio.click(t, groupStarts(pattern).includes(inBar / spb));
    else if (inBar % clickStep() === 0) audio.click(t, false, 0.4);
  }
  const insts = [];
  for (const inst of INSTRUMENTS) {
    const v = pattern.steps[inst.id][slot];
    if (!v) continue;
    insts.push(inst.id);
    if (settings.playPattern && !midi.send(inst.midiOut, DYN_VEL[v], perf)) audio.play(inst.id, t, DYN_VEL[v] / 127, 'pattern');
    if (acceptsInstrument(range, inst.id)) {
      const note = { id: `${loop}:${slot}:${inst.id}`, perf, inst: inst.id, dyn: v, slot, loop, durationMs: slotMs(slot) };
      scorer.expect(note); studio?.expect(note);
    }
  }
  const event = { perf, n, slot, loop, insts, bpm: pattern.bpm };
  play.queue.push(event); studio?.recordSlot(event, pattern.bpm);
  if (n % total === total - 1) play.boundaries.push({ loop, perf: perf + slotMs(n) });
}

function reach(ev) {
  play.cur = ev;
  const overlay = $('#countOverlay');
  if (ev.count) {
    overlay.hidden = false;
    overlay.textContent = ev.count;
    return;
  }
  overlay.hidden = true;
  const spBar = slotsPerBar(pattern);
  if (ev.slot % spBar === 0) notation.clearBar(Math.floor(ev.slot / spBar), ev.loop);
  notation.flashSlot(ev.slot);
  for (const id of ev.insts) kit.pulse(id);
  setNowColumn(ev.slot);
}

function frame() {
  requestAnimationFrame(frame);
  if (!play.on) return;
  const now = performance.now();
  while (play.queue.length && play.queue[0].perf <= now) reach(play.queue.shift());
  const cur = play.cur;
  if (!cur) return;
  const range = play.range, total = range.length;
  const nf = positionAt(now);
  if (cur.n >= 0) notation.setPlayhead(range.start + Math.min(total - 0.01, (cur.n % total) + Math.min(1, nf - cur.n)));
  for (const r of scorer.sweep(now)) {
    notation.mark(r.note.slot, r.inst, 'miss', r.note.loop);
    kit.hit(r.inst, 'miss');
  }
  while (play.boundaries.length && play.boundaries[0].perf + lateGrace() <= now) finishLoop(play.boundaries.shift().loop);
  studio?.tick(now);
  if (play.endAt && now > play.endAt) stop(play.durationSeconds ? 'duration' : 'complete');
}

function finishLoop(loop, train = true) {
  if (play.completed.has(loop)) return;
  const s = scorer.loopScore(loop);
  if (s == null) return;
  play.completed.add(loop);
  play.loopScores.push(s);
  studio?.pass(loop, s, play.loopBpms.get(loop) || pattern.bpm);
  renderStats();
  if (train && !studio?.backing.enabled && !studio?.run && settings.trainer.on && s >= 90 && pattern.bpm < 260) {
    setBpm(pattern.bpm + settings.trainer.step);
    toast(`Prolaz ${s}%: tempo podignut na ${pattern.bpm} BPM`);
  }
}

// ---------- Udarci ----------

function onHit(instId, vel, perf, source = 'keyboard', midiNote) {
  if (!kitInstruments(settings.kitConfig).some(i => i.id === instId)) return;
  const rawVelocity = vel;
  vel = velocityFor(vel, settings.velocityCurve, settings.velocityGain);
  // Virtual pads must be audible even when MIDI monitoring is off (a common
  // setting when the connected module already produces its own sound).
  if ((settings.liveSound && !calibration) || source === 'mouse') {
    if (audio.ready) audio.playNow(instId, vel / 127);
    else audio.ensure().then(() => audio.playNow(instId, vel / 127)).catch(() => toast('Zvuk nije dostupan.'));
  }
  if (calibration) {
    if (instId === 'snare') calibration.hits.push(perf);
    kit.hit(instId, 'free');
    return;
  }
  let res = null;
  if (play.on && perf - settings.calib >= play.firstPerf && (!play.exerciseEndPerf || perf - settings.calib <= play.exerciseEndPerf + LEVELS[settings.level][1])) {
    scorer.currentLoop = Math.max(0, play.cur?.loop ?? 0);
    if (acceptsInstrument(play.range, instId)) res = scorer.hit(instId, perf, vel);
    const total = play.range.length;
    let s = null, loop = scorer.currentLoop;
    if (res?.note) {
      const off = Math.max(-0.45, Math.min(0.45, res.err / (res.note.durationMs || slotMs(res.note.slot))));
      s = Math.max(play.range.start, Math.min(play.range.end - 0.01, res.note.slot + off));
      loop = res.note.loop;
    } else if (play.cur) {
      const nf = positionAt(perf - settings.calib);
      if (nf >= 0) { s = play.range.start + nf % total; loop = Math.floor(nf / total); }
    }
    if (res?.kind === 'extra') { res.slot = s == null ? play.range.start : Math.floor(s); res.loop = loop; }
    if (s != null && res) notation.mark(s, instId, res.kind, loop);
    studio?.hit(instId, rawVelocity, perf, source, midiNote, res, { slot: s, loop, adjustedVelocity: vel });
    if (settings.record) recordHit(instId, vel, perf);
  }
  kit.hit(instId, res ? res.kind : 'free');
  showLastHit(instId, vel, res);
}

function recordHit(instId, vel, perf) {
  if (!play.cur) return;
  const nf = positionAt(perf - settings.calib);
  const k = Math.round(nf);
  if (k < 0) return;
  if (!repeats() && k >= play.range.length) return;
  pattern.steps[instId][play.range.start + k % play.range.length] = vel >= 108 ? 3 : vel <= 45 ? 1 : 2;
  markDirty();
  rerender();
}

const fmtErr = err => (Math.abs(err) < 3 ? 'tačno' : err < 0 ? `${Math.round(-err)} ms rano` : `${Math.round(err)} ms kasno`);

function showLastHit(instId, vel, res) {
  const el = $('#lastHit');
  let txt = `${INST[instId].label} · jačina ${vel}`;
  if (res) txt += res.kind === 'extra' ? ' · višak' : ` · ${fmtErr(res.err)}`;
  el.textContent = txt;
  el.className = 'lasthit ' + (res ? res.kind : 'free');
}

const KEYMAP = {};
for (const inst of INSTRUMENTS) for (const k of inst.keys) KEYMAP[k] = inst.id;

document.addEventListener('keydown', e => {
  const typing = e.target instanceof Element && e.target.matches('input[type=text], input[type=search], input[type=number], select, textarea');
  if (typing) return;
  if (e.code === 'Space') {
    if (e.target instanceof Element && e.target.matches('button, input[type=checkbox], input[type=file], a')) return;
    e.preventDefault();
    if (e.repeat) return;
    document.activeElement?.blur();
    toggle();
    return;
  }
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    if (e.target instanceof Element && e.target.matches('input[type=range]')) return;
    e.preventDefault();
    setBpm(pattern.bpm + (e.code === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 1));
    return;
  }
  if (e.repeat || e.metaKey || e.ctrlKey) return;
  const inst = KEYMAP[e.code];
  if (!inst) return;
  e.preventDefault();
  if (!audio.ready) audio.ensure().catch(() => toast('Zvuk nije dostupan.'));
  onHit(inst, e.shiftKey ? 122 : e.altKey ? 38 : 92, e.timeStamp);
});

// ---------- MIDI ----------

let midiOutputs = [];
function onStatus(st) {
  const box = $('#midiStatus');
  box.className = 'status ' + (st.ok ? 'on' : 'off');
  box.querySelector('.txt').textContent = st.ok ? st.text : 'Bez bubnja: sviraj tasterima';
  box.title = st.text;
  $('#midiInfo').textContent = st.ok ? `Povezano: ${st.text}` : st.text;
  midiOutputs = st.outputs || [];
  profiles?.devices(st.inputs);
  renderMidiOut();
}

function onNote(note, vel) {
  const inst = midi.map[note];
  $('#lastNote').textContent = `${note} (jačina ${vel})${INST[inst] ? ' → ' + INST[inst].label : ' → nije mapirana'}`;
}

// ---------- Prikaz ----------

function renderAll() {
  renderHeader();
  renderTransport();
  renderNotationView();
  renderEditorControls();
  if (!$('#view-editor').hidden) renderEditor();
  renderLibrary();
}

function renderHeader() {
  $('#patternName').toggleAttribute('data-user-text', !pattern.preset);
  $('#patternName').textContent = pattern.name + (dirty ? ' •' : '');
  $('#patternName').title = dirty ? 'Ima nesačuvanih izmjena' : '';
  $('#patternInfo').textContent = patternInfo(pattern);
  $('#patternLesson').textContent = typeof pattern.lesson === 'string' ? pattern.lesson : '';
}

function renderNotationView() {
  notation = renderNotation($('#notation'), pattern, workspaceView?.notationOptions(pattern) || { maxHeight: Infinity });
  if (studio?.focus.enabled) for (const head of $$('#notation .head')) {
    head.classList.toggle('out-of-focus', !acceptsInstrument(studio.range, head.dataset.inst));
  }
}

const rerender = debounce(() => {
  renderNotationView();
  if (!$('#view-editor').hidden) syncGrid();
  renderHeader();
}, 120);

function renderTransport() {
  const b = $('#playBtn');
  b.textContent = play.starting ? '■ Otkaži' : play.on ? '■ Stop' : '▶ Start';
  b.classList.toggle('playing', play.on || play.starting);
  $('#bpm').value = pattern.bpm;
  for (const id of ['metro', 'countIn', 'loop', 'playPattern', 'liveSound', 'record']) $('#' + id).checked = settings[id];
  renderClickSub();
  const busy = play.on || play.starting;
  for (const el of $$('#view-editor input, #view-editor select, #view-editor button, #calibBtn, #resetStats, #level, #calib')) el.disabled = busy;
  for (const el of $$('#bpm, .tbtn, #trainerOn')) el.disabled = busy && !!(studio?.backing.enabled || studio?.run);
  studio?.playState();
  profiles?.playState();
  configurator?.playState();
  kit?.playState();
  workbench?.playState();
  $('#edSwing').disabled = busy || pattern.division === 12;
}

function renderClickSub() {
  const opts = pattern.beatUnit === 8
    ? (pattern.division === 12 ? [[1, 'Klik: osmine'], [3, 'Klik: triole']] : [[1, 'Klik: osmine'], [2, 'Klik: šesnaestine']])
    : pattern.division === 12 ? [[1, 'Klik: četvrtine'], [3, 'Klik: triole']]
    : [[1, 'Klik: četvrtine'], [2, 'Klik: osmine'], [4, 'Klik: šesnaestine']];
  if (!opts.some(([v]) => v === settings.clickSub)) settings.clickSub = 1;
  $('#clickSub').innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('#clickSub').value = settings.clickSub;
}

function setBpm(v) {
  if (play.on && (studio?.backing.enabled || studio?.run)) return;
  pattern.bpm = Math.min(260, Math.max(30, Math.round(Number(v) || pattern.bpm)));
  settings.current = pattern;
  saveSettings();
  $('#bpm').value = pattern.bpm;
  renderHeader();
  studio?.renderBacking();
}

function markDirty() {
  dirty = true;
  settings.current = pattern;
  saveSettings();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- Editor ----------

const NEXT = [2, 0, 3, 1];

function renderEditorControls() {
  $('#edName').value = pattern.preset ? t(pattern.name) : pattern.name;
  $('#edBars').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option>${n}</option>`).join('');
  $('#edBeats').innerHTML = [2, 3, 4, 5, 6, 7].map(n => `<option>${n}</option>`).join('');
  $('#edBars').value = pattern.bars;
  $('#edBeats').value = pattern.beats;
  $('#edDiv').value = pattern.division;
  $('#edUnit').value = pattern.beatUnit;
  $('#edSwing').value = pattern.swing;
  $('#edSwing').disabled = pattern.division === 12 || play.on || play.starting;
  $('#edGroups').value = pattern.groups.join('+');
  $('#edSticking').value = pattern.sticking || '';
}

function renderEditor() {
  const grid = $('#grid');
  const total = totalSlots(pattern), spb = slotsPerBeat(pattern), spBar = slotsPerBar(pattern);
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `132px repeat(${total}, minmax(19px, 1fr))`;
  edCells = Array.from({ length: total }, () => []);
  const div = (cls, text = '') => Object.assign(document.createElement('div'), { className: cls, textContent: text });
  const subs = spb === 4 ? ['', 'e', '&', 'a'] : spb === 2 ? ['', '&'] : ['', '&', 'a'];
  grid.append(div('corner'));
  for (let s = 0; s < total; s++) {
    const inBar = s % spBar, k = inBar % spb;
    const c = div('count' + (k === 0 ? ' beat' : '') + (inBar === 0 ? ' barstart' : ''), k === 0 ? String(inBar / spb + 1) : subs[k]);
    grid.append(c);
    edCells[s].push(c);
  }
  for (const inst of INSTRUMENTS.filter(i => kitInstruments(settings.kitConfig).some(a => a.id === i.id) || pattern.steps[i.id].some(Boolean))) {
    const lab = div('rowlabel');
    lab.innerHTML = `<i style="background:${inst.color}"></i>${esc(inst.label)}`;
    grid.append(lab);
    for (let s = 0; s < total; s++) {
      const b = document.createElement('button');
      b.className = 'cell' + (s % spb === 0 ? ' beat' : '') + (s % spBar === 0 ? ' barstart' : '');
      b.style.setProperty('--c', inst.color);
      b.dataset.inst = inst.id;
      b.dataset.slot = s;
      b.dataset.v = pattern.steps[inst.id][s];
      b.title = `${inst.label} · takt ${Math.floor(s / spBar) + 1}, korak ${(s % spBar) + 1}`;
      grid.append(b);
      edCells[s].push(b);
    }
  }
  play.nowCol = -1;
}

function syncGrid() {
  if (edCells.length !== totalSlots(pattern)) return renderEditor();
  for (const b of $$('#grid .cell')) b.dataset.v = pattern.steps[b.dataset.inst][b.dataset.slot];
}

function setCell(b, v) {
  pattern.steps[b.dataset.inst][b.dataset.slot] = v;
  b.dataset.v = v;
  if (v && !play.on) audio.ensure().then(() => audio.play(b.dataset.inst, audio.time, DYN_VEL[v] / 127, 'pattern'));
  markDirty();
  rerender();
}

function setNowColumn(slot) {
  if ($('#view-editor').hidden) return;
  for (const c of edCells[play.nowCol] || []) c.classList.remove('now');
  for (const c of edCells[slot] || []) c.classList.add('now');
  play.nowCol = slot;
}

function changeStructure(changes) {
  if (play.on || play.starting) stop();
  pattern = resize(pattern, changes);
  studio?.patternChanged();
  markDirty();
  renderAll();
}

// ---------- Biblioteka ----------

const favoriteCount = () => [...PRESETS, ...library].filter(p => favorites.has(p.id)).length;
function setFavorite(id, selected) {
  const next = new Set(favorites);
  selected ? next.add(id) : next.delete(id);
  if (!store.saveFavorites([...next])) return false;
  favorites = next;
  renderLibrary();
  return true;
}

function renderLibraryPage(list, id, own) {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const page = libraryPages[id] = Math.min(pages, Math.max(1, libraryPages[id]));
  const start = (page - 1) * PAGE_SIZE, end = Math.min(start + PAGE_SIZE, list.length);
  const target = $('#' + id); target.replaceChildren();
  for (const p of list.slice(start, end)) target.append(libraryItem(p, own));
  $('#' + id + 'Pager').hidden = pages <= 1;
  $('#' + id + 'Prev').disabled = page === 1;
  $('#' + id + 'Next').disabled = page === pages;
  $('#' + id + 'PageInfo').textContent = `Stranica ${page} / ${pages}`;
  return { start: list.length ? start + 1 : 0, end };
}

function renderLibrary() {
  const count = favoriteCount(), only = settings.favoritesOnly;
  $('#favoritesOnly').setAttribute('aria-pressed', String(only));
  $('#favoriteCount').textContent = count;
  $('#favoritesEmpty').hidden = !only || count > 0;
  const mine = library.filter(p => !only || favorites.has(p.id));
  renderLibraryPage(mine, 'mine', true);
  if (!mine.length) $('#mine').innerHTML = `<li class="empty muted">${only && library.length ? 'Nema sačuvanih ritmova u favoritima.' : 'Još nema sačuvanih ritmova.'}</li>`;
  const filtered = filterPresets(PRESETS, $('#presetCategory').value, $('#presetSearch').value).filter(p => !only || favorites.has(p.id));
  const range = renderLibraryPage(filtered, 'presets', false);
  $('#presetCount').textContent = `Prikazano: ${range.start}–${range.end} / ${filtered.length}`;
  $('#presetEmpty').hidden = filtered.length > 0 || (only && count === 0);
}

function libraryItem(p, own) {
  const li = document.createElement('li');
  li.className = 'item' + (p.id === pattern.id ? ' active' : '');
  const load = document.createElement('button');
  load.className = 'load';
  load.innerHTML = `<span${own ? ' data-user-text' : ''}>${esc(p.name)}</span><small>${esc(patternInfo(p))}</small>`;
  if (!own) {
    const meta = document.createElement('small'); meta.className = 'preset-meta';
    meta.textContent = [PRESET_CATEGORIES.find(c => c.id === (p.category || 'basics'))?.label, p.difficulty].filter(Boolean).join(' · ');
    load.append(meta); load.dataset.presetId = p.id;
  }
  load.onclick = () => loadPattern(p);
  li.append(load);
  const favorite = document.createElement('button');
  favorite.className = 'favorite'; favorite.dataset.patternId = p.id;
  favorite.dataset.userText = '';
  favorite.textContent = favorites.has(p.id) ? '★' : '☆';
  favorite.setAttribute('aria-pressed', String(favorites.has(p.id)));
  favorite.title = favorite.ariaLabel = `${t(favorites.has(p.id) ? 'Ukloni iz favorita' : 'Dodaj u favorite')}: ${own ? p.name : t(p.name)}`;
  favorite.onclick = () => {
    const hadFocus = document.activeElement === favorite;
    setFavorite(p.id, !favorites.has(p.id));
    if (hadFocus) ($$('.favorite').find(b => b.dataset.patternId === p.id) || $('#favoritesOnly')).focus({ preventScroll: true });
  };
  li.append(favorite);
  if (own) {
    const acts = document.createElement('div');
    acts.className = 'acts';
    const btn = (label, fn) => Object.assign(document.createElement('button'), { textContent: label, onclick: fn });
    acts.append(
      btn('Dupliraj', () => {
        const list = [...library];
        list.splice(library.indexOf(p) + 1, 0, { ...structuredClone(p), id: store.newId(), name: p.name + t(' (kopija)') });
        if (!store.saveLibrary(list)) return;
        library = list;
        renderLibrary();
      }),
      btn('Izvezi', () => store.download(fileName(p.name), p)),
      btn('Obriši', () => {
        if (!confirm(`Obrisati ritam „${p.name}"?`)) return;
        const list = library.filter(x => x !== p);
        if (!store.saveLibrary(list)) return;
        library = list;
        if (favorites.has(p.id)) setFavorite(p.id, false);
        renderLibrary();
      }),
    );
    li.append(acts);
  }
  return li;
}

const fileName = name => (String(name).toLowerCase().replace(/[^a-z0-9šđčćž]+/g, '-').replace(/^-|-$/g, '') || 'ritam') + '.json';

function loadPattern(p, { program = false } = {}) {
  if (dirty && !confirm('Trenutni ritam ima nesačuvane izmjene. Da ih odbaciš?')) return false;
  stop(program ? 'transition' : 'load');
  studio?.replay.stop();
  pattern = normalize(structuredClone(p));
  dirty = false;
  settings.current = pattern;
  saveSettings();
  studio?.patternChanged();
  renderAll();
  return true;
}

function saveCurrent(asNew) {
  const own = library.find(p => p.id === pattern.id);
  let candidate = structuredClone(pattern);
  const list = [...library];
  if (asNew || !own) {
    const name = prompt('Naziv ritma:', own ? pattern.name + t(' (kopija)') : pattern.name);
    if (!name?.trim()) return;
    candidate = { ...candidate, id: store.newId(), name: name.trim(), preset: false };
    list.unshift(candidate);
  } else {
    list[library.indexOf(own)] = candidate;
  }
  if (!store.saveLibrary(list)) { markDirty(); renderHeader(); return; }
  library = list; pattern = structuredClone(candidate);
  if (asNew || !own) libraryPages.mine = 1;
  dirty = false;
  settings.current = pattern;
  saveSettings();
  renderAll();
  toast(`Sačuvano: ${pattern.name}`);
}

// ---------- Rezultat ----------

function renderStats() {
  const s = scorer.stats();
  $('#accuracy').textContent = s.accuracy == null ? '–' : s.accuracy + '%';
  $('#counts').innerHTML =
    `<span class="good">${s.all.good} tačno</span><span class="ok">${s.all.ok} skoro</span>` +
    `<span class="miss">${s.all.miss} promašeno</span><span class="extra">${s.all.extra} višak</span>`;
  $('#loopBars').innerHTML = play.loopScores.slice(-30)
    .map((v, i) => `<i style="height:${Math.max(4, v)}%" class="${v >= 90 ? 'good' : v >= 70 ? 'ok' : 'miss'}" title="Prolaz ${i + 1}: ${v}%"></i>`).join('')
    || '<span class="muted">Pojaviće se kad prođeš kroz ritam.</span>';
  const rows = INSTRUMENTS.filter(i => s.per[i.id]).map(i => {
    const r = s.per[i.id];
    const mean = r.mean == null ? '–' : fmtErr(r.mean);
    const spread = r.spread == null ? '–' : `±${Math.round(r.spread)} ms`;
    const dyn = r.errs.length ? Math.round((100 * r.dynOk) / r.errs.length) + '%' : '–';
    return `<tr><td><i style="background:${i.color}"></i>${esc(i.label)}</td><td>${r.good + r.ok}/${r.expected}${r.extra ? ` <small>+${r.extra}</small>` : ''}</td><td>${mean}</td><td>${spread}</td><td>${dyn}</td></tr>`;
  });
  $('#statTable').innerHTML = rows.length
    ? `<thead><tr><th>Instrument</th><th>Pogođeno</th><th>Prosjek</th><th>Rasipanje</th><th>Dinamika</th></tr></thead><tbody>${rows.join('')}</tbody>`
    : '';
  $('#advice').textContent = advice(s);
}

function advice(s) {
  const list = INSTRUMENTS.map(i => ({ i, r: s.per[i.id] })).filter(x => x.r && x.r.errs.length >= 6);
  if (!list.length) return 'Pokreni ritam i sviraj, ovdje ćeš vidjeti šta da popraviš.';
  const tips = [];
  const drift = list.filter(x => Math.abs(x.r.mean) >= 8).sort((a, b) => Math.abs(b.r.mean) - Math.abs(a.r.mean))[0];
  if (drift) tips.push(`${drift.i.label}: ${drift.r.mean < 0 ? 'žuriš' : 'kasniš'} oko ${Math.round(Math.abs(drift.r.mean))} ms.`);
  const wobbly = list.filter(x => x.r.spread >= 18).sort((a, b) => b.r.spread - a.r.spread)[0];
  if (wobbly) tips.push(`Najneujednačeniji je ${wobbly.i.label.toLowerCase()} (±${Math.round(wobbly.r.spread)} ms), uspori pa ga ustabili.`);
  const missy = list.filter(x => x.r.miss >= 3).sort((a, b) => b.r.miss - a.r.miss)[0];
  if (missy) tips.push(`Najviše promašaja: ${missy.i.label.toLowerCase()}.`);
  const dyn = list.filter(x => x.r.dynOk / x.r.errs.length < 0.6)[0];
  if (dyn) tips.push(`Pazi na dinamiku na ${dyn.i.label.toLowerCase()} (akcenti jače, ghost note tiše).`);
  if (!tips.length && s.accuracy >= 90) tips.push('Odlično! Probaj tempo +5 ili uključi tihe taktove.');
  return tips.join(' ') || 'Dobro ide, nastavi.';
}

// ---------- Podešavanja ----------

function renderMapTable() {
  $('#mapTable').innerHTML = kitInstruments(settings.kitConfig).map(i => {
    const notes = midi.notesFor(i.id).map(n => `<span class="note">${n}<button data-unmap="${n}" title="Ukloni">×</button></span>`).join('') || '<span class="muted">nema</span>';
    const learning = midi.learn?.instId === i.id;
    return `<tr><td><i style="background:${i.color}"></i>${esc(i.label)}</td><td>${notes}</td><td><button data-learn="${i.id}" class="${learning ? 'learning' : ''}">${learning ? 'Udari pad…' : 'Nauči'}</button></td></tr>`;
  }).join('');
  configurator?.renderLearning();
}

function renderMidiOut() {
  const sel = $('#midiOut');
  sel.innerHTML = '<option value="">Ne, sviraj ovdje</option>' + midiOutputs.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
  sel.value = midiOutputs.some(o => o.id === settings.midiOut) ? settings.midiOut : '';
}

function showLatency() {
  if (audio.ctx) $('#latencyInfo').textContent = `Kašnjenje zvuka na ovom računaru: oko ${Math.round(audio.latencyMs())} ms. Zvuk iz TD-17 modula kasni manje.`;
}

async function loadKitList() {
  try {
    const kits = await (await fetch('kits/index.json')).json();
    for (const k of kits) $('#kitSelect').append(Object.assign(document.createElement('option'), { value: k.id, textContent: k.name }));
    $('#kitSelect').value = kits.some(k => k.id === settings.kit) ? settings.kit : '';
  } catch {}
}

async function chooseKit(id) {
  settings.kit = id;
  saveSettings();
  if (!id) return audio.useSynth();
  toast('Učitavam zvukove…');
  try {
    const def = await audio.loadKit(`kits/${id}`);
    toast(`Zvuk: ${def.name}`);
  } catch {
    audio.useSynth();
    toast('Kit nije mogao da se učita, koristim ugrađeni zvuk.');
  }
}

async function runCalibration() {
  stop();
  try { await audio.ensure(); } catch { toast('Kalibracija ne može da pokrene zvuk.'); return; }
  const beat = 60 / 90, N = 20, t0 = audio.time + 0.3;
  const clicks = [];
  for (let i = 0; i < N; i++) {
    const t = t0 + i * beat;
    audio.click(t, i % 4 === 0);
    if (i >= 4) clicks.push(audio.ctxToPerf(t));
  }
  calibration = { hits: [] };
  $('#calibInfo').textContent = 'Slušaj 4 klika, pa udaraj dobos (ili taster F) tačno uz klik…';
  $('#calibBtn').disabled = true;
  profiles?.playState();
  configurator?.playState();
  kit?.playState();
  setTimeout(() => {
    const diffs = [];
    for (const h of calibration.hits) {
      const c = clicks.reduce((best, x) => (Math.abs(h - x) < Math.abs(h - best) ? x : best), Infinity);
      if (Math.abs(h - c) < (beat * 1000) / 3) diffs.push(h - c);
    }
    calibration = null;
    profiles?.playState();
    configurator?.playState();
    kit?.playState();
    $('#calibBtn').disabled = false;
    if (diffs.length < 6) {
      $('#calibInfo').textContent = 'Premalo udaraca uz klik, probaj ponovo.';
      return;
    }
    diffs.sort((a, b) => a - b);
    settings.calib = Math.round(diffs[Math.floor(diffs.length / 2)]);
    saveSettings();
    $('#calib').value = settings.calib;
    $('#calibInfo').textContent = `Gotovo: tvoji udarci stižu ${Math.abs(settings.calib)} ms ${settings.calib >= 0 ? 'poslije' : 'prije'} klika. To se sada uračunava.`;
  }, (t0 - audio.time + N * beat + 0.6) * 1000);
}

function renderKeyHelp() {
  $('#keyHelp').innerHTML = kitInstruments(settings.kitConfig).map(i => `<span><kbd>${i.keys.map(k => k.replace('Key', '')).join('</kbd> <kbd>')}</kbd> ${esc(i.label)}</span>`).join('') +
    '<span><kbd>Razmak</kbd> start / stop</span><span><kbd>↑</kbd> <kbd>↓</kbd> tempo (Shift ±5)</span><span><kbd>Shift</kbd> + taster = akcenat, <kbd>Alt</kbd> = ghost</span>';
}

// ---------- Povezivanje kontrola ----------

function bind() {
  $('#playBtn').onclick = toggle;
  $('#bpm').onchange = e => setBpm(e.target.value);
  for (const b of $$('.tbtn')) b.onclick = () => setBpm(pattern.bpm + Number(b.dataset.bpm));
  for (const id of ['metro', 'countIn', 'loop', 'playPattern', 'liveSound', 'record']) {
    $('#' + id).onchange = e => {
      settings[id] = e.target.checked;
      saveSettings();
      e.target.blur();
      if (settings[id]) audio.ensure().catch(() => toast('Zvuk nije dostupan.'));
    };
  }
  $('#clickSub').onchange = e => { settings.clickSub = Number(e.target.value); saveSettings(); };

  for (const b of $$('.viewtabs button')) b.onclick = () => {
    for (const x of $$('.viewtabs button')) x.classList.toggle('active', x === b);
    $('#view-kit').hidden = b.dataset.view !== 'kit';
    $('#view-editor').hidden = b.dataset.view !== 'editor';
    $('#view-practice').hidden = b.dataset.view !== 'practice';
    $('#view-tools').hidden = b.dataset.view !== 'tools';
    if (b.dataset.view === 'editor') renderEditor();
  };
  for (const b of $$('.sidetabs button')) b.onclick = () => {
    for (const x of $$('.sidetabs button')) x.classList.toggle('active', x === b);
    for (const p of ['library', 'stats', 'settings']) $('#panel-' + p).hidden = b.dataset.panel !== p;
    if (b.dataset.panel === 'stats') renderStats();
  };

  // Editor
  $('#grid').addEventListener('click', e => {
    const b = e.target.closest('.cell');
    if (b) setCell(b, e.shiftKey ? 3 : e.altKey ? 1 : NEXT[pattern.steps[b.dataset.inst][b.dataset.slot]]);
  });
  $('#grid').addEventListener('contextmenu', e => {
    const b = e.target.closest('.cell');
    if (!b) return;
    e.preventDefault();
    setCell(b, 0);
  });
  $('#edName').oninput = e => { pattern.name = e.target.value || t('Bez naziva'); pattern.preset = false; markDirty(); renderHeader(); };
  $('#edBars').onchange = e => changeStructure({ bars: Number(e.target.value) });
  $('#edBeats').onchange = e => changeStructure({ beats: Number(e.target.value) });
  $('#edDiv').onchange = e => changeStructure({ division: Number(e.target.value) });
  $('#edUnit').onchange = e => changeStructure({ beatUnit: Number(e.target.value) });
  $('#edSwing').onchange = e => changeStructure({ swing: Number(e.target.value) });
  $('#edGroups').onchange = e => {
    const groups = e.target.value.split('+').map(Number);
    if (!groups.every(n => Number.isInteger(n) && n > 0) || groups.reduce((a, b) => a + b, 0) !== pattern.beats) {
      toast('Zbir grupa mora da bude jednak broju doba.'); renderEditorControls(); return;
    }
    changeStructure({ groups });
  };
  $('#edSticking').oninput = e => { pattern.sticking = e.target.value.toUpperCase(); markDirty(); rerender(); };
  $('#edClear').onclick = () => {
    if (!confirm('Obrisati sve note u ovom ritmu?')) return;
    for (const id in pattern.steps) pattern.steps[id].fill(0);
    markDirty();
    renderAll();
  };
  $('#edCopyBar').onclick = () => {
    const spBar = slotsPerBar(pattern);
    for (const id in pattern.steps) pattern.steps[id] = pattern.steps[id].map((_, i) => pattern.steps[id][i % spBar]);
    markDirty();
    renderAll();
  };

  // Biblioteka
  const resetPresets = () => { libraryPages.presets = 1; renderLibrary(); };
  $('#presetCategory').onchange = resetPresets;
  $('#presetSearch').oninput = resetPresets;
  $('#favoritesOnly').onclick = () => {
    settings.favoritesOnly = !settings.favoritesOnly;
    libraryPages.mine = libraryPages.presets = 1;
    saveSettings(); renderLibrary();
  };
  for (const id of ['mine', 'presets']) for (const [suffix, delta] of [['Prev', -1], ['Next', 1]]) {
    $('#' + id + suffix).onclick = () => {
      libraryPages[id] += delta; renderLibrary();
      if ($('#' + id + suffix).disabled) $('#' + id + (delta > 0 ? 'Prev' : 'Next')).focus({ preventScroll: true });
    };
  }
  $('#saveBtn').onclick = () => saveCurrent(false);
  $('#saveAsBtn').onclick = () => saveCurrent(true);
  $('#newBtn').onclick = () => {
    loadPattern(blankPattern({ name: t('Novi ritam'), bpm: pattern.bpm }));
    $('.viewtabs [data-view=editor]').click();
  };
  $('#exportBtn').onclick = () => store.download('drummer-ritmovi.json', { ritmovi: library });
  $('#importFile').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const list = await store.importFile(file);
      const updated = [...list, ...library];
      if (!store.saveLibrary(updated)) return;
      library = updated;
      libraryPages.mine = 1;
      renderLibrary();
      toast(`Uvezeno ritmova: ${list.length}`);
    } catch {
      toast('Fajl nije ispravan JSON sa ritmovima.');
    }
  };

  // Rezultat
  $('#resetStats').onclick = () => { scorer.reset(); play.loopScores = []; notation.clearMarks(); renderStats(); };

  // Podešavanja
  $('#mapTable').addEventListener('click', e => {
    const learn = e.target.closest('[data-learn]'), unmap = e.target.closest('[data-unmap]');
    if (learn) {
      if (midi.learn?.instId === learn.dataset.learn) midi.cancelLearn();
      else midi.startLearn(learn.dataset.learn, () => renderMapTable());
      renderMapTable();
    } else if (unmap) {
      midi.unassign(Number(unmap.dataset.unmap));
      renderMapTable();
    }
  });
  $('#mapReset').onclick = () => { midi.reset(); renderMapTable(); };
  $('#midiOut').onchange = e => { settings.midiOut = midi.outId = e.target.value; saveSettings(); };
  $('#level').value = settings.level;
  $('#level').onchange = e => { settings.level = scorer.level = e.target.value; saveSettings(); };
  $('#calib').value = settings.calib;
  $('#calib').onchange = e => { settings.calib = scorer.calib = Math.round(bounded(e.target.value, -1000, 1000, 0)); e.target.value = settings.calib; saveSettings(); };
  $('#calibBtn').onclick = runCalibration;
  $('#quiet').value = settings.quiet;
  $('#quiet').onchange = e => { settings.quiet = e.target.value; saveSettings(); };
  $('#trainerOn').checked = settings.trainer.on;
  $('#trainerOn').onchange = e => { settings.trainer.on = e.target.checked; saveSettings(); };
  $('#trainerStep').value = settings.trainer.step;
  $('#trainerStep').onchange = e => { settings.trainer.step = Math.min(10, Math.max(1, Number(e.target.value) || 2)); saveSettings(); };
  $('#kitSelect').onchange = e => chooseKit(e.target.value);
  for (const [id, bus] of [['volClick', 'click'], ['volPattern', 'pattern'], ['volLive', 'live']]) {
    $('#' + id).value = settings.vol[bus];
    $('#' + id).oninput = e => { settings.vol[bus] = Number(e.target.value); audio.setVolume(bus, settings.vol[bus]); saveSettings(); };
  }
  document.addEventListener('pointerdown', () => audio.ensure().then(showLatency).catch(() => toast('Zvuk nije dostupan.')), { once: true });
  let paperWidth = 0, viewHeight = window.innerHeight;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerHeight - viewHeight) > 20) { viewHeight = window.innerHeight; rerender(); }
  });
  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (Math.abs(w - paperWidth) > 4) { paperWidth = w; rerender(); }
  }).observe($('#notation'));
  setInterval(() => { if (play.on && !$('#panel-stats').hidden) renderStats(); }, 1000);
  $('#backupCurrent').textContent = 'Izvezi sve podatke';
  $('#backupCurrent').onclick = () => store.download('drummer-backup.json', {
    version: 1, ritmovi: library, trenutni: pattern, podesavanja: settings,
    sessions: studio.sessions, programs: studio.programs, programDraft: studio.program,
    profiles: profiles.items, midiMap: midi.map, language: getLanguage(), favorites: [...favorites],
  });
  $('#retryStorage').onclick = () => {
    const saved = [store.saveLibrary(library), store.saveSettings(settings), store.saveSessions(studio.sessions), store.savePrograms(studio.programs), store.saveProfiles(profiles.items), midi.save()];
    if (saved.every(Boolean)) { $('#storageWarning').hidden = true; toast(dirty ? 'Čuvanje ponovo radi. Sačuvaj izmene ritma dugmetom Sačuvaj.' : 'Podaci su sačuvani.'); }
  };
  window.addEventListener('pagehide', () => { stop('unload'); store.saveSettings(settings); });
}

const kitBusy = () => play.on || play.starting || !!calibration || !!studio?.run || studio?.replay.playing || studio?.replay.starting;
function applyKit(value, persist = true) {
  if (kitBusy()) return false;
  const config = normalizeKit(value);
  if (persist && !store.saveSettings({ ...settings, kitConfig: config })) return false;
  settings.kitConfig = config; midi.cancelLearn();
  kit.configure(); renderMapTable(); renderKeyHelp(); renderAll(); studio?.renderFocus();
  const missing = missingKitInstruments(pattern, config);
  if (missing.length) toast('Ritam koristi delove koji nisu u tvom setu. Uključi ih u Moj bubanj ili izmeni ritam.');
  return true;
}

kit = createKitView($('#view-kit'), settings, saveSettings, {
  isBusy: kitBusy,
  hit: (id, velocity, time) => onHit(id, velocity, time, 'mouse'),
  commit(value) {
    if (kitBusy()) return false;
    const config = normalizeKit(value);
    if (!store.saveSettings({ ...settings, kitConfig: config })) return false;
    settings.kitConfig = config; configurator?.renderKit(); return true;
  },
});
bind();
renderAll();
renderMapTable();
renderKeyHelp();
studio = new PracticeStudio({ audio, getPattern: () => pattern, getLevel: () => settings.level,
  isPlaying: () => play.on || play.starting, start, stop, loadPattern, setBpm,
  refreshNotation: renderNotationView, toast, getInstruments: () => kitInstruments(settings.kitConfig),
  onBusyChange: () => { profiles?.playState(); configurator?.playState(); kit?.playState(); } });
profiles = new DeviceProfiles({ midi, settings, saveSettings, stop, toast, renderMap: renderMapTable, applyKit, profileChanged: () => configurator?.render(),
  isBusy: () => play.on || play.starting || !!calibration || !!studio.run || studio.replay.playing || studio.replay.starting });
configurator = new KitConfigurator({ settings, midi, profiles, apply: applyKit, renderMap: renderMapTable,
  isBusy: () => play.on || play.starting || !!calibration || !!studio.run || studio.replay.playing || studio.replay.starting });
workbench = new Workbench({ midi, toast, loadPattern, markDirty, render: renderAll, getPattern: () => pattern,
  isBusy: () => play.on || play.starting || !!studio.run || !!calibration });
document.addEventListener('drummer:language', () => {
  configurator?.render();
  renderEditorControls(); renderLibrary(); studio.renderBacking(); studio.renderJournal();
  if (!profiles.id && ['Moj uređaj', 'My device'].includes($('#profileName').value)) $('#profileName').value = t('Moj uređaj');
  if (!studio.program.id && !studio.programDirty && ['Moj program', 'My program'].includes(studio.program.name)) {
    studio.program.name = t('Moj program'); studio.renderPrograms();
  }
  if (!$('#tool-print').hidden && !$('#view-tools').hidden) workbench.printPreview();
});
workspaceView = new WorkspaceView(settings, saveSettings, renderNotationView);
renderNotationView();
initI18n();
const patternMeta = p => ({ id: p.id, name: p.name, nameEn: p.nameEn || t(p.name, 'en'),
  category: p.category || 'basics', preset: !!p.preset, bpm: p.bpm, bars: p.bars, beats: p.beats,
  beatUnit: p.beatUnit, division: p.division, swing: p.swing, difficulty: p.difficulty || '', favorite: favorites.has(p.id) });
agentTools = setupAgentTools({ settings, saveSettings, instrumentIds: INSTRUMENTS.map(i => i.id),
  getState: () => ({ pattern: patternMeta(pattern), playing: play.on, starting: play.starting,
    programRunning: !!studio.run, calibrating: !!calibration, replaying: studio.replay.playing || studio.replay.starting,
    unsavedPattern: dirty, unsavedProgram: studio.programDirty, backingEnabled: studio.backing.enabled,
    kitConfig: settings.kitConfig, audioReady: audio.ready, language: getLanguage(), focus: studio.focus, favoriteCount: favoriteCount(),
    options: Object.fromEntries(['metro', 'countIn', 'loop', 'playPattern', 'liveSound', 'record'].map(k => [k, settings[k]])),
    view: { active: $('.viewtabs button.active')?.dataset.view, panel: $('.sidetabs button.active')?.dataset.panel,
      kit: kit.mode, notesOnly: workspaceView.focus, rows: settings.scoreRows },
    midi: { supported: midi.supported, inputs: [...(midi.access?.inputs.values() || [])].map(i => i.name), outputSelected: !!midi.outId },
  }),
  listPatterns: ({ source, category, query, offset, limit, favoritesOnly }) => {
    const list = source === 'presets' ? PRESETS : source === 'saved' ? library : [...PRESETS, ...library];
    const matches = filterPresets(list.filter(p => typeof p.id === 'string' && (!favoritesOnly || favorites.has(p.id))), category, query);
    return { total: matches.length, offset, patterns: matches.slice(offset, offset + limit).map(patternMeta) };
  },
  getPattern: id => id === undefined ? pattern : [...PRESETS, ...library].find(p => p.id === id), loadPattern, setBpm, setFavorite,
  setOptions: options => {
    for (const [key, value] of Object.entries(options)) { settings[key] = value; $('#' + key).checked = value; }
    saveSettings();
  },
  start, audioReady: () => audio.ready, lastMessage: () => $('#toast').textContent,
  stop: () => { stop(); studio.replay.stop(); studio.cancelProgram(); },
  setView: async options => {
    if (options.kitView) {
      await kit.select(options.kitView);
      if (kit.mode !== options.kitView) throw new ToolError('VIEW_UNAVAILABLE', $('#kitViewStatus').textContent);
    }
    if (options.view) $(`[data-view="${options.view}"]`).click();
    if (options.panel) $(`[data-panel="${options.panel}"]`).click();
    if (options.rows !== undefined) {
      settings.scoreRows = options.rows; $('#scoreRows').value = options.rows; renderNotationView(); saveSettings();
    }
    if (options.notesOnly !== undefined) workspaceView.toggle(options.notesOnly);
  },
  setFocus: focus => { studio.focus = structuredClone(focus); studio.renderFocus(); studio.renderBacking(); renderNotationView(); },
  getResults: limit => ({ current: compactStats(scorer.stats()), sessionCount: studio.sessions.length,
    recent: [...studio.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit).map(s => ({
      id: s.id, startedAt: s.startedAt, pattern: patternMeta(s.pattern), durationMs: s.durationMs,
      bpmStart: s.bpmStart, bpmEnd: s.bpmEnd, stats: s.stats,
    })) }),
  setLanguage: language => { $('#languageSelect').value = language; $('#languageSelect').dispatchEvent(new Event('change')); },
});
setupPwa({ canReload: () => !play.on && !play.starting && !studio.run && !dirty && !studio.programDirty && !calibration,
  flush: () => [store.saveSettings(settings), store.saveLibrary(library), store.saveSessions(studio.sessions), store.savePrograms(studio.programs), store.saveProfiles(profiles.items), midi.save()].every(Boolean) });
loadKitList().then(() => settings.kit && chooseKit(settings.kit));
midi.init();
requestAnimationFrame(frame);
