import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encodeAiWav } from '../js/ai-audio.js';

const browser = await chromium.launch({ headless: true });
const output = resolve(process.env.DRUMMER_ARTIFACTS || 'artifacts/song-library');
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route(/https:\/\/(huggingface.co|cdn.jsdelivr.net)\//, route => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('drummer.language.v1', 'sr');
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => ({ inputs: new Map(), outputs: new Map() }) });
    // Real FileSystemDirectoryHandle, writable streams and IndexedDB. Only the
    // OS picker is replaced so the suite never touches the user's folders.
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('qa-songs', { create: true });
    const NativeWorker = window.Worker;
    window.Worker = class {
      constructor(url, options) { if (!/ai-transcription-worker|drum-separator-worker/.test(String(url))) return new NativeWorker(url, options); }
      terminate() { this.dead = true; }
      postMessage(message) {
        setTimeout(() => {
          if (this.dead) return;
          let result = { backend: 'wasm', threads: 1, inferenceMs: 1 };
          if (message.type === 'separate') result = { ...result, channels: message.channels.map(channel => channel.map(value => value * .5)), sampleRate: 44100 };
          if (message.type === 'transcribe') {
            const activations = new Float32Array(Math.ceil(message.audio.length / 441) * 5);
            activations[20 * 5] = .95; activations[70 * 5 + 1] = .95;
            result = { ...result, modelId: message.modelId, durationSeconds: message.audio.length / 44100, activations };
          }
          this.onmessage?.({ data: { id: message.id, type: 'result', result } });
        }, 10);
      }
    };
  });
  await page.goto(process.env.DRUMMER_URL || 'http://127.0.0.1:8123');
  await page.waitForSelector('#songLibraryChoose', { state: 'attached', timeout: 60000 }).catch(error => { throw new Error(`${error.message}: ${errors.join('; ')}`); });
  await page.locator('button[data-mode=song]').click();
  const showLibrary = () => page.locator('#appNav [data-pane=songlibrary]').click();
  const signal = Float32Array.from({ length: 88200 }, (_, i) => .1 * Math.sin(2 * Math.PI * 80 * i / 44100));
  const bytes = Buffer.from(encodeAiWav([signal]));
  for (const name of ['Alpha.wav', 'Beta.wav']) {
    await page.locator('#appNav [data-pane=ai]').click();
    await page.locator('#aiAudioFile').setInputFiles({ name, mimeType: 'audio/wav', buffer: bytes });
    await page.waitForFunction(() => !document.querySelector('#aiSeparate').disabled);
    assert.equal(await page.locator('#aiSaveSong').isDisabled(), true);
    await page.locator('#aiSeparate').click();
    await page.waitForFunction(() => document.querySelector('#aiTranscriptionSource').value === 'drums');
    await page.locator('#aiTranscribe').click(); await page.locator('#aiReview').waitFor();
    if (name === 'Alpha.wav') {
      const downloaded = page.waitForEvent('download'); await page.locator('#aiExportMusicXml').click();
      const file = resolve(output, 'Alpha.musicxml'); await (await downloaded).saveAs(file);
      assert.match(await readFile(file, 'utf8'), /score-partwise version="4.0"/);
    }
    await page.locator('#aiSaveSong').click();
    await page.waitForFunction(() => document.querySelector('[data-library-status]').textContent.includes('Sačuvano u fascikli'))
      .catch(async error => { throw new Error(`${error.message}: ${await page.locator('[data-library-status]').textContent()}; ${errors.join('; ')}`); });
  }
  assert.equal(await page.locator('.song-library-item').count(), 2);
  const stored = await page.evaluate(async () => {
    const { libraryHandle, listSongProjects, songAsset } = await import('/js/song-library-store.js');
    const directory = await libraryHandle(), { entries } = await listSongProjects(directory);
    const first = entries[0], names = []; for await (const [name] of first.folder.entries()) names.push(name);
    return { names, original: [...new Uint8Array(await (await songAsset(first, 'original')).arrayBuffer())], meta: first.metadata };
  });
  assert.deepEqual(stored.names.sort(), ['drums.wav', 'notes.mid', 'notes.musicxml', 'original.wav', 'song.json', 'without-drums.wav'].sort());
  assert.deepEqual(Buffer.from(stored.original), bytes, 'original file is byte-for-byte preserved');
  assert.equal(stored.meta.events.length, 2);
  console.log('PASS Library: processed song saves original bytes, both stems, full MusicXML/MIDI and reference metadata');

  await page.reload(); await page.waitForSelector('#songLibraryChoose', { state: 'attached' });
  await page.locator('button[data-mode=song]').click(); await showLibrary();
  await page.waitForFunction(() => document.querySelectorAll('.song-library-item').length === 2);
  await page.locator('#songLibrarySearch').fill('alpha'); assert.equal(await page.locator('.song-library-item').count(), 1);
  await page.locator('#songLibrarySearch').fill('');
  await page.locator('[data-library-load]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-play-info]').textContent.includes('Alpha.wav'));
  assert.equal(await page.locator('[data-play-backing]').inputValue(), 'without');
  await page.locator('[data-play-start]').click();
  await page.waitForFunction(() => document.querySelector('[data-play-start]').textContent.includes('Zaustavi'));
  await page.locator('#songLibraryNext').click();
  await page.waitForFunction(() => document.querySelector('[data-play-info]').textContent.includes('Beta.wav'));
  await page.waitForFunction(() => document.querySelector('[data-play-start]').textContent.includes('Zaustavi'));
  await page.locator('#songLibraryPrevious').click();
  await page.waitForFunction(() => document.querySelector('[data-play-info]').textContent.includes('Alpha.wav'));
  await page.locator('[data-play-start]').click();
  console.log('PASS Library: reconnect after reload, search, load and switch active practice in both directions');

  await page.evaluate(async () => {
    const store = await import('/js/song-library-store.js');
    const dir = await store.libraryHandle(), { entries } = await store.listSongProjects(dir), first = entries[0];
    const song = { ...first.metadata, file: await store.songAsset(first, 'original'), drums: [new Float32Array(88200)], without: [new Float32Array(88200)] };
    const failing = { async getDirectoryHandle(name, options) {
      const folder = await dir.getDirectoryHandle(name, options);
      return { async getFileHandle(file, opts) {
        if (file === 'without-drums.wav') throw new DOMException('Disk full', 'QuotaExceededError');
        return folder.getFileHandle(file, opts);
      } };
    } };
    let failed = false; try { await store.saveSongProject(failing, song); } catch (error) { failed = error.name === 'QuotaExceededError'; }
    const after = await store.listSongProjects(dir);
    if (!failed || after.entries.length !== 2 || after.skipped !== 1) throw new Error('Failed save damaged the library');
    if ((await store.songAsset(after.entries[0], 'original')).size !== song.file.size) throw new Error('Previous revision changed');
  });
  await showLibrary();
  await page.evaluate(() => {
    window.__realPicker = window.showDirectoryPicker;
    window.showDirectoryPicker = async () => {
      const folder = await window.__realPicker();
      return { name: folder.name, entries: folder.entries.bind(folder), queryPermission: async () => 'denied', requestPermission: async () => 'denied' };
    };
  });
  await page.locator('#songLibraryChoose').click();
  await page.locator('[data-library-load]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-library-status]').textContent.includes('Pristup fascikli nije odobren'));
  assert.match(await page.locator('[data-play-info]').textContent(), /Alpha.wav/);
  await page.evaluate(() => { window.showDirectoryPicker = window.__realPicker; });
  await page.locator('#songLibraryChoose').click();
  console.log('PASS Library: interrupted disk write preserves earlier songs; denied access unlocks controls and can reconnect');

  await page.evaluate(async () => {
    const store = await import('/js/song-library-store.js');
    const dir = await store.libraryHandle(), { entries } = await store.listSongProjects(dir);
    const bad = structuredClone(entries[0].metadata); bad.files.original.name = '../outside.wav';
    let rejected = false; try { store.validateSongProject(bad); } catch { rejected = true; }
    if (!rejected) throw new Error('Path traversal was accepted');
    const folder = await dir.getDirectoryHandle('unfinished', { create: true });
    const stream = await (await folder.getFileHandle('original.wav', { create: true })).createWritable(); await stream.write('partial'); await stream.close();
    const scanned = await store.listSongProjects(dir);
    if (scanned.entries.length !== 2 || scanned.skipped !== 2) throw new Error('Incomplete song was offered');
    const broken = await (await entries[1].folder.getFileHandle('drums.wav')).createWritable(); await broken.write('broken'); await broken.close();
  });
  await showLibrary(); await page.locator('[data-library-load]').nth(1).click();
  await page.waitForFunction(() => document.querySelector('[data-library-status]').textContent.includes('missing or incomplete'));
  assert.match(await page.locator('[data-play-info]').textContent(), /Alpha.wav/, 'failed load preserves the previous reference');
  assert.equal(await page.locator('#songLibraryChoose').isDisabled(), false);
  console.log('PASS Library: reject unsafe paths, hide incomplete saves and preserve current song after damaged audio');

  const scoreChecks = await page.evaluate(async () => {
    const { songMusicXml } = await import('/js/song-musicxml.js');
    const { drumParts, drumKeys } = await import('/js/score-drums.js');
    const events = [{ inst: 'kick', timeSeconds: .1, velocity: 44 }, { inst: 'hh', timeSeconds: .1, velocity: 115 }, { inst: 'snare', timeSeconds: 89.8, velocity: 90 }];
    const source = songMusicXml({ events, fileName: 'Full <song> & score', durationSeconds: 90, bpm: 120, meter: { beats: 6, beatUnit: 8 }, division: 12, offsetSeconds: .2 });
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('XML parse error');
    let balanced = true;
    for (const measure of doc.querySelectorAll('part > measure')) {
      const duration = [...measure.querySelectorAll(':scope > note')].filter(n => !n.querySelector('chord')).reduce((sum, n) => sum + Number(n.querySelector('duration').textContent), 0);
      if (duration !== 1440) balanced = false;
    }
    window.__scoreXml = source;
    return { bars: doc.querySelectorAll('part > measure').length, hits: doc.querySelectorAll('unpitched').length,
      chords: doc.querySelectorAll('chord').length, balanced, keys: drumKeys(doc, 'P1').map(k => k.suggested), parts: drumParts(doc).length,
      lastBar: !!doc.querySelector('part > measure:last-child unpitched'), title: doc.querySelector('work-title').textContent };
  });
  assert.ok(scoreChecks.bars > 8); assert.equal(scoreChecks.hits, 3); assert.equal(scoreChecks.chords, 1);
  assert.equal(scoreChecks.balanced, true); assert.equal(scoreChecks.parts, 1); assert.equal(scoreChecks.lastBar, true);
  assert.deepEqual(scoreChecks.keys.sort(), ['hh', 'kick', 'snare']); assert.equal(scoreChecks.title, 'Full <song> & score');
  await page.addScriptTag({ url: '/js/vendor/opensheetmusicdisplay.min.js' });
  await page.evaluate(async () => {
    const container = document.createElement('div'); container.id = 'qa-score'; document.body.append(container);
    const score = new opensheetmusicdisplay.OpenSheetMusicDisplay(container, { backend: 'svg', autoResize: false, drawTitle: true });
    await score.load(window.__scoreXml); score.render();
    if (!container.querySelector('svg')) throw new Error('MusicXML did not render');
  });
  console.log('PASS MusicXML: full song, /8 triplets, chords, lead-in hits, dynamics, escaping, balanced bars and OSMD rendering');
  await page.evaluate(() => document.querySelector('#qa-score').remove());
  await page.locator('#languageSelect').selectOption('en');
  assert.equal(await page.locator('#songLibraryChoose').textContent(), 'Choose folder');
  await page.setViewportSize({ width: 390, height: 844 }); await showLibrary();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.screenshot({ path: resolve(output, 'library-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS Library: English, phone layout and no uncaught browser errors');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 });
  await context.setOffline(true); await page.reload();
  await page.waitForSelector('#songLibraryChoose', { state: 'attached' });
  await showLibrary(); await page.waitForFunction(() => document.querySelectorAll('[data-library-load]').length === 2);
  await page.locator('[data-library-load]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-play-info]').textContent.includes('Alpha.wav'));
  assert.deepEqual(errors, []);
  console.log('PASS Library: installed service worker reloads offline and loads a saved song without models or network');
  await context.close();
} finally { await browser.close(); }
