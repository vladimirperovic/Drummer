import { INST } from './patterns.js';
import { encodeAiWav } from './ai-audio.js';
import { transcriptionMidi } from './ai-transcription-model.js';
import { songMusicXml } from './song-musicxml.js';

const MAX_AUDIO = 110 * 1024 * 1024, MAX_JSON = 20 * 1024 * 1024;
const safeName = name => typeof name === 'string' && /^[^\\/:*?"<>|\u0000-\u001f]+$/.test(name) && name !== '.' && name !== '..' && name.length <= 180;
export function validateSongProject(value) {
  if (!value || value.format !== 'drummer-song' || value.version !== 1 || typeof value.id !== 'string' || !safeName(value.id) ||
      typeof value.fileName !== 'string' || value.fileName.length > 300 || !Number.isFinite(value.durationSeconds) || value.durationSeconds <= 0 || value.durationSeconds > 600 ||
      !Number.isFinite(value.bpm) || value.bpm < 30 || value.bpm > 260 || ![4, 8].includes(value.meter?.beatUnit) ||
      !Number.isInteger(value.meter?.beats) || value.meter.beats < 2 || value.meter.beats > 12 || ![12, 16].includes(value.division) ||
      !Number.isFinite(value.offsetSeconds) || value.offsetSeconds < 0 || value.offsetSeconds >= value.durationSeconds ||
      !Array.isArray(value.events) || !value.events.length || value.events.length > 100000 ||
      value.events.some(e => !e || !Object.hasOwn(INST, e.inst) || !Number.isFinite(e.timeSeconds) || e.timeSeconds < 0 || e.timeSeconds >= value.durationSeconds ||
        (e.velocity !== undefined && (!Number.isFinite(e.velocity) || e.velocity < 1 || e.velocity > 127)))) throw new Error('Invalid song project');
  for (const kind of ['original', 'drums', 'without', 'musicxml', 'midi']) {
    const asset = value.files?.[kind];
    if (!asset || !safeName(asset.name) || !Number.isInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > (['musicxml', 'midi'].includes(kind) ? MAX_JSON : MAX_AUDIO)) throw new Error('Invalid song files');
  }
  if (new Set(Object.values(value.files).map(f => f.name)).size !== 5) throw new Error('Invalid song files');
  return value;
}

async function writeFile(directory, name, value) {
  const handle = await directory.getFileHandle(name, { create: true }), stream = await handle.createWritable();
  try { await stream.write(value); await stream.close(); }
  catch (error) { await stream.abort().catch(() => {}); throw error; }
}

export async function saveSongProject(directory, song) {
  if (!song?.file || !song.drums || !song.without || !song.events?.length) throw new Error('First separate drums and transcribe the song.');
  const title = song.file.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 60).trim() || 'song';
  const id = `${title}-${crypto.randomUUID()}`;
  const extension = /\.([a-z0-9]{1,8})$/i.exec(song.file.name)?.[1] || 'audio';
  const metadata = { format: 'drummer-song', version: 1, id, fileName: song.file.name, savedAt: new Date().toISOString(),
    durationSeconds: song.durationSeconds, bpm: song.bpm, meter: song.meter, division: song.division, offsetSeconds: song.offsetSeconds,
    models: song.models, events: structuredClone(song.events), files: {} };
  const assets = [
    ['original', `original.${extension}`, () => song.file],
    ['drums', 'drums.wav', () => new Blob([encodeAiWav(song.drums)], { type: 'audio/wav' })],
    ['without', 'without-drums.wav', () => new Blob([encodeAiWav(song.without)], { type: 'audio/wav' })],
    ['musicxml', 'notes.musicxml', () => new Blob([songMusicXml(metadata)], { type: 'application/vnd.recordare.musicxml+xml' })],
    ['midi', 'notes.mid', () => new Blob([transcriptionMidi(song.events, { bpm: song.bpm, ...song.meter, durationSeconds: song.durationSeconds })], { type: 'audio/midi' })],
  ];
  // New immutable revision per save; never overwrite the last working song.
  try { await directory.getDirectoryHandle(id); throw new Error('Song folder already exists'); }
  catch (error) { if (error.name !== 'NotFoundError') throw error; }
  const folder = await directory.getDirectoryHandle(id, { create: true });
  for (const [kind, name, build] of assets) {
    const blob = build(); metadata.files[kind] = { name, bytes: blob.size }; await writeFile(folder, name, blob);
  }
  validateSongProject(metadata);
  // Manifest is the commit marker. Partial writes are not offered for practice.
  await writeFile(folder, 'song.json', JSON.stringify(metadata));
  return { metadata, folder };
}

async function manifest(folder) {
  const file = await (await folder.getFileHandle('song.json')).getFile();
  if (file.size > MAX_JSON) throw new Error('Song metadata is too large');
  return validateSongProject(JSON.parse(await file.text()));
}

export async function listSongProjects(directory) {
  const entries = [], seen = new Set(); let skipped = 0;
  for await (const [, folder] of directory.entries()) {
    if (folder.kind !== 'directory') continue;
    try { const metadata = await manifest(folder); if (seen.has(metadata.id)) { skipped++; continue; } seen.add(metadata.id); entries.push({ metadata, folder }); }
    catch { skipped++; }
  }
  entries.sort((a, b) => a.metadata.fileName.localeCompare(b.metadata.fileName) || String(b.metadata.savedAt).localeCompare(String(a.metadata.savedAt)));
  return { entries, skipped };
}

export async function songAsset(entry, kind) {
  const meta = validateSongProject(entry.metadata), asset = meta.files[kind];
  if (!asset) throw new Error('Unknown song asset');
  const file = await (await entry.folder.getFileHandle(asset.name)).getFile();
  if (file.size !== asset.bytes) throw new Error('Song file is missing or incomplete');
  return file;
}

export async function loadSongProject(entry) {
  // Re-read metadata so external edits cannot silently mix two revisions.
  const metadata = await manifest(entry.folder), fresh = { ...entry, metadata }, buffers = {};
  for (const kind of ['musicxml', 'midi']) await songAsset(fresh, kind);
  const context = new AudioContext({ sampleRate: 44100 });
  try {
    for (const kind of ['original', 'drums', 'without']) {
      const file = await songAsset(fresh, kind), buffer = await context.decodeAudioData(await file.arrayBuffer());
      if (buffer.numberOfChannels > 2 || Math.abs(buffer.duration - metadata.durationSeconds) > .1) throw new Error('Song audio does not match the saved notes');
      buffers[kind] = buffer;
    }
    return { ...metadata, buffers };
  } finally { await context.close(); }
}

// Only the directory handle lives in browser storage. Audio and notes are real
// files in the chosen laptop folder and survive clearing browser data.
export async function libraryHandle(value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('drummer-song-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', value ? 'readwrite' : 'readonly');
      const request = value ? tx.objectStore('settings').put(value, 'directory') : tx.objectStore('settings').get('directory');
      tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
