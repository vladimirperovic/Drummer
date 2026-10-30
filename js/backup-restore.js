import { normalize, INST } from './patterns.js';
import { normalizeSession, normalizeProgram } from './practice.js';
import { normalizeProfile } from './profiles.js';
import { normalizeMidiMap, normalizeRouting } from './midi.js';
import { normalizeArrangement } from './arrangements.js';
import * as store from './storage.js';
import { t } from './i18n.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const COLLECTIONS = ['ritmovi', 'sessions', 'programs', 'profiles', 'arrangements', 'songRuns'];
const normalizers = { songRuns: x => structuredClone(x), ritmovi: normalize, sessions: normalizeSession, programs: normalizeProgram, profiles: normalizeProfile, arrangements: normalizeArrangement };
const valid = { songRuns: x => typeof x.id === 'string' && typeof x.name === 'string'
  && ['from', 'to', 'rate', 'durationSeconds', 'offsetSeconds'].every(k => Number.isFinite(x[k]))
  && x.rate > 0 && x.from >= 0 && x.to >= x.from && x.durationSeconds >= 0
  && (x.bpm == null || Number.isFinite(x.bpm) && x.bpm > 0)
  && object(x.meter) && Number.isInteger(x.meter.beats) && x.meter.beats > 0 && [4,8].includes(x.meter.beatUnit)
  && Array.isArray(x.reference) && x.reference.every(n => Array.isArray(n) && n.length === 3 && Number.isFinite(n[0]) && Object.hasOwn(INST,n[1]) && (n[2] == null || Number.isFinite(n[2])))
  && Array.isArray(x.hits) && x.hits.every(n => Array.isArray(n) && n.length === 5 && Number.isFinite(n[0]) && Object.hasOwn(INST,n[1]) && Number.isFinite(n[2]) && n[2] >= 0 && n[2] <= 127 && (n[3] == null || Number.isFinite(n[3])) && ['good','ok','bad','extra'].includes(n[4])), ritmovi: x => object(x.steps), sessions: x => object(x.pattern?.steps) && Array.isArray(x.hits), programs: x => Array.isArray(x.entries) && x.entries.every(e => object(e?.pattern?.steps)), profiles: x => object(x.map), arrangements: x => Array.isArray(x.sections) && x.sections.every(s => object(s?.pattern?.steps)) };
