import {
  INSTRUMENTS, INST, DYN_VEL, PRESETS, blankPattern, normalize, resize, patternInfo,
  slotsPerBeat, slotsPerBar, totalSlots,
} from './patterns.js';
import { renderNotation } from './notation.js';
import { createKit } from './kit.js';
import { AudioEngine } from './audio.js';
import { MidiInput } from './midi.js';
import { Scorer } from './scoring.js';
import * as store from './storage.js';

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
});
settings.record = false;
const saveSettings = debounce(() => store.saveSettings(settings), 200);

const audio = new AudioEngine();
for (const [k, v] of Object.entries(settings.vol)) audio.setVolume(k, v);
const scorer = new Scorer();
const midi = new MidiInput({ onHit, onStatus, onNote, onPedal: v => kit.pedal(v), onChoke: id => audio.choke(id) });
midi.outId = settings.midiOut;

let library = store.loadLibrary();
let pattern = normalize(settings.current || structuredClone(PRESETS[0]));
let dirty = false;
let notation, kit;
let edCells = [];
let calibration = null;

const play = { on: false, n: 0, nextTime: 0, timer: 0, queue: [], cur: null, countIn: 0, endAt: 0, loopScores: [], nowCol: -1 };
const slotMs = () => 60000 / pattern.bpm / slotsPerBeat(pattern);

// ---------- Sviranje ----------

async function start() {
  if (play.on) return;
  await audio.ensure();
  showLatency();
  scorer.reset();
  scorer.level = settings.level;
  scorer.calib = settings.calib;
  notation.clearMarks();
  Object.assign(play, { on: true, queue: [], cur: null, endAt: 0, loopScores: [] });
  play.countIn = settings.countIn ? slotsPerBar(pattern) : 0;
  play.n = -play.countIn;
  play.nextTime = audio.time + 0.15;
  play.timer = setInterval(schedule, 25);
  schedule();
  renderTransport();
  renderStats();
}

function stop() {
  if (!play.on) return;
  play.on = false;
  clearInterval(play.timer);
  notation.setPlayhead(null);
  $('#countOverlay').hidden = true;
  setNowColumn(-1);
  renderTransport();
  renderStats();
}

const toggle = () => (play.on ? stop() : start());

