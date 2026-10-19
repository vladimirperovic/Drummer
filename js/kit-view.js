import { createKit } from './kit.js';
import { createConfiguredKit } from './kit-config-2d.js';
import { isDefaultKit, normalizeKit, moveKitPart } from './kit-config.js';

export function createKitView(container, settings, save, layoutHost = {}) {
  container.innerHTML = `<div class="kit-toolbar">
    <div class="kit-switch" role="group" aria-label="Prikaz bubnja"><button id="kit2d" aria-pressed="true">2D</button><button id="kit3d" aria-pressed="false">3D</button></div>
    <button id="kitMove" aria-pressed="false">Pomjeri djelove</button><button id="kitLayoutReset">Vrati raspored</button>
    <span id="kitPlayHint" class="muted">Klikni deo za zvuk · Shift: akcenat · Alt: tiše. Snimaj upisuje udarce dok ritam ide.</span>
    <span id="kitMoveHint" class="muted" hidden>Prevuci deo po podu. Esc otkazuje pomeranje. Sačuvaj profil za ovaj raspored.</span>
    <span id="kit3dHint" class="muted" hidden>Prevuci praznu pozadinu za rotaciju · točkić ili dva prsta za zum</span>
    <div id="kit3dControls" hidden><button id="kitRotateLeft" title="Okreni ulevo" aria-label="Okreni ulevo">↶</button><button id="kitRotateRight" title="Okreni udesno" aria-label="Okreni udesno">↷</button><button id="kitZoomIn" title="Približi" aria-label="Približi">+</button><button id="kitZoomOut" title="Udalji" aria-label="Udalji">−</button><button id="kitReset">Vrati pogled</button></div>
    <span id="kitViewStatus" class="muted" role="status"></span></div>
    <div id="kit2dHost" class="kit-host"></div><div id="kit3dHost" class="kit-host" hidden></div>`;
  const $ = selector => container.querySelector(selector);
  let two = null, three = null, mode = '2d', pending = null, selection = 0, editing = false, gesture = null, draft = null;
  const canEdit = () => !layoutHost.isBusy?.();
  const preview = (value, fit = false) => { two?.updateLayout?.(value, fit); three?.updateLayout(value, fit); };
  function cancel() { gesture = draft = null; preview(settings.kitConfig); }
  function commit(value) {
    gesture = draft = null;
    $('#kitViewStatus').textContent = '';
    if (canEdit() && value && JSON.stringify(normalizeKit(value)) !== JSON.stringify(normalizeKit(settings.kitConfig))) {
      if (layoutHost.commit?.(value)) $('#kitViewStatus').textContent = 'Raspored je zapamćen u browseru. Sačuvaj profil da ga zadržiš uz ovaj set.';
    }
    preview(settings.kitConfig, true); playState();
  }
  const dragCallbacks = {
    canPlay: () => !editing,
    hit: (id, velocity, time) => layoutHost.hit?.(id, velocity, time),
    start() { if (!editing || !canEdit()) return false; $('#kitViewStatus').textContent = ''; gesture = normalizeKit(settings.kitConfig); draft = null; return true; },
    preview(id, dx, dz) { if (!gesture) return; if (!canEdit()) return setEditing(false); draft = moveKitPart(gesture, id, dx, dz); preview(draft); },
    commit() { commit(draft); }, cancel,
  };
  function buildTwo() {
    two?.dispose?.();
    two = isDefaultKit(settings.kitConfig) && !editing ? createKit($('#kit2dHost'), {
      ...dragCallbacks,
      unavailable() { two?.dispose?.(); two = createConfiguredKit($('#kit2dHost'), settings.kitConfig, dragCallbacks); two.setEditing(editing); },
    }) : createConfiguredKit($('#kit2dHost'), settings.kitConfig, dragCallbacks);
    two.setEditing?.(editing);
  }
  buildTwo();
  function setEditing(value) {
    two?.cancelDrag?.(); three?.cancelDrag();
    editing = !!value && canEdit();
    if (isDefaultKit(settings.kitConfig)) buildTwo(); else two?.setEditing?.(editing);
    three?.setEditing(editing);
    $('#kitMove').setAttribute('aria-pressed', editing);
    $('#kitMoveHint').hidden = !editing;
    $('#kitPlayHint').hidden = editing;
    $('#kit3dHint').hidden = mode !== '3d' || editing;
  }
  function playState() {
    const busy = !canEdit(); if (busy && editing) setEditing(false);
    $('#kitMove').disabled = busy; $('#kitLayoutReset').disabled = busy || !settings.kitConfig?.offsets;
  }
  function display(value) {
    mode = value; const is3d = mode === '3d';
    $('#kit2dHost').hidden = is3d; $('#kit3dHost').hidden = !is3d;
    $('#kit3dHint').hidden = !is3d || editing; $('#kit3dControls').hidden = !is3d;
    $('#kit2d').setAttribute('aria-pressed', !is3d); $('#kit3d').setAttribute('aria-pressed', is3d);
    three?.setVisible(is3d);
  }
  function failed() {
    selection++; three?.dispose(); three = null; pending = null;
    display('2d'); settings.kitView = '2d'; save();
    $('#kitViewStatus').textContent = '3D nije dostupan u ovom browseru. 2D prikaz je aktivan.';
  }
  async function select(value) {
    two?.cancelDrag?.(); three?.cancelDrag();
    const token = ++selection; $('#kitViewStatus').textContent = '';
    if (value === '3d' && !three) {
      $('#kitViewStatus').textContent = 'Učitavam 3D bubanj…';
      try {
        pending ||= import('./kit-3d.js'); const module = await pending;
        if (token !== selection) return;
        three = module.createKit3D($('#kit3dHost'), failed, settings.kitConfig, dragCallbacks); three.setEditing(editing);
      } catch { if (token === selection) failed(); return; }
    }
    if (token !== selection) return;
    $('#kitViewStatus').textContent = ''; display(value); settings.kitView = value; save();
  }
  $('#kit2d').onclick = () => select('2d'); $('#kit3d').onclick = () => select('3d');
  $('#kitMove').onclick = () => setEditing(!editing);
  $('#kitLayoutReset').onclick = () => { if (canEdit()) { two?.cancelDrag?.(); three?.cancelDrag(); commit(normalizeKit({ ...settings.kitConfig, offsets: undefined })); if (isDefaultKit(settings.kitConfig)) buildTwo(); } };
  $('#kitReset').onclick = () => three?.reset();
  $('#kitRotateLeft').onclick = () => three?.rotate(-.22); $('#kitRotateRight').onclick = () => three?.rotate(.22);
  $('#kitZoomIn').onclick = () => three?.zoom(.85); $('#kitZoomOut').onclick = () => three?.zoom(1.18);
  addEventListener('pagehide', e => { two?.cancelDrag?.(); three?.cancelDrag(); if (!e.persisted) { two?.dispose?.(); three?.dispose(); } });
  playState();
  if (settings.kitView === '3d') select('3d');
  async function configure() {
    const next = settings.kitView || mode;
    gesture = draft = null;
    selection++; three?.dispose(); three = null; buildTwo(); display('2d'); playState();
    if (next === '3d') await select('3d');
  }
  return { pulse(id) { two.pulse(id); three?.pulse(id); }, hit(id, kind) { two.hit(id, kind); three?.hit(id, kind); }, pedal(v) { two.pedal(v); three?.pedal(v); },
    select, configure, playState, get three() { return three; }, get mode() { return mode; }, get editing() { return editing; },
  };
}
