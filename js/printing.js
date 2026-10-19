import { normalize, slotsPerBar, INSTRUMENTS, patternInfo } from './patterns.js';
import { renderNotation } from './notation.js';
import { t } from './i18n.js';

export function printRows(pattern, { barsPerLine = 2, repeats = 1, sticking = true } = {}) {
  const p = normalize(pattern), spBar = slotsPerBar(p), count = p.bars * Math.max(1, Math.min(8, Math.round(repeats) || 1));
  const size = Math.max(1, Math.min(4, Math.round(barsPerLine) || 2)), rows = [];
  for (let offset = 0; offset < count; offset += size) {
    const bars = Math.min(size, count - offset), steps = {};
    for (const inst of INSTRUMENTS) steps[inst.id] = Array.from({ length: bars * spBar }, (_, slot) => p.steps[inst.id][(offset * spBar + slot) % (p.bars * spBar)]);
    const hands = sticking ? Array.from({ length: bars * spBar }, (_, slot) => p.sticking[(offset * spBar + slot) % (p.bars * spBar)] || ' ').join('') : '';
    rows.push({ pattern: normalize({ ...p, bars, steps, sticking: hands }), offset, final: offset + bars === count });
  }
  return rows;
}

export function renderPrint(container, pattern, options = {}) {
  container.replaceChildren();
  const rows = printRows(pattern, options), pages = Math.ceil(rows.length / 3);
  for (let page = 0; page < pages; page++) {
    const sheet = document.createElement('section'); sheet.className = 'print-page'; container.append(sheet);
    const title = document.createElement('h1'); title.textContent = pattern.preset ? t(pattern.name) : pattern.name; title.dataset.userText = '';
    const info = document.createElement('p'); info.className = 'print-info'; info.textContent = patternInfo(pattern) + ' · BPM = četvrtina';
    sheet.append(title, info);
    for (const row of rows.slice(page * 3, page * 3 + 3)) {
      const host = document.createElement('div'); host.className = 'print-staff'; sheet.append(host);
      renderNotation(host, row.pattern, { pageWidth: 700, barsPerLine: row.pattern.bars, barOffset: row.offset, finalBar: row.final, maxHeight: 215 });
    }
    const footer = document.createElement('footer'); footer.textContent = `Drummer · ${page + 1} / ${pages}`; sheet.append(footer);
  }
  return pages;
}