export function validateBackup(value) {
  if (!object(value) || ![1, 2].includes(value.version) || !COLLECTIONS.some(key => Array.isArray(value[key]))) throw new Error('Fajl nije ispravna Drummer rezervna kopija.');
  const inspect = (item, depth = 0) => {
    if (depth > 30) throw new Error('Rezervna kopija je previše složena.');
    if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Rezervna kopija sadrži nepodržane podatke.');
      inspect(child, depth + 1);
    }
  }; inspect(value);
  const data = structuredClone(value);
  for (const key of COLLECTIONS) {
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error('Rezervna kopija sadrži neispravnu listu.');
    const ids = new Set();
    if (key === 'songRuns' && data[key] === undefined) continue;
    data[key] = (data[key] || []).map(item => {
      if (!object(item) || !valid[key](item)) throw new Error('Rezervna kopija sadrži neispravan zapis.');
      if (key === 'sessions' && (!item.hits.every(hit => object(hit) && Object.hasOwn(INST, hit.inst) && Number.isFinite(hit.timeMs) && hit.timeMs >= -2000)
        || ['expected', 'timeline', 'results', 'passes'].some(field => item[field] !== undefined && !Array.isArray(item[field])))) throw new Error('Rezervna kopija sadrži neispravne udarce ili vremensku liniju.');
      const result = normalizers[key](item);
      if (!result) throw new Error('Rezervna kopija sadrži neispravnu sesiju.');
      result.id ||= store.newId();
      if (ids.has(result.id)) throw new Error('Rezervna kopija sadrži ponovljene identifikatore.'); ids.add(result.id); return result;
    });
  }
  if (data.podesavanja !== undefined && !object(data.podesavanja)) throw new Error('Podešavanja u rezervnoj kopiji nisu ispravna.');
  if (data.trenutni !== undefined && !object(data.trenutni?.steps)) throw new Error('Trenutni ritam u rezervnoj kopiji nije ispravan.');
  if (data.midiMap !== undefined && !object(data.midiMap)) throw new Error('MIDI mapa u rezervnoj kopiji nije ispravna.');
  if (data.midiRouting !== undefined && !object(data.midiRouting)) throw new Error('MIDI mapa u rezervnoj kopiji nije ispravna.');
  if (data.programDraft !== undefined && (!object(data.programDraft) || !valid.programs(data.programDraft))) throw new Error('Rezervna kopija sadrži neispravan zapis.');
  if (data.arrangementDraft !== undefined && (!object(data.arrangementDraft) || !valid.arrangements(data.arrangementDraft))) throw new Error('Rezervna kopija sadrži neispravan zapis.');
  data.favorites = Array.isArray(data.favorites) ? [...new Set(data.favorites.filter(id => typeof id === 'string'))] : [];
  if (data.trenutni) data.trenutni = normalize(data.trenutni);
  if (data.midiMap) data.midiMap = normalizeMidiMap(data.midiMap);
  if (data.midiRouting) data.midiRouting = normalizeRouting(data.midiRouting);
  if (data.programDraft) data.programDraft = normalizeProgram(data.programDraft);
  if (data.arrangementDraft) data.arrangementDraft = normalizeArrangement(data.arrangementDraft);
  if (data.language !== undefined) data.language = data.language === 'sr' ? 'sr' : 'en';
  return data;
}
export function planRestore(current, incoming, { mode = 'merge', conflicts = 'keep', settings = false } = {}) {
  if (!['merge', 'replace'].includes(mode) || !['keep', 'replace', 'both'].includes(conflicts)) throw new Error('Izaberi način vraćanja podataka.');
  const result = structuredClone(current), counts = {}, remap = { ritmovi: new Map(), profiles: new Map() };
  for (const key of COLLECTIONS) {
    if (key === 'songRuns' && incoming[key] === undefined) continue;
    const existing = current[key] || [], imported = incoming[key] || [], existingIds = new Set(existing.map(item => item.id)), map = new Map((mode === 'replace' ? [] : existing).map(item => [item.id, item]));
    let duplicates = 0, added = 0, replaced = 0;
    for (const original of imported) {
      const item = structuredClone(original), previous = map.get(item.id);
      if (mode === 'replace') { if (existingIds.has(item.id)) { duplicates++; replaced++; } else added++; map.set(item.id, item); continue; }
      if (previous) {
        duplicates++;
        if (conflicts === 'keep') continue;
        if (conflicts === 'both') { const oldId = item.id; item.id = store.newId(); remap[key]?.set(oldId, item.id); }
        else replaced++;
      }
      map.set(item.id, item); if (!previous || conflicts === 'both') added++;
    }
    result[key] = [...map.values()]; counts[key] = { incoming: imported.length, conflicts: duplicates, added, replaced, total: map.size, removed: mode === 'replace' ? existing.filter(item => !map.has(item.id)).length : 0 };
  }
  result.favorites = [...new Set([...(mode === 'replace' ? [] : current.favorites || []), ...(incoming.favorites || []).map(id => remap.ritmovi.get(id) || id)])];
  if (settings) {
    for (const key of ['podesavanja', 'trenutni', 'midiMap', 'midiRouting', 'language', 'programDraft', 'arrangementDraft']) if (incoming[key] !== undefined) result[key] = structuredClone(incoming[key]);
    if (result.podesavanja?.profileId) result.podesavanja.profileId = remap.profiles.get(result.podesavanja.profileId) || result.podesavanja.profileId;
    if (result.trenutni?.id) result.trenutni.id = remap.ritmovi.get(result.trenutni.id) || result.trenutni.id;
    if (result.trenutni) (result.podesavanja ||= {}).current = result.trenutni;
  }
  result.version = 2;
  return { snapshot: result, counts, mode, conflicts, settings };
}
export function backupStorageValues(snapshot) {
  const pairs = { library: snapshot.ritmovi || [], programs: snapshot.programs || [], profiles: snapshot.profiles || [], favorites: snapshot.favorites || [], arrangements: snapshot.arrangements || [] };
  if (snapshot.songRuns !== undefined) pairs.songRuns = snapshot.songRuns;
  if (snapshot.podesavanja) pairs.settings = { ...snapshot.podesavanja, ...(snapshot.trenutni ? { current: snapshot.trenutni } : {}) };
  if (snapshot.midiMap) pairs.midiMap = snapshot.midiMap;
  if (snapshot.midiRouting) pairs.midiRouting = snapshot.midiRouting;
  if (snapshot.programDraft) pairs.programDraft = snapshot.programDraft;
  if (snapshot.arrangementDraft) pairs.arrangementDraft = snapshot.arrangementDraft;
  const result = Object.fromEntries(Object.entries(pairs).map(([name, value]) => [store.STORAGE_KEYS[name], JSON.stringify(value)]));
  if (snapshot.language) result[store.STORAGE_KEYS.language] = snapshot.language;
  return result;
}

