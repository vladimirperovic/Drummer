// Bump VERSION whenever a cached application file changes.
const VERSION = '2026-10-29-roadmap-ai-2';
const ROOT = new URL('./', self.location.href);
const PREFIX = `drummer:${ROOT.pathname}:`;
const CACHE = PREFIX + VERSION;
const ASSETS = ['./', 'index.html', 'style.css', 'manifest.webmanifest',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md',
  'editor-tools.css', 'rhythm-capture.css', 'routing-next.css', 'studio-next.css', 'ai-tools.css',
  'js/editor-model.js', 'js/editor-tools.js', 'js/editor-next-i18n.js',
  'js/rhythm-capture.js', 'js/rhythm-capture-model.js', 'js/capture-next-i18n.js',
  'js/arrangements.js', 'js/backup-restore.js', 'js/journal-store.js', 'js/studio-next-i18n.js',
  'js/midi-routing.js', 'js/midi-routing-ui.js', 'js/routing-next-i18n.js', 'js/library-preview.js',
  'js/ai-tools.js', 'js/ai-tools-i18n.js', 'js/ai-model-cache.js', 'js/ai-audio.js', 'js/ai-reference.js',
  'js/ai-transcriber.js', 'js/ai-transcription-model.js', 'js/ai-transcription-worker.js',
  'js/drum-separator.js', 'js/drum-separator-core.js', 'js/drum-separator-worker.js',
  'js/vendor/ort-wasm-1.31.1.min.mjs', 'js/vendor/ORT-LICENSE.txt',
  'js/vendor/DEMUCS-LICENSE.txt', 'js/vendor/DEMUCS-ONNX-LICENSE.txt',
  'js/vendor/ADTOF-LICENSE.txt', 'js/vendor/ADTOF-NOTICE.txt', 'js/vendor/OSMD-PROVENANCE.txt',
  'performance-report.css', 'score-import.css', 'js/performance-report.js', 'js/score-import.js',
  'js/vendor/opensheetmusicdisplay.min.js', 'js/vendor/OSMD-LICENSE.txt', 'js/vendor/opensheetmusicdisplay.min.js.LICENSE.txt',
  'js/kit-drag.js', 'js/kit-play.js', 'assets/kit/pick-map.png',
  'icons/drummer-192.png', 'icons/drummer-512.png', 'kits/index.json',
  'js/main.js', 'js/patterns.js', 'js/notation.js', 'js/kit.js', 'js/audio.js', 'js/midi.js',
  'js/scoring.js', 'js/storage.js', 'js/practice.js', 'js/studio.js', 'js/backing.js', 'js/replay.js',
  'js/profiles.js', 'js/midi-file.js', 'js/workbench.js', 'js/printing.js', 'js/pwa.js', 'js/i18n.js',
  'js/preset-catalog.js', 'js/workspace-view.js', 'js/kit-view.js', 'js/kit-3d.js', 'js/agent-tools.js',
  'js/kit-config.js', 'js/kit-config-ui.js', 'js/kit-config-2d.js',
  'js/vendor/three.module.js', 'js/vendor/three.core.js', 'js/vendor/OrbitControls.js', 'js/vendor/THREE-LICENSE.txt', 'js/kit-art-data.js',
  'assets/kit/drummer-2d.png', ...['kick', 'snare', 'tom1', 'tom2', 'tom3', 'rim', 'hihat', 'crash', 'ride', 'bell', 'crash2', 'hhpedal'].map(id => `assets/kit/mask-${id}.png`)];
const URLS = new Set(ASSETS.map(path => new URL(path, ROOT).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(path => new Request(new URL(path, ROOT), { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => { if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ROOT.origin) return;
  const navigation = request.mode === 'navigate' && [ROOT.pathname, ROOT.pathname + 'index.html'].includes(url.pathname);
  if (!navigation && !URLS.has(url.href) && !url.pathname.startsWith(ROOT.pathname + 'kits/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = navigation ? new URL('index.html', ROOT).href : request;
    const cached = await cache.match(key);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(key, response.clone());
    return response;
  })());
});
