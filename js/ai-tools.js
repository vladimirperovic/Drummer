import { t } from './i18n.js';
import { blankPattern, INSTRUMENTS, slotsPerBar, totalSlots } from './patterns.js';
import { renderNotation } from './notation.js';
import { downloadBlob } from './storage.js';
import { createDrumTranscriber, getTranscriberModelInfo, TRANSCRIBER_MODELS } from './ai-transcriber.js';
import { createDrumSeparator, getSeparatorModelInfo, SEPARATOR_MODELS } from './drum-separator.js';
import { getTranscriptionClasses, transcriptionEvents, estimateDrumTempo, transcriptionMidi } from './ai-transcription-model.js';
import { renderModelDescription, modelReviewText } from './ai-model-ui.js';
import { AI_WASM_ASSET, AI_WEBGPU_WASM_ASSET, isAiAssetCached, clearAiModelCache, hasWebGpu, aiThreadCount } from './ai-model-cache.js';
import { decodeAiAudio, encodeAiWav, aiAudioBuffer } from './ai-audio.js';
import { navigate, adoptPane } from './navigation.js';
import { songMusicXml } from './song-musicxml.js';

const format = (source, values = {}) => t(source).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
const channelsOf = buffer => Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
const mb = bytes => (bytes / 1000000).toFixed(1);

