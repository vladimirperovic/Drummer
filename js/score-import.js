// Local MusicXML reader. The original score stays a reading view; a drum part
// can additionally be converted into a practice pattern (js/score-drums.js).
import { t } from './i18n.js';
import { INSTRUMENTS } from './patterns.js';
import { drumParts, drumKeys, drumPartToPattern } from './score-drums.js';

const MAX_FILE = 10 * 1024 * 1024, MAX_XML = 16 * 1024 * 1024;
const fail = message => { throw new Error(message); };
const checkedRange = (bytes, offset, length) => {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length)
    fail('MusicXML arhiva je oštećena ili nepotpuna.');
};
const safePath = path => path && !/[\\\0:#]/.test(path) && !path.startsWith('/') && !path.split('/').some(part => part === '..' || part === '.');

export function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail('MusicXML arhiva je oštećena ili nepotpuna.');
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
  if (!count || count > 128 || count !== view.getUint16(end + 8, true) || offset + size > end) fail('MusicXML arhiva ima previše ili nepodržane stavke.');
  checkedRange(bytes, offset, size);
  const entries = new Map(); let pos = offset, expanded = 0;
  for (let i = 0; i < count; i++) {
    checkedRange(bytes, pos, 46);
    if (view.getUint32(pos, true) !== 0x02014b50) fail('MusicXML arhiva je oštećena ili nepotpuna.');
    const flags = view.getUint16(pos + 8, true), method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true), compressed = view.getUint32(pos + 20, true), length = view.getUint32(pos + 24, true);
    const namesize = view.getUint16(pos + 28, true), extrasize = view.getUint16(pos + 30, true), commentsize = view.getUint16(pos + 32, true);
    const local = view.getUint32(pos + 42, true);
    checkedRange(bytes, pos + 46, namesize + extrasize + commentsize);
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + namesize));
    if (!safePath(name) || entries.has(name) || (flags & 1) || ![0, 8].includes(method) || view.getUint16(pos + 34, true)) fail('MusicXML arhiva ima previše ili nepodržane stavke.');
    expanded += length;
    if (expanded > MAX_XML || compressed > MAX_FILE) fail('Raspakovana partitura je prevelika (najviše 16 MB).');
    checkedRange(bytes, local, 30);
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== method || (view.getUint16(local + 6, true) & 1)) fail('MusicXML arhiva je oštećena ili nepotpuna.');
    const localNameSize = view.getUint16(local + 26, true), localExtraSize = view.getUint16(local + 28, true);
    checkedRange(bytes, local + 30, localNameSize + localExtraSize);
    const localName = new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + localNameSize));
    if (localName !== name) fail('MusicXML arhiva je oštećena ili nepotpuna.');
    const start = local + 30 + localNameSize + localExtraSize;
    checkedRange(bytes, start, compressed);
    if (start + compressed > offset) fail('MusicXML arhiva je oštećena ili nepotpuna.');
    entries.set(name, { start, compressed, length, crc, method });
    pos += 46 + namesize + extrasize + commentsize;
  }
  if (pos !== offset + size) fail('MusicXML arhiva je oštećena ili nepotpuna.');
  return entries;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8;
  return (value ^ 0xffffffff) >>> 0;
}
async function unzipEntry(bytes, entry) {
  if (!entry) fail('MusicXML arhiva nema traženu partituru.');
  let result = bytes.subarray(entry.start, entry.start + entry.compressed);
  if (entry.method === 8) {
    let stream;
    try { stream = new Blob([result]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
    catch { fail('Ovaj browser ne može da otvori MXL. Raspakuj fajl i izaberi MusicXML.'); }
    const reader = stream.getReader(), chunks = []; let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        total += value.length;
        if (total > entry.length || total > MAX_XML) { await reader.cancel(); fail('Raspakovana partitura je prevelika (najviše 16 MB).'); }
        chunks.push(value);
      }
    } catch (error) { throw new Error(error.message || 'MusicXML arhiva je oštećena ili nepotpuna.'); }
    result = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  }
  if (result.length !== entry.length || crc32(result) !== entry.crc) fail('MusicXML arhiva je oštećena ili nepotpuna.');
  return result;
}

function decodeXml(bytes) {
  // XML may be UTF-8 or UTF-16. Decode before checking markup, so UTF-16
  // declarations cannot bypass the DTD/entity guard.
  const utf16 = bytes[0] === 255 && bytes[1] === 254 || bytes[0] === 60 && bytes[1] === 0;
  const utf16be = bytes[0] === 254 && bytes[1] === 255 || bytes[0] === 0 && bytes[1] === 60;
  try { return new TextDecoder(utf16 ? 'utf-16le' : utf16be ? 'utf-16be' : 'utf-8', { fatal: true }).decode(bytes); }
  catch { fail('MusicXML mora biti ispravan UTF-8 ili UTF-16 XML fajl.'); }
}