export class BackupRestore {
  constructor(studio) {
    this.studio = studio; this.imported = null; this.plan = null; this.running = false;
    const section = document.createElement('section'); section.className = 'studio-panel backup-restore'; section.id = 'backupRestore';
    section.innerHTML = `<h3>Rezervna kopija i vraćanje podataka</h3><p>Vrati ritmove, snimke vežbi, programe, profile, favorite i aranžmane. Pregled prikazuje promene pre upisa.</p><div class="row"><button id="backupExportAll">Izvezi sve podatke</button><label class="button">Izaberi rezervnu kopiju<input id="backupRestoreFile" type="file" accept=".json,application/json" hidden></label></div><div id="backupRestoreOptions" hidden><label>Način vraćanja <select id="backupRestoreMode"><option value="merge">Spoji sa postojećim podacima</option><option value="replace">Zameni sve liste podataka</option></select></label><label>Isti identifikator <select id="backupRestoreConflicts"><option value="keep">Zadrži postojeći zapis</option><option value="both">Sačuvaj oba kao posebne zapise</option><option value="replace">Koristi zapis iz kopije</option></select></label><label class="tog"><input id="backupRestoreSettings" type="checkbox"> Vrati i podešavanja, MIDI mapu i trenutni ritam</label><div class="table-wrap"><table class="data-table"><thead><tr><th>Podaci</th><th>U kopiji</th><th>Sukobi</th><th>Novo</th><th>Zamenjeno</th><th>Uklonjeno</th><th>Posle vraćanja</th></tr></thead><tbody id="backupRestorePreview"></tbody></table></div><p id="backupRestoreWarning"></p><button id="backupRestoreApply">Primeni prikazano vraćanje</button><button id="backupRestoreCancel">Otkaži</button></div><p id="backupRestoreStatus" role="status" aria-live="polite"></p>`;
    document.getElementById('settings-app').append(section); this.panel = section; const $ = id => section.querySelector('#' + id); this.$ = $;
    $('backupExportAll').onclick = () => this.export();
    $('backupRestoreFile').onchange = async event => {
      const file = event.target.files[0]; event.target.value = ''; if (!file || this.busy) return;
      this.running = true; this.playState();
      try {
        if (file.size > 100 * 1024 * 1024) throw new Error('Rezervna kopija je prevelika (najviše 100 MB).');
        const imported = validateBackup(JSON.parse(await file.text()));
        if (studio.host.isPlaying() || studio.run) throw new Error('Zaustavi vežbu pre vraćanja podataka.');
        this.imported = imported; this.current = await this.currentSnapshot();
        $('backupRestoreOptions').hidden = false; this.preview(); this.status('Pregled je spreman. Nijedan podatak još nije promenjen.');
      } catch (error) { this.imported = null; this.plan = null; $('backupRestoreOptions').hidden = true; this.status(error.message); }
      finally { this.running = false; this.playState(); }
    };
    for (const id of ['backupRestoreMode', 'backupRestoreConflicts', 'backupRestoreSettings']) $(id).onchange = () => this.preview();
    $('backupRestoreCancel').onclick = () => { this.imported = this.plan = null; $('backupRestoreOptions').hidden = true; this.status('Vraćanje je otkazano.'); };
    $('backupRestoreApply').onclick = () => this.apply();
    this.playState();
  }
  get busy() { return this.running || this.studio.host.isPlaying() || !!this.studio.run || this.studio.replay.playing || this.studio.replay.starting; }
  playState() { for (const el of this.panel.querySelectorAll('input,button,select')) el.disabled = this.busy; this.studio.host.onBusyChange?.(); }
  status(value) { this.$('backupRestoreStatus').textContent = t(value); }
  async currentSnapshot() {
    const live = await this.studio.host.getBackupState?.() || { version: 2, ritmovi: store.loadLibrary(), programs: this.studio.programs, profiles: store.loadProfiles(), favorites: store.loadFavorites() };
    return { ...structuredClone(live), version: 2, sessions: await this.studio.exportSessions(), arrangements: structuredClone(this.studio.arrangements.items), arrangementDraft: structuredClone(this.studio.arrangements.draft) };
  }
  async export() {
    try { store.download('drummer-backup.json', await this.currentSnapshot()); this.status('Rezervna kopija je izvezena.'); }
    catch (error) { this.status(error.message); }
  }
  preview() {
    if (!this.imported || !this.current) return;
    this.plan = planRestore(this.current, this.imported, { mode: this.$('backupRestoreMode').value, conflicts: this.$('backupRestoreConflicts').value, settings: this.$('backupRestoreSettings').checked });
    const names = { songRuns: 'Izveštaj za pesmu', ritmovi: 'Ritmovi', sessions: 'Sesije', programs: 'Programi', profiles: 'Profili', arrangements: 'Aranžmani' };
    this.$('backupRestorePreview').innerHTML = Object.entries(this.plan.counts).map(([key, n]) => `<tr><td>${t(names[key])}</td><td>${n.incoming}</td><td>${n.conflicts}</td><td>${n.added}</td><td>${n.replaced}</td><td>${n.removed}</td><td>${n.total}</td></tr>`).join('');
    this.$('backupRestoreWarning').textContent = this.plan.mode === 'replace' ? 'Zamena uklanja postojeće zapise koji nisu u kopiji. Preporučeno je da prvo izvezeš trenutnu kopiju.' : 'Spajanje zadržava postojeće zapise prema izabranom pravilu sukoba.';
    document.dispatchEvent(new Event('drummer:translate'));
  }
  async apply() {
    if (!this.plan || this.busy) return false;
    this.running = true; this.playState(); this.status('Vraćam podatke…');
    try {
      if (!await this.studio.flushJournal()) throw new Error('Sačuvaj ili izvezi nesačuvane sesije pre vraćanja podataka.');
      // Re-check live data against the preview: never overwrite a practice
      // session or edit created while the user was reviewing the import.
      const current = await this.currentSnapshot();
      if (JSON.stringify(current) !== JSON.stringify(this.current)) { this.current = current; this.preview(); throw new Error('Podaci su se promenili. Pregled je osvežen; ponovo proveri i primeni.'); }
      await this.studio.journal.restore(this.plan.snapshot.sessions, backupStorageValues(this.plan.snapshot));
      const snapshot = this.plan.snapshot;
      this.studio.sessions = await this.studio.journal.list(); this.studio.sessionCache.clear(); this.studio.pendingSessions.clear(); this.studio.selectedId = this.studio.sessions[0]?.id || '';
      this.studio.programs = snapshot.programs;
      if (snapshot.programDraft) { this.studio.program = snapshot.programDraft; this.studio.programDirty = true; }
      if (snapshot.arrangementDraft) { this.studio.arrangements.draft = snapshot.arrangementDraft; this.studio.arrangements.dirty = true; }
      this.studio.arrangements.items = snapshot.arrangements; this.studio.arrangements.render(); this.studio.renderPrograms(); this.studio.renderJournal();
      this.imported = this.plan = null; this.$('backupRestoreOptions').hidden = true; this.status('Podaci su uspešno vraćeni.');
      await this.studio.host.applyRestoredState?.(snapshot); return true;
    } catch (error) { this.status(error.message || 'Vraćanje nije uspelo. Prethodni podaci su očuvani.'); return false; }
    finally { this.running = false; this.playState(); }
  }
}