export function createAiTools(host = {}) {
  const container = host.container || document.getElementById('section-song'), panel = document.createElement('section');
  panel.id = 'tool-ai'; panel.className = 'studio-panel ai-tools-panel'; panel.hidden = true;
  container.append(panel); adoptPane(panel, 'ai', container.dataset.sectionPanel || 'song');
  panel.innerHTML = `<h2>Pesma → bubnjevi → note</h2><p class="muted">Audio se obrađuje na ovom uređaju. Internet je potreban samo za opciono preuzimanje modela; audio se ne šalje na server.</p>
    <label class="btn ai-file-label">Izaberi audio (MP3, WAV…)<input id="aiAudioFile" type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a" hidden></label><p id="aiAudioInfo" class="muted">Mono ili stereo, do 100 MB i 10 minuta.</p><p id="aiBackend" class="muted"></p>
    <div class="ai-controls"><label>Slušaj<select id="aiAudition"><option value="original">Original</option><option value="drums" disabled>Samo bubnjevi</option><option value="without" disabled>Bez bubnjeva</option></select></label><button id="aiExportWav" disabled>Izvezi izabrani WAV</button></div><audio id="aiPlayer" controls preload="metadata" hidden></audio>
    <div class="ai-options"><section class="ai-model-card"><h3>1. Izdvoji samo bubnjeve</h3><label>Model za izdvajanje<select id="aiSeparationModel"></select></label><div id="aiSeparationDescription" class="ai-model-description" data-user-text></div><p class="muted">Obrada cele pesme može trajati više minuta i zahteva dosta memorije. Prekid je dostupan u svakom trenutku.</p><button id="aiSeparate" disabled></button></section>
    <section class="ai-model-card"><h3>2. Pretvori bubnjeve u note</h3><label>Model za note<select id="aiTranscriptionModel"></select></label><div id="aiTranscriptionDescription" class="ai-model-description" data-user-text></div><label>Izvor za note<select id="aiTranscriptionSource"><option value="original">Original</option><option value="drums" disabled>Samo bubnjevi</option></select></label><button id="aiTranscribe" disabled></button></section></div>
    <progress id="aiProgress" max="1" value="0" hidden></progress><p id="aiStatus" class="ai-status" role="status" aria-live="polite"></p><div class="ai-controls"><button id="aiCancel" hidden>Prekini AI obradu</button><button id="aiClearCache">Obriši preuzete AI modele</button></div>
    <section id="aiReview" class="ai-review" hidden><h3>Proveri predlog nota</h3><p id="aiReviewDescription" class="muted" data-user-text></p>
    <div id="aiClassMap" class="ai-class-map"></div><div class="ai-controls"><label id="aiSensitivityLabel">Osetljivost<input id="aiSensitivity" type="range" min="50" max="200" step="5" value="100"></label><label>BPM<input id="aiBpm" type="number" min="30" max="260" value="120"></label><button id="aiEstimateTempo">Predloži tempo</button><label>Doba<input id="aiBeats" type="number" min="2" max="7" value="4"></label><label>Jedinica<select id="aiBeatUnit"><option value="4">/4</option><option value="8">/8</option></select></label><label>Podela<select id="aiDivision"><option value="16">Šesnaestine</option><option value="12">Triole</option></select></label><label>Prva doba (sekunde)<input id="aiOffset" type="number" min="0" step="0.01" value="0"></label></div>
    <div class="ai-controls"><label>Pregled od takta<input id="aiPreviewBar" type="number" min="1" value="1"></label><label>Pratnja<select id="aiBacking"><option value="original">Original</option><option value="without" disabled>Bez bubnjeva</option></select></label></div><p id="aiNotesInfo" class="muted"></p><div id="aiNotePreview" class="ai-note-preview"></div><div class="ai-controls"><button id="aiPlayAlong" class="primary">▶ Sviraj uz pesmu</button><button id="aiApply">Napravi aranžman sa notama</button><button id="aiExportMidi">Izvezi MIDI</button></div></section>`;
  const el = id => panel.querySelector('#' + id), models = { transcription: getTranscriberModelInfo(), separation: getSeparatorModelInfo() };
  for (const [id, label] of [['aiExportMusicXml', 'Izvezi MusicXML'], ['aiSaveSong', 'Sačuvaj u biblioteku']]) {
    const button = document.createElement('button'); button.id = id; button.textContent = label; button.title = label;
    el('aiExportMidi').parentElement.append(button);
  }
  const libraryLink = document.createElement('button'); libraryLink.dataset.pane = 'songlibrary'; libraryLink.textContent = libraryLink.title = 'Biblioteka pesama';
  el('aiAudioInfo').before(libraryLink);
  const MODEL_KEY = 'drummer.aiModels.v1';
  let savedModels; try { savedModels = JSON.parse(localStorage.getItem(MODEL_KEY)); } catch {}
  for (const [key, id, choices, info] of [['separation', 'aiSeparationModel', SEPARATOR_MODELS, getSeparatorModelInfo], ['transcription', 'aiTranscriptionModel', TRANSCRIBER_MODELS, getTranscriberModelInfo]]) {
    el(id).replaceChildren(...choices.map(model => { const option = new Option(`${model.name} · ${mb(model.downloadBytes ?? model.bytes)} MB`, model.id); option.dataset.userText = ""; return option; }));
    if (choices.some(model => model.id === savedModels?.[key])) models[key] = info(savedModels[key]);
    el(id).value = models[key].id;
  }
  let file = null, original = null, drums = null, without = null, analysis = null, events = [], controller = null, generation = 0, running = false, playing = false, destroyed = false;
  let transcriber, separator, gpu = false, lastRun = null, cacheGeneration = 0; const audioUrls = new Map(), cacheState = { transcription: false, separation: false }, downloadSize = {};
  // Izbor GPU/CPU se meri pri prvoj obradi svakog modela i pamti u ovom browseru.
  const PREF_KEY = 'drummer.aiBackend.v1';
  const prefs = () => { try { const value = JSON.parse(localStorage.getItem(PREF_KEY)); return value && typeof value === 'object' ? value : {}; } catch { return {}; } };
  const preference = key => { if (models[key].backendPreference) return models[key].backendPreference; const saved = prefs()[models[key].id]?.chosen; return saved === 'wasm' || saved === 'webgpu' ? saved : 'auto'; };
  function remember(key, result) {
    if (!result?.benchmark) return;
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...prefs(), [models[key].id]: { ...result.benchmark, threads: result.threads, at: new Date().toISOString() } })); } catch {}
  }
  // Runtimes a model still needs: CPU always; the GPU build only while GPU is still being measured or was faster.
  const runtimes = key => [AI_WASM_ASSET, ...(gpu && preference(key) !== 'wasm' ? [AI_WEBGPU_WASM_ASSET] : [])];
  const cpuLabel = threads => threads > 1 ? format('CPU sa {threads} niti', { threads }) : t('CPU sa jednom niti');
  function choiceLabel(key) {
    if (models[key].backendPreference === 'wasm') return cpuLabel(aiThreadCount());
    const saved = prefs()[models[key].id];
    if (!saved?.chosen) return gpu ? format('GPU ili {cpu}, meri se pri prvoj obradi', { cpu: cpuLabel(aiThreadCount()) }) : cpuLabel(aiThreadCount());
    if (saved.chosen === 'webgpu') return saved.cpuMs ? format('GPU (WebGPU), {ratio}× brže od CPU', { ratio: (saved.cpuMs / saved.gpuMs).toFixed(1) }) : 'GPU (WebGPU)';
    const why = saved.reason ? t('GPU ne podržava ovaj model') : saved.gpuMs && saved.cpuMs ? format('GPU je {ratio}× sporiji', { ratio: (saved.gpuMs / saved.cpuMs).toFixed(1) }) : '';
    return cpuLabel(aiThreadCount()) + (why ? ` (${why})` : '');
  }
  function backendInfo() {
    const lines = [format('Izdvajanje: {choice}.', { choice: choiceLabel('separation') }), format('Prepoznavanje: {choice}.', { choice: choiceLabel('transcription') })];
    if (aiThreadCount() === 1) lines.push(t('Za više jezgara pokreni aplikaciju komandom python3 alati/server.py ili je ponovo otvori posle pripreme offline verzije.'));
    if (lastRun) lines.push(format('Poslednja obrada: {where}, {seconds} s.', { where: lastRun.backend === 'webgpu' ? 'GPU (WebGPU)' : cpuLabel(lastRun.threads), seconds: Math.round(lastRun.inferenceMs / 1000) }));
    el('aiBackend').textContent = lines.join(' ');
  }
  const busy = () => running || playing, blocked = () => running || !!host.isBusy?.();
  function notifyBusy() { host.onBusyChange?.(busy()); }
  function status(source, values) { el('aiStatus').textContent = format(source, values); }
  function stopAudio() { el('aiPlayer').pause(); if (playing) { playing = false; notifyBusy(); } }
  function clearAudio() { stopAudio(); el('aiPlayer').removeAttribute('src'); el('aiPlayer').load(); for (const url of audioUrls.values()) URL.revokeObjectURL(url); audioUrls.clear(); }
  function refresh() {
    if (destroyed) return;
    const locked = blocked();
    for (const control of panel.querySelectorAll('input,select,button')) control.disabled = locked;
    el('aiCancel').disabled = false; el('aiCancel').hidden = !running;
    el('aiSeparate').disabled = locked || !original; el('aiTranscribe').disabled = locked || !original;
    el('aiExportWav').disabled = locked || !original; el('aiApply').disabled = locked || !events.length; el('aiPlayAlong').disabled = locked || !events.length; el('aiExportMidi').disabled = locked || !events.length;
    el('aiExportMusicXml').disabled = locked || !events.length;
    el('aiSaveSong').disabled = locked || !events.length || !drums || !without;
    for (const id of ['aiAudition', 'aiTranscriptionSource', 'aiBacking']) for (const option of el(id).options) if (option.value !== 'original') option.disabled = !drums;
    const size = key => mb(downloadSize[key] ?? (models[key].downloadBytes + runtimes(key).reduce((sum, asset) => sum + asset.bytes, 0)));
    el('aiSeparate').textContent = cacheState.separation ? t('Izdvoji bubnjeve') : format('Preuzmi i izdvoji (do {mb} MB)', { mb: size('separation') });
    el('aiTranscribe').textContent = cacheState.transcription ? t('Prepoznaj note') : format('Preuzmi i prepoznaj (do {mb} MB)', { mb: size('transcription') });
    renderModelDescription(el('aiSeparationDescription'), models.separation);
    renderModelDescription(el('aiTranscriptionDescription'), models.transcription);
    backendInfo();
  }
  async function refreshCache() {
    const request = ++cacheGeneration;
    const available = await hasWebGpu();
    if (request !== cacheGeneration || destroyed) return;
    gpu = available;
    for (const [key, model] of Object.entries(models)) {
      const assets = [...(model.assets || [model]), ...runtimes(key)];
      const cached = await Promise.all(assets.map(asset => isAiAssetCached(asset)));
      if (request !== cacheGeneration || models[key].id !== model.id || destroyed) return;
      cacheState[key] = cached.every(Boolean);
      downloadSize[key] = assets.reduce((bytes, asset, i) => bytes + (cached[i] ? 0 : asset.bytes), 0);
    }
    refresh();
  }
  function progress(update) {
    el('aiProgress').hidden = false;
    if (update.stage === 'download' || update.stage === 'verify' || update.stage === 'cached') {
      el('aiProgress').value = update.loaded / update.total;
      status(update.stage === 'verify' ? 'Provera preuzete datoteke…' : 'Preuzimanje modela: {loaded} / {total} MB', { loaded: mb(update.loaded), total: mb(update.total) });
    } else if (update.stage === 'loading') { el('aiProgress').removeAttribute('value'); status('Priprema AI modela u memoriji…'); }
    else if (['separating', 'transcribing'].includes(update.stage)) { el('aiProgress').value = update.progress; status('AI obrada: {percent}%', { percent: Math.round(update.progress * 100) }); }
    else if (update.stage === 'cache-unavailable') host.toast?.(t('Model radi, ali browser nije sačuvao preuzimanje za offline upotrebu.'));
  }
  function cancel() { generation++; controller?.abort(); controller = null; transcriber?.dispose(); separator?.dispose(); transcriber = separator = null; running = false; el('aiProgress').hidden = true; status('AI obrada je prekinuta.'); notifyBusy(); refresh(); }
  async function run(action) {
    if (busy() || host.isBusy?.()) return false;
    const token = ++generation; controller = new AbortController(); running = true; stopAudio(); notifyBusy(); refresh();
    try { await action(controller.signal, () => token === generation && !destroyed); return token === generation; }
    catch (error) {
      if (token !== generation || error.name === 'AbortError') return false;
      const message = /bad_alloc|memory|OUT_OF_MEMORY/i.test(error.code || error.message) ? 'Nema dovoljno slobodne memorije u browseru. Zatvori druge kartice ili probaj kraći snimak.' : /^SEPARATOR_/.test(error.message) ? 'Izdvajanje bubnjeva nije uspelo. Probaj kraći snimak ili drugi browser.' : error.message;
      el('aiStatus').textContent = t(message); return false;
    } finally { if (token === generation) { controller = null; running = false; el('aiProgress').hidden = true; notifyBusy(); refresh(); void refreshCache().catch(() => {}); } }
  }
  function selectedChannels(kind) { return kind === 'drums' ? drums : kind === 'without' ? without : original && channelsOf(original); }
  function audition() {
    stopAudio(); if (!original) return;
    const kind = el('aiAudition').value;
    if (!audioUrls.has(kind)) audioUrls.set(kind, URL.createObjectURL(kind === 'original' ? file : new Blob([encodeAiWav(selectedChannels(kind), 44100)], { type: 'audio/wav' })));
    el('aiPlayer').src = audioUrls.get(kind); el('aiPlayer').hidden = false;
  }
  function review() {
    if (!analysis) return;
    const mapping = Object.fromEntries([...el('aiClassMap').querySelectorAll('select')].map(select => [select.dataset.group, select.value]));
    events = transcriptionEvents(analysis, { sensitivity: +el('aiSensitivity').value / 100, mapping, durationSeconds: original.duration });
    el('aiReviewDescription').textContent = modelReviewText(models.transcription);
    el('aiSensitivityLabel').hidden = !!models.transcription.predictsVelocity;
    const bpm = Math.max(30, Math.min(260, +el('aiBpm').value || 120)), beats = Math.max(2, Math.min(7, Math.round(+el('aiBeats').value || 4))), beatUnit = +el('aiBeatUnit').value;
    const offset = Math.max(0, Math.min(original.duration, +el('aiOffset').value || 0)), barSeconds = beats * 4 / beatUnit * 60 / bpm;
    const bars = Math.max(1, Math.ceil((original.duration - offset) / barSeconds)), from = Math.max(1, Math.min(bars, Math.round(+el('aiPreviewBar').value || 1)));
    el('aiPreviewBar').max = bars; el('aiPreviewBar').value = from;
    const pattern = blankPattern({ name: file.name, bpm, beats, beatUnit, bars: Math.min(4, bars - from + 1), division: +el('aiDivision').value });
    const start = offset + (from - 1) * barSeconds, slotSeconds = barSeconds / slotsPerBar(pattern);
    for (const event of events) { const slot = Math.round((event.timeSeconds - start) / slotSeconds); if (event.timeSeconds >= start && slot >= 0 && slot < totalSlots(pattern) && pattern.steps[event.inst]) pattern.steps[event.inst][slot] = Math.max(pattern.steps[event.inst][slot], models.transcription.predictsVelocity ? (event.velocity < 55 ? 1 : event.velocity > 108 ? 3 : 2) : 2); }
    renderNotation(el('aiNotePreview'), pattern, { barsPerLine: 2, barOffset: from - 1, pageWidth: 850 });
    el('aiNotesInfo').textContent = format('Predlog: {hits} udaraca · {bars} taktova. Pregled prikazuje najviše četiri takta; MIDI i referenca obuhvataju celu pesmu.', { hits: events.length, bars });
    el('aiReview').hidden = false; refresh();
  }
  function renderClassMap(preserve = false) {
    const previous = preserve ? Object.fromEntries([...el('aiClassMap').querySelectorAll('select')].map(select => [select.dataset.group, select.value])) : {};
    el('aiClassMap').replaceChildren();
    for (const group of getTranscriptionClasses(models.transcription.id)) {
      const label = document.createElement('label'); label.append(document.createTextNode(t(group.label))); const select = document.createElement('select'); select.dataset.group = group.id;
      select.append(new Option(t('Preskoči'), ''), ...INSTRUMENTS.map(inst => new Option(t(inst.label), inst.id))); select.value = previous[group.id] ?? group.inst; label.append(select); el('aiClassMap').append(label);
    }
  }
  renderClassMap();
  function clearAnalysis() { analysis = null; events = []; el('aiReview').hidden = true; }
  function changeModel(key) {
    const select = el(key === 'separation' ? 'aiSeparationModel' : 'aiTranscriptionModel');
    if (busy() || host.isBusy?.()) { select.value = models[key].id; return; }
    if (select.value === models[key].id) return;
    models[key] = (key === 'separation' ? getSeparatorModelInfo : getTranscriberModelInfo)(select.value);
    cacheGeneration++; cacheState[key] = false; delete downloadSize[key]; lastRun = null;
    if (key === 'separation') {
      separator?.dispose(); separator = null;
      if (el('aiTranscriptionSource').value === 'drums') clearAnalysis();
      drums = without = null;
      for (const kind of ['drums', 'without']) { if (audioUrls.has(kind)) URL.revokeObjectURL(audioUrls.get(kind)); audioUrls.delete(kind); }
      for (const id of ['aiAudition', 'aiTranscriptionSource', 'aiBacking']) el(id).value = 'original';
      audition();
    } else { transcriber?.dispose(); transcriber = null; clearAnalysis(); renderClassMap(); }
    try { localStorage.setItem(MODEL_KEY, JSON.stringify({ separation: models.separation.id, transcription: models.transcription.id })); } catch {}
    status('Model je izabran. Preuzimanje počinje tek kada pokreneš obradu.');
    refresh(); void refreshCache().catch(() => {});
  }
  el('aiSeparationModel').onchange = () => changeModel('separation');
  el('aiTranscriptionModel').onchange = () => changeModel('transcription');
  const shown = ({ detail }) => { if (detail.pane === 'ai') refresh(); };
  document.addEventListener('drummer:pane', shown);
  el('aiAudioFile').onchange = async event => {
    const next = event.target.files[0]; event.target.value = ''; if (!next) return;
    await run(async (signal, current) => {
      status('Učitavanje audija…'); const buffer = await decodeAiAudio(next, { signal }); if (!current()) return;
      clearAudio(); file = next; original = buffer; drums = without = analysis = null; events = [];
      for (const id of ['aiAudition', 'aiTranscriptionSource', 'aiBacking']) el(id).value = 'original';
      el('aiReview').hidden = true; el('aiAudioInfo').textContent = format('{name} · {seconds} s · 44.100 Hz', { name: file.name, seconds: original.duration.toFixed(1) });
      audition(); status('Audio je spreman. Izaberi izdvajanje bubnjeva ili prepoznavanje nota.');
    });
  };
  el('aiSeparate').onclick = () => run(async (signal, current) => {
    separator ||= createDrumSeparator({ modelId: models.separation.id, onProgress: progress }); remember('separation', await separator.prepare({ modelId: models.separation.id, allowDownload: true, signal, backend: preference('separation') }));
    const result = await separator.separate({ channels: channelsOf(original), sampleRate: original.sampleRate }, { signal }); if (!current()) return;
    drums = result.channels; lastRun = result; const source = channelsOf(original);
    without = drums.map((channel, index) => Float32Array.from(channel, (value, sample) => source[Math.min(index, source.length - 1)][sample] - value));
    for (const key of ['drums', 'without']) { if (audioUrls.has(key)) URL.revokeObjectURL(audioUrls.get(key)); audioUrls.delete(key); }
    clearAnalysis(); el('aiTranscriptionSource').value = 'drums';
    el('aiAudition').value = 'drums'; el('aiBacking').value = 'without'; audition(); status('Bubnjevi su izdvojeni i izabrani kao izvor za note.');
  });
  el('aiTranscribe').onclick = () => run(async (signal, current) => {
    transcriber ||= createDrumTranscriber({ onProgress: progress });
    const result = await transcriber.transcribe({ channels: selectedChannels(el('aiTranscriptionSource').value), sampleRate: 44100 }, { modelId: models.transcription.id, allowDownload: true, signal, backend: preference('transcription') }); if (!current()) return;
    remember('transcription', result); analysis = result; lastRun = result; review();
    if (result.truncatedChunks) status('Predlog je delimičan: {count} isečaka je dostiglo granicu modela. Proveri izostavljene udarce.', { count: result.truncatedChunks });
    else status('Predlog nota je spreman. Proveri mapiranje, tempo i prvu dobu pre primene.');
  });
  for (const id of ['aiClassMap', 'aiSensitivity', 'aiBpm', 'aiBeats', 'aiBeatUnit', 'aiDivision', 'aiOffset', 'aiPreviewBar']) el(id).addEventListener('change', review);
  el('aiEstimateTempo').onclick = () => { const estimate = estimateDrumTempo(events); if (estimate) { el('aiBpm').value = estimate; review(); status('Predlog tempa: {bpm} BPM. Proveri slušanjem; tempo može biti upola ili dvostruko veći.', { bpm: estimate }); } else status('Nema dovoljno bas/doboš udaraca za predlog tempa.'); };
  el('aiAudition').onchange = audition;
  el('aiTranscriptionSource').onchange = () => { analysis = null; events = []; el('aiReview').hidden = true; refresh(); };
  el('aiPlayer').onplay = () => { if (running || host.isBusy?.()) { el('aiPlayer').pause(); return; } playing = true; notifyBusy(); };
  el('aiPlayer').onpause = el('aiPlayer').onended = () => { if (playing) { playing = false; notifyBusy(); refresh(); } };
  el('aiExportWav').onclick = () => { if (!original || blocked()) return; downloadBlob(`${file.name.replace(/\.[^.]+$/, '')}-${el('aiAudition').value}.wav`, new Blob([encodeAiWav(selectedChannels(el('aiAudition').value), 44100)], { type: 'audio/wav' })); };
  el('aiExportMidi').onclick = () => { if (blocked()) return; downloadBlob(`${file.name.replace(/\.[^.]+$/, '')}-drums.mid`, new Blob([transcriptionMidi(events, { bpm: +el('aiBpm').value, beats: +el('aiBeats').value, beatUnit: +el('aiBeatUnit').value, durationSeconds: original.duration })], { type: 'audio/midi' })); };
  function scoreCandidate() {
    if (!original || !events.length) return null;
    return { fileName: file.name, events: structuredClone(events), durationSeconds: original.duration,
      bpm: Math.max(30, Math.min(260, +el('aiBpm').value || 120)),
      meter: { beats: Math.max(2, Math.min(7, Math.round(+el('aiBeats').value || 4))), beatUnit: +el('aiBeatUnit').value },
      division: +el('aiDivision').value, offsetSeconds: Math.max(0, Math.min(original.duration - .001, +el('aiOffset').value || 0)) };
  }
  el('aiExportMusicXml').onclick = () => {
    if (blocked() || !events.length) return;
    try { downloadBlob(`${file.name.replace(/\.[^.]+$/, '')}-drums.musicxml`, new Blob([songMusicXml(scoreCandidate())], { type: 'application/vnd.recordare.musicxml+xml' })); }
    catch (error) { status(error.message); }
  };
  el('aiSaveSong').onclick = () => { if (!blocked() && drums && without && events.length) { stopAudio(); document.dispatchEvent(new Event('drummer:save-song')); } };
  el('aiApply').onclick = async () => {
    if (blocked() || !events.length) return; stopAudio();
    try {
      const applied = await host.onCandidate?.({ events: structuredClone(events), durationSeconds: original.duration, fileName: file.name,
        bpm: Math.max(30, Math.min(260, +el('aiBpm').value || 120)), meter: { beats: Math.max(2, Math.min(7, Math.round(+el('aiBeats').value || 4))), beatUnit: +el('aiBeatUnit').value },
        division: +el('aiDivision').value, offsetSeconds: Math.max(0, Math.min(original.duration, +el('aiOffset').value || 0)), audioBuffer: original,
        backingBuffer: el('aiBacking').value === 'without' && without ? aiAudioBuffer(without) : original });
      if (applied !== false) status('AI predlog je prosleđen u referencu za vežbanje.');
    } catch (error) { el('aiStatus').textContent = t(error.message); }
  };
  // Režim Pesma: stvarna vremena udaraca i sva tri zvuka (original, samo bubanj, bez bubnja).
  el('aiPlayAlong').onclick = () => {
    if (blocked() || !events.length) return; stopAudio();
    try {
      host.onSongReference?.({ events: structuredClone(events), durationSeconds: original.duration, fileName: file.name,
        bpm: Math.max(30, Math.min(260, +el('aiBpm').value || 120)), meter: { beats: Math.max(2, Math.min(7, Math.round(+el('aiBeats').value || 4))), beatUnit: +el('aiBeatUnit').value },
        offsetSeconds: Math.max(0, Math.min(original.duration, +el('aiOffset').value || 0)),
        buffers: { original, drums: drums ? aiAudioBuffer(drums) : null, without: without ? aiAudioBuffer(without) : null } });
    } catch (error) { el('aiStatus').textContent = t(error.message); }
  };
  el('aiCancel').onclick = cancel;
  el('aiClearCache').onclick = async () => { if (blocked()) return; transcriber?.dispose(); separator?.dispose(); transcriber = separator = null; await clearAiModelCache(); await refreshCache(); status('Preuzeti AI modeli su obrisani sa ovog uređaja.'); };
  const translate = () => { renderClassMap(true); refresh(); if (analysis) review(); };
  document.addEventListener('drummer:language', translate);
  refresh(); void refreshCache().catch(() => {}); document.dispatchEvent(new Event('drummer:translate'));
  return { get busy() { return busy(); }, stopAudio, refresh, show: () => navigate('ai'),
    getSongProject() { const score = scoreCandidate(); return score && drums && without ? { ...score, file, drums, without, models: { separation: models.separation.id, transcription: models.transcription.id } } : null; },
    canSaveSong() { return !!(original && drums && without && events.length); },
    releaseSong() {
      clearAudio(); file = original = drums = without = null; clearAnalysis();
      transcriber?.dispose(); separator?.dispose(); transcriber = separator = null;
      el('aiPlayer').hidden = true; el('aiAudioInfo').textContent = t('Mono ili stereo, do 100 MB i 10 minuta.');
      for (const id of ['aiAudition', 'aiTranscriptionSource', 'aiBacking']) el(id).value = 'original';
      status(''); refresh();
    },
    destroy() { destroyed = true; generation++; controller?.abort(); transcriber?.dispose(); separator?.dispose(); running = false; clearAudio(); notifyBusy(); document.removeEventListener('drummer:language', translate); document.removeEventListener('drummer:pane', shown); panel.remove(); },
  };
}