function xmlDocument(text) {
  // MuseScore and other exporters include the standard public declaration.
  // Remove this exact known declaration without fetching its URL. Internal
  // subsets, entity declarations and custom DTDs are never passed to a parser.
  const standardDtd = /<!DOCTYPE\s+score-partwise\s+PUBLIC\s+(["'])-\/\/Recordare\/\/DTD MusicXML (?:1\.0|1\.1|2\.0|3\.0|3\.1|4\.0) Partwise\/\/EN\1\s+(["'])https?:\/\/(?:www\.)?(?:musicxml\.org|recordare\.com)\/dtds\/partwise\.dtd\2\s*>/;
  text = text.replace(standardDtd, '');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text) || /<\?xml-stylesheet\b/i.test(text)) fail('Partitura sadrži DTD, entitete ili spoljne resurse koji nisu podržani.');
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.querySelector('parsererror')) fail('MusicXML fajl nije ispravan XML.');
  const elements = document.getElementsByTagName('*');
  if (elements.length > 200000) fail('Partitura je prevelika za prikaz u browseru.');
  for (const element of elements) {
    if (['script', 'style', 'svg', 'foreignObject', 'image', 'credit-image', 'link', 'opus'].includes(element.localName)) fail('Partitura sadrži DTD, entitete ili spoljne resurse koji nisu podržani.');
    for (const attr of element.attributes) {
      if (/^(?:href|src|source)$/i.test(attr.localName) || /^on/i.test(attr.name)) fail('Partitura sadrži DTD, entitete ili spoljne resurse koji nisu podržani.');
    }
  }
  return document;
}

export function validateMusicXml(text, fallbackTitle = '') {
  const document = xmlDocument(text);
  if (document.documentElement.localName !== 'score-partwise') fail('Izaberi MusicXML partituru tipa score-partwise (.musicxml, .xml ili .mxl).');
  const parts = document.querySelectorAll('score-partwise > part'), measures = document.querySelectorAll('part > measure'), notes = document.querySelectorAll('note');
  if (!parts.length || !measures.length || !notes.length) fail('MusicXML partitura nema note za prikaz.');
  if (parts.length > 32 || measures.length > 2000 || notes.length > 20000) fail('Partitura je prevelika za prikaz u browseru.');
  const title = document.querySelector('work-title, movement-title')?.textContent?.trim() || fallbackTitle;
  return { document, title, parts: parts.length, measures: Math.max(...[...parts].map(part => part.querySelectorAll(':scope > measure').length)), notes: notes.length };
}

export async function readScoreFile(file) {
  if (!file || !/\.(musicxml|xml|mxl)$/i.test(file.name)) fail('Izaberi MusicXML fajl (.musicxml, .xml ili .mxl). PDF i audio nisu MusicXML.');
  if (!file.size || file.size > MAX_FILE) fail('Partitura mora biti manja od 10 MB.');
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.mxl$/i.test(file.name) || bytes[0] === 80 && bytes[1] === 75) {
    const entries = zipEntries(bytes);
    const manifest = xmlDocument(decodeXml(await unzipEntry(bytes, entries.get('META-INF/container.xml'))));
    const rootfiles = [...manifest.querySelectorAll('rootfile')];
    const root = rootfiles.find(item => item.getAttribute('media-type') === 'application/vnd.recordare.musicxml+xml') || rootfiles[0];
    const path = root?.getAttribute('full-path');
    if (!safePath(path)) fail('MusicXML arhiva nema ispravnu putanju partiture.');
    bytes = await unzipEntry(bytes, entries.get(path));
  }
  if (bytes.length > MAX_XML) fail('Raspakovana partitura je prevelika (najviše 16 MB).');
  return validateMusicXml(decodeXml(bytes), file.name.replace(/\.(musicxml|xml|mxl)$/i, ''));
}

let libraryPromise;
function loadLibrary() {
  if (globalThis.opensheetmusicdisplay?.OpenSheetMusicDisplay) return Promise.resolve(globalThis.opensheetmusicdisplay);
  if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = new URL('./vendor/opensheetmusicdisplay.min.js', import.meta.url).href;
    script.onload = () => resolve(globalThis.opensheetmusicdisplay);
    script.onerror = () => { script.remove(); libraryPromise = null; reject(new Error('Prikaz partiture nije dostupan. Pokreni server ili pripremi offline aplikaciju.')); };
    document.head.append(script);
  });
  return libraryPromise;
}

