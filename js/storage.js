// Čuvanje ritmova i podešavanja u browseru, i izvoz/uvoz JSON fajlova.

import { normalize } from './patterns.js';

const LIB_KEY = 'trener.ritmovi.v1';
const SET_KEY = 'trener.podesavanja.v1';
const FAV_KEY = 'drummer.favorites.v1';
let onError = () => {};
export function setErrorHandler(fn) { onError = fn; }
export function reportError(error, key = 'drummer.journal') { onError(error, key); }
export const STORAGE_KEYS = Object.freeze({ library: LIB_KEY, settings: SET_KEY, favorites: FAV_KEY,
  songRuns: 'drummer.songRuns.v1', sessions: 'drummer.sessions.v1', programs: 'drummer.programs.v1', profiles: 'drummer.profiles.v1',
  midiMap: 'trener.midiMapa.v1', midiRouting: 'drummer.midiRouting.v1', language: 'drummer.language.v1', arrangements: 'drummer.arrangements.v1', arrangementDraft: 'drummer.arrangementDraft.v1', programDraft: 'drummer.programDraft.v1' });

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (error) { onError(error, key); return false; }
}

const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
export const readList = key => { const v = read(key, []); return Array.isArray(v) ? v.filter(isObject) : []; };
export const loadLibrary = () => readList(LIB_KEY).filter(p => isObject(p.steps)).map(normalize);
export const saveLibrary = list => write(LIB_KEY, list);
const favoriteIds = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 200))] : [];
export const loadFavorites = () => favoriteIds(read(FAV_KEY, []));
export const saveFavorites = ids => write(FAV_KEY, favoriteIds(ids));

export function loadSettings(defaults) {
  const value = read(SET_KEY, {}), s = isObject(value) ? value : {};
  return { ...defaults, ...s, vol: { ...defaults.vol, ...s.vol }, trainer: { ...defaults.trainer, ...s.trainer } };
}
export const saveSettings = s => write(SET_KEY, s);
export const saveSessions = list => write('drummer.sessions.v1', list);
export const loadSessions = () => readList('drummer.sessions.v1');
export const savePrograms = list => write('drummer.programs.v1', list);
export const loadPrograms = () => readList('drummer.programs.v1');
export const saveProfiles = list => write('drummer.profiles.v1', list);
export const loadProfiles = () => readList('drummer.profiles.v1');
export const saveMidiMap = map => write('trener.midiMapa.v1', map);
export const saveArrangements = list => write(STORAGE_KEYS.arrangements, list);
export const loadArrangements = () => readList(STORAGE_KEYS.arrangements);
export const loadArrangementDraft = () => read(STORAGE_KEYS.arrangementDraft, null);
export const loadProgramDraft = () => read(STORAGE_KEYS.programDraft, null);
export const saveArrangementDraft = value => write(STORAGE_KEYS.arrangementDraft, value);
export const saveProgramDraft = value => write(STORAGE_KEYS.programDraft, value);

export const newId = () => 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(filename, blob);
}

export function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Prima jedan ritam, niz ritmova ili { ritmovi: [...] }
export async function importFile(file) {
  const data = JSON.parse(await file.text());
  const list = Array.isArray(data) ? data : Array.isArray(data?.ritmovi) ? data.ritmovi : [data];
  return list
    .filter(p => isObject(p) && isObject(p.steps))
    .map(p => normalize({ ...p, id: newId(), preset: false }));
}
