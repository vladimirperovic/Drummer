import { INSTRUMENTS } from './patterns.js';
import { PatternHistory, copyBars, pasteBars, generatePattern } from './editor-model.js';
import { renderNotation } from './notation.js';
import { t } from './i18n.js';

export function createEditorTools(host) {
  const container = host.container || document.getElementById('view-editor');
  const history = new PatternHistory(host.getPattern()), grid = document.getElementById('grid');
  const panel = document.createElement('section'); panel.className = 'editor-next-tools'; panel.id = 'editorNextTools';
  panel.innerHTML = `<div class="editor-history-row"><button id="editorUndo" title="Vrati poslednju izmenu (Ctrl+Z)">Poništi</button><button id="editorRedo" title="Ponovi izmenu (Ctrl+Shift+Z)">Ponovi</button><span id="editorHistoryStatus" class="muted" aria-live="polite"></span></div>
    <div class="editor-selection-row"><label>Od takta <input id="editorCopyFrom" type="number" min="1" max="8" value="1"></label><label>Do takta <input id="editorCopyTo" type="number" min="1" max="8" value="1"></label><button id="editorCopySelection">Kopiraj izbor</button><label>Nalepi od takta <input id="editorPasteAt" type="number" min="1" max="8" value="1"></label><button id="editorPasteSelection">Nalepi taktove</button><span id="editorClipboardStatus" class="muted" aria-live="polite"></span></div>
    <p class="muted editor-selection-hint">Lepljenje zamenjuje izabrane taktove i po potrebi proširuje ritam do osam taktova. Mera, podela i swing moraju se poklapati.</p>
    <details id="exerciseGenerator"><summary>Generator rudimenata i prelaza</summary><div class="generator-controls">
    <label>Vežba <select id="generatorKind"><option value="rudiment">Rudiment</option><option value="fill">Prelaz</option></select></label>
    <label>Osnovni pokret <select id="generatorRudiment"><option value="single">Pojedinačni udarci</option><option value="double">Dupli udarci</option><option value="paradiddle">Paradidl</option><option value="doubleParadiddle">Dupli paradidl</option><option value="sixStroke">Šest udaraca</option></select></label>
    <label>Sopstvene ruke R/L <input id="generatorSticking" type="text" maxlength="64" placeholder="Prazno: osnovni pokret" spellcheck="false"></label>
    <label>Prva ruka <select id="generatorLead"><option value="R">R</option><option value="L">L</option></select></label>
    <label>Akcenti <select id="generatorAccent"><option value="beat">Na dobu</option><option value="cycle">Početak pokreta</option><option value="right">Desna ruka</option><option value="left">Leva ruka</option><option value="offbeat">Između doba</option><option value="none">Bez akcenata</option></select></label>
    <label>Raspodela <select id="generatorOrchestration"><option value="snare">Sve na dobošu</option><option value="split">Odvojene ruke</option><option value="around">Preko tomova</option><option value="linear">Linearno sa basom</option></select></label>
    <label>Desna ruka <select id="generatorRight"></select></label><label>Leva ruka <select id="generatorLeft"></select></label>
    <label>Težina <select id="generatorDifficulty"><option value="easy">Lako</option><option value="medium" selected>Srednje</option><option value="hard">Napredno</option></select></label>
    <label>Taktovi <input id="generatorBars" type="number" min="1" max="8" value="1"></label><button id="generatorVariation">Nova varijacija</button></div>
    <p class="muted">Pregled koristi trenutnu meru, tempo i aktivne instrumente. Primeni zamenjuje ritam; Poništi ga vraća.</p>
    <div id="generatorPreview" class="generator-preview"></div><p id="generatorStatus" role="status"></p><button id="generatorApply">Primeni vežbu</button></details>`;
  container.insertBefore(panel, grid || null);
  const el = id => panel.querySelector('#' + id), busy = () => !!host.isBusy?.();
  let clipboard = null, preview = null, variant = 0, applying = false, textField = null, paint = null;
  const say = message => host.toast?.(t(message));
  const replace = (pattern, source) => {
    applying = true;
    try { host.replacePattern(pattern, { dirty: history.isDirty(pattern), source }); }
    finally { applying = false; }
    refresh();
  };
  function capture(label = 'edit') { if (!applying) history.capture(host.getPattern(), label); refresh(); }
  function begin(label = 'edit') { if (!applying) history.begin(host.getPattern(), label); }
  function end() { if (!applying) history.end(host.getPattern()); refresh(); }
  function finishText() { if (textField) { textField = null; end(); } }
  function undo() {
    if (busy()) return false;
    finishText(); history.capture(host.getPattern()); const previous = history.undo();
    if (!previous) return false; replace(previous, 'undo'); return true;
  }
  function redo() {
    if (busy()) return false;
    finishText(); history.capture(host.getPattern()); const next = history.redo();
    if (!next) return false; replace(next, 'redo'); return true;
  }
  function apply(next, source) {
    if (busy()) return false;
    finishText(); history.capture(host.getPattern()); history.capture(next, source); replace(next, source); return true;
  }
  function instrumentIds() {
    const instruments = host.getInstruments?.() || INSTRUMENTS;
    return instruments.map(inst => typeof inst === 'string' ? inst : inst.id);
  }
  function refreshInstruments() {
    const ids = instrumentIds();
    for (const [id, fallback] of [['generatorRight', 'hh'], ['generatorLeft', 'snare']]) {
      const select = el(id), value = select.value || fallback;
      const instruments = INSTRUMENTS.filter(inst => ids.includes(inst.id) && inst.voice === 'up');
      if (select.dataset.items !== instruments.map(inst => inst.id).join(',')) {
        select.replaceChildren(...instruments.map(inst => new Option(t(inst.label), inst.id))); select.dataset.items = instruments.map(inst => inst.id).join(',');
        select.value = instruments.some(inst => inst.id === value) ? value : instruments[0]?.id || '';
      }
    }
  }
  function makePreview() {
    refreshInstruments();
    try {
      const kind = el('generatorKind').value;
      preview = generatePattern(host.getPattern(), { kind, rudiment: el('generatorRudiment').value, sticking: el('generatorSticking').value,
        lead: el('generatorLead').value, accent: el('generatorAccent').value, orchestration: el('generatorOrchestration').value,
        right: el('generatorRight').value, left: el('generatorLeft').value, difficulty: el('generatorDifficulty').value,
        bars: Number(el('generatorBars').value), instruments: instrumentIds(), variant,
        name: t(kind === 'fill' ? 'Generisani prelaz' : 'Generisani rudiment') });
      if (el('exerciseGenerator').open) renderNotation(el('generatorPreview'), preview, { barsPerLine: Math.min(2, preview.bars), zoom: 65 });
      el('generatorStatus').textContent = `${t('Pregled taktova')}: ${preview.bars} · ${preview.beats}/${preview.beatUnit} · ${t('Varijacija')}: ${variant + 1}`;
    } catch (error) { preview = null; el('generatorPreview').replaceChildren(); el('generatorStatus').textContent = t(error.message); }
    el('generatorApply').disabled = busy() || !preview;
  }
  function refresh() {
    const pattern = host.getPattern(), locked = busy();
    el('editorUndo').disabled = locked || !(history.canUndo || history.depth && history.hasChanges(pattern));
    el('editorRedo').disabled = locked || !history.canRedo || !!history.depth;
    el('editorHistoryStatus').textContent = history.isDirty(pattern) ? t('Ritam ima izmene.') : t('Ritam odgovara sačuvanoj verziji.');
    for (const id of ['editorCopyFrom', 'editorCopyTo']) {
      const input = el(id); input.max = pattern.bars; input.value = Math.min(pattern.bars, Math.max(1, Number(input.value) || 1));
    }
    for (const input of panel.querySelectorAll('.editor-selection-row input, .editor-selection-row button, .generator-controls input, .generator-controls select, .generator-controls button')) input.disabled = locked;
    el('editorPasteSelection').disabled = locked || !clipboard;
    el('generatorApply').disabled = locked || !preview;
    refreshInstruments();
  }
  el('editorUndo').onclick = undo; el('editorRedo').onclick = redo;
  el('editorCopySelection').onclick = () => {
    if (busy()) return;
    try { clipboard = copyBars(host.getPattern(), Number(el('editorCopyFrom').value), Number(el('editorCopyTo').value)); el('editorClipboardStatus').textContent = `${t('Kopirano taktova')}: ${clipboard.bars} · ${clipboard.beats}/${clipboard.beatUnit}`; refresh(); }
    catch (error) { say(error.message); }
  };
  el('editorPasteSelection').onclick = () => {
    try { apply(pasteBars(host.getPattern(), clipboard, Number(el('editorPasteAt').value)), 'paste'); }
    catch (error) { say(error.message); }
  };
  for (const input of panel.querySelectorAll('.generator-controls input, .generator-controls select')) input.addEventListener('input', makePreview);
  el('generatorVariation').onclick = () => { variant++; makePreview(); };
  el('exerciseGenerator').addEventListener('toggle', () => { if (el('exerciseGenerator').open) makePreview(); });
  el('generatorApply').onclick = () => {
    if (busy()) return; makePreview(); if (!preview || host.confirmApply?.() === false) return;
    apply(structuredClone(preview), 'generator');
  };
  document.addEventListener('keydown', event => {
    if (container.hidden || document.querySelector('dialog[open]') || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable=true]')) return;
    const key = event.key.toLowerCase(); if (!['z', 'y'].includes(key)) return;
    event.preventDefault(); event.stopImmediatePropagation(); if (key === 'y' || event.shiftKey) redo(); else undo();
  }, true);
  for (const id of ['edName', 'edSticking']) {
    const input = document.getElementById(id); if (!input) continue;
    input.addEventListener('focus', () => { if (!busy()) { finishText(); textField = input; begin('metadata'); } });
    input.addEventListener('blur', finishText);
  }
  if (grid && host.setCell) {
    const paintCell = button => {
      if (!paint || !button || !grid.contains(button)) return;
      const key = `${button.dataset.inst}:${button.dataset.slot}`; if (paint.visited.has(key)) return;
      paint.visited.add(key); host.setCell(button, paint.value);
    };
    const finishPaint = (cancel = false) => {
      if (!paint) return; const id = paint.id; paint = null;
      if (grid.hasPointerCapture(id)) grid.releasePointerCapture(id);
      if (cancel) replace(history.cancel(), 'cancel-gesture'); else end();
    };
    grid.addEventListener('pointerdown', event => {
      const button = event.target.closest('.cell'); if (!button || busy() || ![0, 2].includes(event.button)) return;
      event.preventDefault(); finishText(); begin('paint');
      const current = host.getPattern().steps[button.dataset.inst][Number(button.dataset.slot)];
      paint = { id: event.pointerId, value: event.button === 2 ? 0 : event.shiftKey ? 3 : event.altKey ? 1 : [2, 0, 3, 1][current], visited: new Set() };
      grid.setPointerCapture(event.pointerId); button.focus({ preventScroll: true }); paintCell(button);
    }, true);
    grid.addEventListener('pointermove', event => { if (paint?.id === event.pointerId) paintCell(document.elementFromPoint(event.clientX, event.clientY)?.closest('.cell')); });
    grid.addEventListener('pointerup', event => { if (paint?.id === event.pointerId) finishPaint(); });
    grid.addEventListener('pointercancel', event => { if (paint?.id === event.pointerId) finishPaint(true); });
    grid.addEventListener('lostpointercapture', () => finishPaint());
    grid.addEventListener('click', event => { if (event.detail > 0 && event.target.closest('.cell')) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    grid.addEventListener('contextmenu', event => {
      const button = event.target.closest('.cell'); if (!button) return;
      event.preventDefault(); event.stopImmediatePropagation(); if (!busy()) host.setCell(button, 0);
    }, true);
    document.addEventListener('keydown', event => { if (paint && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finishPaint(true); } }, true);
  }
  document.addEventListener('drummer:language', () => {
    for (const id of ['generatorRight', 'generatorLeft']) el(id).dataset.items = '';
    refresh(); if (el('exerciseGenerator').open) makePreview();
  });
  makePreview(); refresh(); document.dispatchEvent(new Event('drummer:translate'));
  return { history, capture, begin, end, undo, redo, apply, refresh,
    reset(options = {}) { history.reset(host.getPattern(), options); textField = null; refresh(); if (el('exerciseGenerator').open) makePreview(); },
    markSaved() { history.markSaved(host.getPattern()); refresh(); } };
}