export function createScoreImporter({ button, input, isBusy = () => false, onOpen = () => {}, onClose = () => {}, toast = () => {}, onDrumPattern = null }) {
  const dialog = document.createElement('dialog'); dialog.id = 'scoreImportDialog'; dialog.className = 'score-import-dialog';
  dialog.setAttribute('aria-labelledby', 'scoreImportTitle');
  dialog.innerHTML = `<header class="score-import-toolbar"><div class="score-import-heading"><h2 id="scoreImportTitle" data-user-text></h2><p id="scoreImportMeta" class="muted"></p></div><label>Veličina nota <input id="importedScoreScale" type="range" min="40" max="140" step="5" value="80" aria-label="Veličina nota"><output id="importedScoreScaleValue" data-user-text>80%</output></label><button id="scoreImportReplace">Druga partitura</button><button id="scoreImportClose">Vrati na bubanj</button></header><p class="score-import-notice">Originalna partitura za čitanje. Bubnjarsko bodovanje i snimanje ostaju vezani za izabrani ritam.</p><section id="scoreDrums" class="score-drums" hidden><h3>Bubnjarska deonica → ritam za vežbu</h3><div class="score-drums-form"><label>Deonica <select id="scoreDrumPart" data-user-text></select></label><label>Od takta <input id="scoreDrumFrom" type="number" min="1" step="1" value="1"></label><label>Taktova <select id="scoreDrumBars">${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option>${n}</option>`).join('')}</select></label><label>Podela <select id="scoreDrumGrid"><option value="auto">Automatski</option><option value="16">Šesnaestine</option><option value="12">Triole</option></select></label><button id="scoreDrumApply" class="primary">Otvori u editoru</button></div><p id="scoreDrumSummary" class="score-drums-summary" role="status"></p><details><summary>Instrumenti iz partiture</summary><div id="scoreDrumMap" class="score-drums-map"></div></details></section><p id="scoreImportStatus" role="status" aria-live="polite"></p><div id="scoreImportScroll" class="score-import-scroll"><div id="scoreImportCanvas" data-user-text translate="no"></div></div>`;
  document.body.append(dialog);
  const byId = id => dialog.querySelector('#' + id), status = byId('scoreImportStatus'), canvas = byId('scoreImportCanvas');
  const scale = byId('importedScoreScale'), scroll = byId('scoreImportScroll');
  let renderer = null, current = null, token = 0, zoomTimer = 0, resizeTimer = 0, lastWidth = 0, drums = null;
  const setStatus = message => { status.textContent = t(message); status.hidden = !message; };
  function draw() {
    if (!renderer || !current || !dialog.open) return;
    renderer.Zoom = Number(scale.value) / 100;
    renderer.render(); lastWidth = canvas.clientWidth;
    byId('importedScoreScaleValue').textContent = `${scale.value}%`;
    scale.setAttribute('aria-valuetext', `${scale.value}%`);
  }
  // Drum part → pattern: the mapping starts from instrument names, GM numbers
  // and staff positions, and can be corrected before opening the editor.
  function setupDrums(score) {
    const parts = onDrumPattern ? drumParts(score.document) : [];
    drums = parts.length ? { document: score.document, title: score.title, parts } : null;
    byId('scoreDrums').hidden = !drums;
    if (!drums) return;
    byId('scoreDrumPart').replaceChildren(...parts.map(part => new Option(`${part.name} (${part.measures})`, part.id)));
    byId('scoreDrumFrom').value = 1; byId('scoreDrumBars').value = String(Math.min(2, parts[0].measures)); byId('scoreDrumGrid').value = 'auto';
    choosePart(parts[0].id);
  }
  function choosePart(id) {
    const part = drums.parts.find(p => p.id === id), keys = drumKeys(drums.document, id);
    Object.assign(drums, { part, keys, map: Object.fromEntries(keys.map(k => [k.id, k.suggested || ''])) });
    byId('scoreDrumFrom').max = part.measures;
    const map = byId('scoreDrumMap'); map.replaceChildren();
    for (const key of keys) {
      const label = document.createElement('label'), name = document.createElement('span');
      name.textContent = [key.name, key.step && `${key.step}${key.octave || ''}`, key.midi != null && `MIDI ${key.midi}`, `${key.count}×`].filter(Boolean).join(' · '); name.dataset.userText = '';
      const select = document.createElement('select'); select.dataset.drumKey = key.id;
      select.append(new Option(t('Preskoči'), ''), ...INSTRUMENTS.map(inst => new Option(t(inst.label), inst.id)));
      select.value = drums.map[key.id]; label.append(name, select); map.append(label);
    }
    previewDrums();
  }
  function previewDrums() {
    if (!drums) return null;
    let result = null;
    try {
      result = drumPartToPattern(drums.document, { partId: drums.part.id, from: Number(byId('scoreDrumFrom').value), bars: Number(byId('scoreDrumBars').value),
        quantize: byId('scoreDrumGrid').value, map: drums.map, name: drums.title ? `${drums.title} — ${drums.part.name}` : drums.part.name });
      const extra = [result.ignored && `${t('preskočeno')}: ${result.ignored}`, result.collisions && `${t('spojeno u isti korak')}: ${result.collisions}`,
        result.outside && `${t('van takta')}: ${result.outside}`, result.tremolo && `${t('tremolo kao jedan udarac')}: ${result.tremolo}`].filter(Boolean).join(' · ');
      byId('scoreDrumSummary').textContent = `${t('Takt')} ${result.from}–${result.from + result.bars - 1} / ${result.measures} · ${result.pattern.beats}/${result.pattern.beatUnit} · `
        + `${result.pattern.division === 12 ? t('triole') : t('šesnaestine')} · ${result.bpm} BPM${result.tempoFound ? '' : ` (${t('tempo nije zapisan')})`} · ${t('Udarci')}: ${result.imported}${extra ? ' · ' + extra : ''}`
        + (result.imported ? '' : ` · ${t('Nema mapiranih udaraca u izabranom delu.')}`);
    } catch (error) { byId('scoreDrumSummary').textContent = t(error.message); }
    byId('scoreDrumApply').disabled = !result?.imported || isBusy();
    return result;
  }
  function close() {
    token++; clearTimeout(zoomTimer); clearTimeout(resizeTimer); drums = null;
    if (dialog.open) dialog.close();
    renderer?.clear(); renderer = null; current = null; canvas.replaceChildren();
    onClose(); button?.focus();
  }
  async function open(file) {
    if (isBusy()) { toast(t('Zaustavi vežbu pre uvoza partiture.')); return false; }
    const request = ++token;
    try {
      const score = await readScoreFile(file);
      if (request !== token) return false;
      if (isBusy()) { toast(t('Zaustavi vežbu pre uvoza partiture.')); return false; }
      onOpen();
      if (!dialog.open) dialog.showModal();
      byId('scoreImportTitle').textContent = score.title;
      byId('scoreImportMeta').textContent = `${t('Deonice')}: ${score.parts} · ${t('Taktovi')}: ${score.measures}`;
      try { setupDrums(score); } catch { drums = null; byId('scoreDrums').hidden = true; }
      setStatus('Učitavam originalnu partituru…');
      renderer?.clear(); renderer = null; current = null; canvas.replaceChildren();
      const library = await loadLibrary(); if (request !== token || !dialog.open) return false;
      const renderHost = document.createElement('div'); canvas.append(renderHost);
      const next = new library.OpenSheetMusicDisplay(renderHost, { backend: 'svg', autoResize: false, drawTitle: true,
        newSystemFromXML: true, newSystemFromNewPageInXML: true,
        drawComposer: true, drawPartNames: true, disableCursor: true, defaultFontFamily: 'Times New Roman' });
      await next.load(score.document, score.title);
      if (request !== token || !dialog.open) { next.clear(); return false; }
      renderer = next; current = score; draw(); scroll.scrollTop = 0; setStatus('');
      document.dispatchEvent(new Event('drummer:translate')); return true;
    } catch (error) {
      if (request !== token) return false;
      const message = t(error.message || 'MusicXML partitura nije mogla da se prikaže.');
      toast(message); if (dialog.open) setStatus(message); return false;
    }
  }
  if (button) button.onclick = () => input.click();
  input.onchange = event => { const file = event.target.files[0]; input.value = ''; if (file) open(file); };
  byId('scoreImportReplace').onclick = () => input.click(); byId('scoreImportClose').onclick = close;
  byId('scoreDrumPart').onchange = event => choosePart(event.target.value);
  for (const id of ['scoreDrumFrom', 'scoreDrumBars', 'scoreDrumGrid']) byId(id).onchange = () => previewDrums();
  byId('scoreDrumMap').onchange = event => { const select = event.target.closest('[data-drum-key]'); if (select && drums) { drums.map[select.dataset.drumKey] = select.value; previewDrums(); } };
  byId('scoreDrumApply').onclick = () => {
    const result = previewDrums(); if (!result?.imported || isBusy()) return;
    if (onDrumPattern(result.pattern) !== false) close();
  };
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } });
  scale.oninput = () => { byId('importedScoreScaleValue').textContent = `${scale.value}%`; clearTimeout(zoomTimer); zoomTimer = setTimeout(() => { try { draw(); } catch { setStatus('MusicXML partitura nije mogla da se prikaže.'); } }, 100); };
  new ResizeObserver(() => {
    if (!dialog.open || !renderer || Math.abs(canvas.clientWidth - lastWidth) < 2) return;
    clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { try { draw(); } catch { setStatus('MusicXML partitura nije mogla da se prikaže.'); } }, 120);
  }).observe(scroll);
  document.addEventListener('drummer:language', () => { if (current) byId('scoreImportMeta').textContent = `${t('Deonice')}: ${current.parts} · ${t('Taktovi')}: ${current.measures}`; });
  return { open, close, get isOpen() { return dialog.open; } };
}