function schedule() {
  const total = totalSlots(pattern);
  while (play.on && play.nextTime < audio.time + 0.12) {
    if (!settings.loop && play.n >= total) {
      if (!play.endAt) play.endAt = audio.ctxToPerf(play.nextTime) + 300;
      return;
    }
    scheduleSlot(play.n, play.nextTime);
    play.nextTime += slotMs() / 1000;
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
  const spb = slotsPerBeat(pattern), spBar = slotsPerBar(pattern), total = totalSlots(pattern);
  const perf = audio.ctxToPerf(t);
  if (n < 0) {
    const k = n + play.countIn;
    if (k % spb === 0) {
      audio.click(t, k === 0);
      play.queue.push({ perf, n, count: k / spb + 1 });
    }
    return;
  }
  const loop = Math.floor(n / total), slot = n % total, inBar = slot % spBar;
  if (settings.metro && !quietBar(Math.floor(n / spBar))) {
    if (inBar % spb === 0) audio.click(t, inBar === 0);
    else if (inBar % clickStep() === 0) audio.click(t, false, 0.4);
  }
  const insts = [];
  for (const inst of INSTRUMENTS) {
    const v = pattern.steps[inst.id][slot];
    if (!v) continue;
    insts.push(inst.id);
    if (settings.playPattern && !midi.send(inst.midiOut, DYN_VEL[v], perf)) audio.play(inst.id, t, DYN_VEL[v] / 127, 'pattern');
    scorer.expect({ perf, inst: inst.id, dyn: v, slot, loop });
  }
  play.queue.push({ perf, n, slot, loop, insts });
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
  if (ev.slot === 0 && ev.loop > 0) setTimeout(() => finishLoop(ev.loop - 1), 250);
}

function frame() {
  requestAnimationFrame(frame);
  if (!play.on) return;
  const now = performance.now();
  while (play.queue.length && play.queue[0].perf <= now) reach(play.queue.shift());
  const cur = play.cur;
  if (!cur) return;
  const ms = slotMs(), total = totalSlots(pattern);
  const nf = cur.n + (now - cur.perf) / ms;
  if (cur.n >= 0) notation.setPlayhead(Math.min(total - 0.01, (cur.n % total) + Math.min(1, (now - cur.perf) / ms)));
  const lead = slotsPerBeat(pattern);
  for (let k = Math.ceil(nf); k <= nf + lead; k++) {
    if (k < 0 || (!settings.loop && k >= total)) continue;
    const slot = k % total;
    for (const inst of INSTRUMENTS) if (pattern.steps[inst.id][slot]) kit.approach(inst.id, 1 - (k - nf) / lead);
  }
  kit.commit();
  for (const r of scorer.sweep(now)) {
    notation.mark(r.note.slot, r.inst, 'miss', r.note.loop);
    kit.hit(r.inst, 'miss');
  }
  if (play.endAt && now > play.endAt) stop();
}

function finishLoop(loop) {
  const s = scorer.loopScore(loop);
  if (s == null) return;
  play.loopScores.push(s);
  renderStats();
  if (settings.trainer.on && s >= 90 && pattern.bpm < 260) {
    setBpm(pattern.bpm + settings.trainer.step);
    toast(`Prolaz ${s}%: tempo podignut na ${pattern.bpm} BPM`);
  }
}

// ---------- Udarci ----------

function onHit(instId, vel, perf) {
  if (calibration) {
    calibration.hits.push(perf);
    kit.hit(instId, 'free');
    return;
  }
  if (settings.liveSound) audio.playNow(instId, vel / 127);
  let res = null;
  if (play.on) {
    scorer.currentLoop = Math.max(0, play.cur?.loop ?? 0);
    res = scorer.hit(instId, perf, vel);
    const ms = slotMs(), total = totalSlots(pattern);
    let s = null, loop = scorer.currentLoop;
    if (res.note) {
      const off = Math.max(-0.45, Math.min(0.45, res.err / ms));
      s = Math.max(0, Math.min(total - 0.01, res.note.slot + off));
      loop = res.note.loop;
    } else if (play.cur) {
      const nf = play.cur.n + (perf - settings.calib - play.cur.perf) / ms;
      if (nf >= 0) { s = nf % total; loop = Math.floor(nf / total); }
    }
    if (s != null) notation.mark(s, instId, res.kind, loop);
    if (settings.record) recordHit(instId, vel, perf);
  }
  kit.hit(instId, res ? res.kind : 'free');
  showLastHit(instId, vel, res);
}

function recordHit(instId, vel, perf) {
  if (!play.cur) return;
  const nf = play.cur.n + (perf - settings.calib - play.cur.perf) / slotMs();
  const k = Math.round(nf);
  if (k < 0) return;
  pattern.steps[instId][k % totalSlots(pattern)] = vel >= 108 ? 3 : vel <= 45 ? 1 : 2;
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
  const typing = e.target instanceof Element && e.target.matches('input[type=text], input[type=number], select, textarea');
  if (typing) return;
  if (e.code === 'Space') {
    e.preventDefault();
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
  if (!audio.ready) audio.ensure();
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
  renderMidiOut();
}

function onNote(note, vel) {
  const inst = midi.map[note];
  $('#lastNote').textContent = `${note} (jačina ${vel})${inst ? ' → ' + INST[inst].label : ' → nije mapirana'}`;
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
  $('#patternName').textContent = pattern.name + (dirty ? ' •' : '');
  $('#patternName').title = dirty ? 'Ima nesačuvanih izmjena' : '';
  $('#patternInfo').textContent = patternInfo(pattern);
}

function renderNotationView() {
  notation = renderNotation($('#notation'), pattern, { maxHeight: Math.max(150, window.innerHeight * 0.34) });
}

const rerender = debounce(() => {
  renderNotationView();
  if (!$('#view-editor').hidden) syncGrid();
  renderHeader();
}, 120);

function renderTransport() {
  const b = $('#playBtn');
  b.textContent = play.on ? '■ Stop' : '▶ Start';
  b.classList.toggle('playing', play.on);
  $('#bpm').value = pattern.bpm;
  for (const id of ['metro', 'countIn', 'loop', 'playPattern', 'liveSound', 'record']) $('#' + id).checked = settings[id];
  renderClickSub();
}

function renderClickSub() {
  const opts = pattern.division === 12
    ? [[1, 'Klik: četvrtine'], [3, 'Klik: triole']]
    : [[1, 'Klik: četvrtine'], [2, 'Klik: osmine'], [4, 'Klik: šesnaestine']];
  if (!opts.some(([v]) => v === settings.clickSub)) settings.clickSub = 1;
  $('#clickSub').innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('#clickSub').value = settings.clickSub;
}

function setBpm(v) {
  pattern.bpm = Math.min(260, Math.max(30, Math.round(Number(v) || pattern.bpm)));
  settings.current = pattern;
  saveSettings();
  $('#bpm').value = pattern.bpm;
  renderHeader();
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

const NEXT = [2, 3, 1, 0];

function renderEditorControls() {
  $('#edName').value = pattern.name;
  $('#edBars').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option>${n}</option>`).join('');
  $('#edBeats').innerHTML = [2, 3, 4, 5, 6, 7].map(n => `<option>${n}</option>`).join('');
  $('#edBars').value = pattern.bars;
  $('#edBeats').value = pattern.beats;
  $('#edDiv').value = pattern.division;
  $('#edSticking').value = pattern.sticking || '';
}

function renderEditor() {
  const grid = $('#grid');
  const total = totalSlots(pattern), spb = slotsPerBeat(pattern), spBar = slotsPerBar(pattern);
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `132px repeat(${total}, minmax(19px, 1fr))`;
  edCells = Array.from({ length: total }, () => []);
  const div = (cls, text = '') => Object.assign(document.createElement('div'), { className: cls, textContent: text });
  const subs = spb === 4 ? ['', 'e', '&', 'a'] : ['', '&', 'a'];
  grid.append(div('corner'));
  for (let s = 0; s < total; s++) {
    const inBar = s % spBar, k = inBar % spb;
    const c = div('count' + (k === 0 ? ' beat' : '') + (inBar === 0 ? ' barstart' : ''), k === 0 ? String(inBar / spb + 1) : subs[k]);
    grid.append(c);
    edCells[s].push(c);
  }
  for (const inst of INSTRUMENTS) {
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
  pattern = resize(pattern, changes);
  markDirty();
  renderAll();
}

// ---------- Biblioteka ----------

function renderLibrary() {
  const mine = $('#mine');
  mine.innerHTML = library.length ? '' : '<li class="empty muted">Još nema sačuvanih ritmova.</li>';
  for (const p of library) mine.append(libraryItem(p, true));
  const pre = $('#presets');
  pre.innerHTML = '';
  for (const p of PRESETS) pre.append(libraryItem(p, false));
}

function libraryItem(p, own) {
  const li = document.createElement('li');
  li.className = 'item' + (p.id === pattern.id ? ' active' : '');
  const load = document.createElement('button');
  load.className = 'load';
  load.innerHTML = `<span>${esc(p.name)}</span><small>${esc(patternInfo(p))}</small>`;
  load.onclick = () => loadPattern(p);
  li.append(load);
  if (own) {
    const acts = document.createElement('div');
    acts.className = 'acts';
    const btn = (label, fn) => Object.assign(document.createElement('button'), { textContent: label, onclick: fn });
    acts.append(
      btn('Dupliraj', () => {
        library.splice(library.indexOf(p) + 1, 0, { ...structuredClone(p), id: store.newId(), name: p.name + ' (kopija)' });
        store.saveLibrary(library);
        renderLibrary();
      }),
      btn('Izvezi', () => store.download(fileName(p.name), p)),
      btn('Obriši', () => {
        if (!confirm(`Obrisati ritam „${p.name}"?`)) return;
        library = library.filter(x => x !== p);
        store.saveLibrary(library);
        renderLibrary();
      }),
    );
    li.append(acts);
  }
  return li;
}

