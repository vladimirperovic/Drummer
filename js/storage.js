// Čuvanje ritmova i podešavanja u browseru, i izvoz/uvoz JSON fajlova.

import { normalize } from './patterns.js';

const LIB_KEY = 'trener.ritmovi.v1';
const SET_KEY = 'trener.podesavanja.v1';

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export const loadLibrary = () => read(LIB_KEY, []).map(normalize);
export const saveLibrary = list => write(LIB_KEY, list);

export function loadSettings(defaults) {
  const s = read(SET_KEY, {});
  return { ...defaults, ...s, vol: { ...defaults.vol, ...s.vol }, trainer: { ...defaults.trainer, ...s.trainer } };
}
export const saveSettings = s => write(SET_KEY, s);

export const newId = () => 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Prima jedan ritam, niz ritmova ili { ritmovi: [...] }
export async function importFile(file) {
  const data = JSON.parse(await file.text());
  const list = Array.isArray(data) ? data : Array.isArray(data.ritmovi) ? data.ritmovi : [data];
  return list
    .filter(p => p && typeof p === 'object' && p.steps)
    .map(p => normalize({ ...p, id: newId(), preset: false }));
}
