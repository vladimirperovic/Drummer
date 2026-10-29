// Local MusicXML reader. The original pitched score stays separate from the
// drum practice pattern; no notes are remapped to percussion instruments.
import { t } from './i18n.js';

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

export function createScoreImporter({ button, input, isBusy = () => false, onOpen = () => {}, onClose = () => {}, toast = () => {} }) {
  const dialog = document.createElement('dialog'); dialog.id = 'scoreImportDialog'; dialog.className = 'score-import-dialog';
  dialog.setAttribute('aria-labelledby', 'scoreImportTitle');
  dialog.innerHTML = `<header class="score-import-toolbar"><div class="score-import-heading"><h2 id="scoreImportTitle" data-user-text></h2><p id="scoreImportMeta" class="muted"></p></div><label>Veličina nota <input id="importedScoreScale" type="range" min="40" max="140" step="5" value="80" aria-label="Veličina nota"><output id="importedScoreScaleValue" data-user-text>80%</output></label><button id="scoreImportReplace">Druga partitura</button><button id="scoreImportClose">Vrati na bubanj</button></header><p class="score-import-notice">Originalna partitura za čitanje. Bubnjarsko bodovanje i snimanje ostaju vezani za izabrani ritam.</p><p id="scoreImportStatus" role="status" aria-live="polite"></p><div id="scoreImportScroll" class="score-import-scroll"><div id="scoreImportCanvas" data-user-text translate="no"></div></div>`;
  document.body.append(dialog);
  const byId = id => dialog.querySelector('#' + id), status = byId('scoreImportStatus'), canvas = byId('scoreImportCanvas');
  const scale = byId('importedScoreScale'), scroll = byId('scoreImportScroll');
  let renderer = null, current = null, token = 0, zoomTimer = 0, resizeTimer = 0, lastWidth = 0;
  const setStatus = message => { status.textContent = t(message); status.hidden = !message; };
  function draw() {
    if (!renderer || !current || !dialog.open) return;
    renderer.Zoom = Number(scale.value) / 100;
    renderer.render(); lastWidth = canvas.clientWidth;
    byId('importedScoreScaleValue').textContent = `${scale.value}%`;
    scale.setAttribute('aria-valuetext', `${scale.value}%`);
  }
  function close() {
    token++; clearTimeout(zoomTimer); clearTimeout(resizeTimer);
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
