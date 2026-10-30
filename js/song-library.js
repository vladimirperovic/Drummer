import { getLanguage } from './i18n.js';
import { navigate, adoptPane } from './navigation.js';
import { downloadBlob } from './storage.js';
import { libraryHandle, listSongProjects, saveSongProject, loadSongProject, songAsset } from './song-library-store.js';

const words = (sr, en) => getLanguage() === 'en' ? en : sr;
const button = (text, action) => { const el = document.createElement('button'); el.type = 'button'; el.textContent = text; el.title = text; el.onclick = action; return el; };

export function createSongLibrary(host) {
  const panel = document.createElement('section'); panel.id = 'song-library'; panel.className = 'studio-panel song-library'; panel.dataset.userText = '';
  adoptPane(panel, 'songlibrary', 'song');
  const quick = document.createElement('div'); quick.className = 'song-library-quick'; quick.dataset.userText = '';
  host.playPanel.append(quick);
  let directory = null, entries = [], selected = null, working = false, filter = '', message = '', skipped = 0;
  const locked = () => working || !!host.isBusy();
  const setBusy = value => { working = value; host.onBusyChange?.(); refresh(); };
  const showMessage = text => { message = text; refresh(); };
  const errorText = error => error.name === 'NotAllowedError' || error.name === 'SecurityError'
    ? words('Pristup fascikli nije odobren. Klikni „Izaberi fasciklu” i odobri pristup.', 'Folder access was not granted. Choose a folder and allow access.')
    : words('Nije uspelo. Prethodne pesme su sačuvane. ', 'Could not complete the action. Previous songs are safe. ') + error.message;
  async function scan() { const result = await listSongProjects(directory); entries = result.entries; skipped = result.skipped; }
  async function choose() {
    if (locked()) return;
    if (!window.showDirectoryPicker) { showMessage(words('Za upis biblioteke u fasciklu otvori aplikaciju u Chrome ili Edge browseru na laptopu.', 'To save a library folder, open the app in Chrome or Edge on your laptop.')); return; }
    setBusy(true);
    try {
      const next = await window.showDirectoryPicker({ id: 'drummer-song-library', mode: 'readwrite', startIn: 'music' });
      const result = await listSongProjects(next);
      directory = next; entries = result.entries; skipped = result.skipped; selected = null;
      try { await libraryHandle(directory); } catch { /* The folder still works this session. */ }
      message = words('Fascikla je spremna. Sačuvaj obrađenu pesmu ili učitaj neku iz liste.', 'Folder ready. Save a processed song or load one from the list.');
    } catch (error) { if (error.name !== 'AbortError') message = errorText(error); }
    finally { setBusy(false); }
  }
  async function access() {
    if (!directory) throw new Error(words('Prvo izaberi fasciklu biblioteke.', 'Choose a library folder first.'));
    if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted' && await directory.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new DOMException('Folder permission denied', 'NotAllowedError');
  }
  async function save() {
    if (locked()) return;
    const song = host.getSong();
    if (!song) { showMessage(words('Prvo izdvoji bubnjeve i prepoznaj note u Analizi.', 'First separate drums and transcribe notes in Analysis.')); navigate('ai'); return; }
    if (!directory) { await choose(); if (!directory) return; }
    if (locked()) return;
    setBusy(true); message = words('Čuvanje originala, oba WAV snimka i nota…', 'Saving the original, both WAV tracks and notes…'); refresh();
    try {
      await access(); const entry = await saveSongProject(directory, song); await scan();
      message = words('Sačuvano u fascikli: ', 'Saved in folder: ') + entry.folder.name; navigate('songlibrary', { reveal: true });
    } catch (error) { message = errorText(error); }
    finally { setBusy(false); }
  }
  async function load(entry, play = false) {
    if (locked()) return;
    host.stopSong(); host.stopPreview(); setBusy(true); message = words('Učitavanje sa laptopa…', 'Loading from your laptop…'); refresh();
    let candidate;
    try {
      if (play) await host.prepareAudio();
      await access(); candidate = await loadSongProject(entry);
      if (host.onLoad(candidate) === false) throw new Error(words('Pesma trenutno ne može da se zameni.', 'The song cannot be replaced right now.'));
      selected = entry.metadata.id; message = words('Spremno za vežbanje: ', 'Ready to practice: ') + candidate.fileName;
    } catch (error) { message = errorText(error); candidate = null; }
    finally { setBusy(false); }
    if (candidate) { navigate('songplay', { reveal: true }); if (play) await host.startSong(); }
  }
  async function exportScore(entry) {
    if (locked()) return;
    setBusy(true);
    try { await access(); downloadBlob(entry.metadata.fileName.replace(/\.[^.]+$/, '') + '-drums.musicxml', await songAsset(entry, 'musicxml')); }
    catch (error) { message = errorText(error); }
    finally { setBusy(false); }
  }
  const visible = () => entries.filter(entry => entry.metadata.fileName.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  function renderRows() {
    const list = panel.querySelector('[data-library-list]'); if (!list) return; list.replaceChildren();
    for (const entry of visible()) {
      const meta = entry.metadata, row = document.createElement('article'); row.className = 'song-library-item';
      if (selected === meta.id) row.classList.add('selected');
      const title = document.createElement('h3'); title.textContent = meta.fileName; row.append(title);
      const info = document.createElement('p'); info.className = 'muted';
      info.textContent = `${Math.floor(meta.durationSeconds / 60)}:${String(Math.floor(meta.durationSeconds % 60)).padStart(2, '0')} · ${meta.bpm} BPM · ${meta.meter.beats}/${meta.meter.beatUnit} · ${meta.events.length} ${words('udaraca', 'hits')} · ${meta.savedAt?.slice(0, 10) || ''}`;
      row.append(info);
      const actions = document.createElement('div'); actions.className = 'ai-controls';
      const play = button(words('▶ Vežbaj', '▶ Practice'), () => load(entry, true)); play.className = 'primary'; play.dataset.libraryPlay = meta.id;
      const open = button(words('Učitaj', 'Load'), () => load(entry)); open.dataset.libraryLoad = meta.id;
      actions.append(play, open, button('MusicXML ↓', () => exportScore(entry))); row.append(actions); list.append(row);
    }
    if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = words('Nema sačuvanih pesama za ovaj prikaz.', 'No saved songs in this view.'); list.append(empty); }
    for (const b of list.querySelectorAll('button')) b.disabled = locked();
  }
  function refresh() {
    if (!panel.querySelector('[data-library-list]')) return;
    panel.querySelector('[data-library-status]').textContent = message;
    panel.querySelector('[data-library-folder]').textContent = directory ? `${directory.name} · ${entries.length} ${words('pesama', 'songs')}${skipped ? words(` · ${skipped} nepotpunih ili drugih fascikli preskočeno`, ` · ${skipped} incomplete or unrelated folders skipped`) : ''}` : words('Fascikla još nije izabrana.', 'No folder selected yet.');
    for (const el of panel.querySelectorAll('button,input')) el.disabled = locked();
    panel.querySelector('#songLibrarySave').disabled = locked() || !host.canSaveSong();
    panel.querySelector('#songLibraryRescan').disabled = locked() || !directory;
    renderRows(); renderQuick();
  }
  function renderQuick() {
    quick.replaceChildren();
    const list = visible(), index = list.findIndex(e => e.metadata.id === selected);
    const previous = button(words('← Prethodna', '← Previous'), () => load(list[index - 1], true));
    const next = button(words('Sledeća →', 'Next →'), () => load(list[index + 1], true));
    previous.id = 'songLibraryPrevious'; next.id = 'songLibraryNext';
    previous.disabled = locked() || index <= 0; next.disabled = locked() || index < 0 || index >= list.length - 1;
    const open = button(words('Biblioteka pesama', 'Song library'), () => navigate('songlibrary', { reveal: true })); open.disabled = working;
    quick.append(previous, open, next);
  }
  function build() {
    panel.replaceChildren();
    const title = document.createElement('h2'); title.textContent = words('Moja biblioteka pesama', 'My song library'); panel.append(title);
    const intro = document.createElement('p'); intro.className = 'muted';
    intro.textContent = words('Izaberi fasciklu na laptopu, na primer Muzika / Drummer. Svaka pesma čuva original, bubnjeve, verziju bez bubnjeva, MusicXML, MIDI i podatke za vežbanje. Kopiranjem cele fascikle prenosiš biblioteku na drugi računar.', 'Choose a laptop folder, for example Music / Drummer. Each song keeps its original, drums, drumless track, MusicXML, MIDI and practice data. Copy the entire folder to move your library to another computer.'); panel.append(intro);
    const actions = document.createElement('div'); actions.className = 'ai-controls';
    const pick = button(words('Izaberi fasciklu', 'Choose folder'), choose); pick.id = 'songLibraryChoose';
    const saveButton = button(words('Sačuvaj obrađenu pesmu', 'Save processed song'), save); saveButton.id = 'songLibrarySave'; saveButton.className = 'primary';
    const rescan = button(words('Osveži listu', 'Refresh list'), async () => { if (locked()) return; setBusy(true); try { await access(); await scan(); message = ''; } catch (error) { message = errorText(error); } finally { setBusy(false); } }); rescan.id = 'songLibraryRescan';
    actions.append(pick, saveButton, rescan); panel.append(actions);
    const folder = document.createElement('p'); folder.dataset.libraryFolder = ''; panel.append(folder);
    const search = document.createElement('input'); search.type = 'search'; search.id = 'songLibrarySearch'; search.placeholder = words('Traži pesmu…', 'Find a song…'); search.ariaLabel = search.title = search.placeholder; search.value = filter;
    search.oninput = () => { filter = search.value; renderRows(); renderQuick(); }; panel.append(search);
    const status = document.createElement('p'); status.dataset.libraryStatus = ''; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); panel.append(status);
    const list = document.createElement('div'); list.dataset.libraryList = ''; list.className = 'song-library-list'; panel.append(list); refresh();
  }
  document.addEventListener('drummer:save-song', save);
  document.addEventListener('drummer:language', build);
  document.addEventListener('drummer:pane', refresh);
  build();
  void libraryHandle().then(async handle => {
    // Do not replace a folder the user has already selected while IDB opens.
    if (!handle || directory || working) return;
    directory = handle;
    if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') {
      const result = await listSongProjects(handle);
      if (directory !== handle || working) return;
      entries = result.entries; skipped = result.skipped;
    }
    else message = words('Klikni „Osveži listu” da ponovo odobriš pristup sačuvanoj fascikli.', 'Click “Refresh list” to reconnect your saved folder.');
    refresh();
  }).catch(() => {});
  return { get busy() { return working; }, refresh, clearSelection() { selected = null; refresh(); } };
}