const fileName = name => (name.toLowerCase().replace(/[^a-z0-9šđčćž]+/g, '-').replace(/^-|-$/g, '') || 'ritam') + '.json';

function loadPattern(p) {
  if (dirty && !confirm('Trenutni ritam ima nesačuvane izmjene. Da ih odbaciš?')) return;
  stop();
  pattern = normalize(structuredClone(p));
  dirty = false;
  settings.current = pattern;
  saveSettings();
  renderAll();
}

function saveCurrent(asNew) {
  const own = library.find(p => p.id === pattern.id);
  if (asNew || !own) {
    const name = prompt('Naziv ritma:', own ? pattern.name + ' (kopija)' : pattern.name);
    if (!name) return;
    pattern = { ...pattern, id: store.newId(), name: name.trim(), preset: false };
    library.unshift(structuredClone(pattern));
  } else {
    library[library.indexOf(own)] = structuredClone(pattern);
  }
  store.saveLibrary(library);
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
  $('#mapTable').innerHTML = INSTRUMENTS.map(i => {
    const notes = midi.notesFor(i.id).map(n => `<span class="note">${n}<button data-unmap="${n}" title="Ukloni">×</button></span>`).join('') || '<span class="muted">nema</span>';
    const learning = midi.learn?.instId === i.id;
    return `<tr><td><i style="background:${i.color}"></i>${esc(i.label)}</td><td>${notes}</td><td><button data-learn="${i.id}" class="${learning ? 'learning' : ''}">${learning ? 'Udari pad…' : 'Nauči'}</button></td></tr>`;
  }).join('');
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
  await audio.ensure();
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
  setTimeout(() => {
    const diffs = [];
    for (const h of calibration.hits) {
      const c = clicks.reduce((best, x) => (Math.abs(h - x) < Math.abs(h - best) ? x : best), Infinity);
      if (Math.abs(h - c) < (beat * 1000) / 3) diffs.push(h - c);
    }
    calibration = null;
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
  $('#keyHelp').innerHTML = INSTRUMENTS.map(i => `<span><kbd>${i.keys.map(k => k.replace('Key', '')).join('</kbd> <kbd>')}</kbd> ${esc(i.label)}</span>`).join('') +
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
      if (settings[id]) audio.ensure();
    };
  }
  $('#clickSub').onchange = e => { settings.clickSub = Number(e.target.value); saveSettings(); };

  for (const b of $$('.viewtabs button')) b.onclick = () => {
    for (const x of $$('.viewtabs button')) x.classList.toggle('active', x === b);
    $('#view-kit').hidden = b.dataset.view !== 'kit';
    $('#view-editor').hidden = b.dataset.view !== 'editor';
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
  $('#edName').oninput = e => { pattern.name = e.target.value || 'Bez naziva'; markDirty(); renderHeader(); };
  $('#edBars').onchange = e => changeStructure({ bars: Number(e.target.value) });
  $('#edBeats').onchange = e => changeStructure({ beats: Number(e.target.value) });
  $('#edDiv').onchange = e => changeStructure({ division: Number(e.target.value) });
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
  $('#saveBtn').onclick = () => saveCurrent(false);
  $('#saveAsBtn').onclick = () => saveCurrent(true);
  $('#newBtn').onclick = () => {
    loadPattern(blankPattern({ name: 'Novi ritam', bpm: pattern.bpm }));
    $('.viewtabs [data-view=editor]').click();
  };
  $('#exportBtn').onclick = () => store.download('drummer-ritmovi.json', { ritmovi: library });
  $('#importFile').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const list = await store.importFile(file);
      library = [...list, ...library];
      store.saveLibrary(library);
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
  $('#calib').onchange = e => { settings.calib = scorer.calib = Math.round(Number(e.target.value) || 0); saveSettings(); };
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
  document.addEventListener('pointerdown', () => audio.ensure().then(showLatency), { once: true });
  let paperWidth = 0, viewHeight = window.innerHeight;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerHeight - viewHeight) > 20) { viewHeight = window.innerHeight; rerender(); }
  });
  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (Math.abs(w - paperWidth) > 4) { paperWidth = w; rerender(); }
  }).observe($('#notation'));
  setInterval(() => { if (play.on && !$('#panel-stats').hidden) renderStats(); }, 1000);
}

kit = createKit($('#view-kit'));
bind();
renderAll();
renderMapTable();
renderKeyHelp();
loadKitList().then(() => settings.kit && chooseKit(settings.kit));
midi.init();
requestAnimationFrame(frame);
