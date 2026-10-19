// Crta ritam kao note za bubanj (SVG). Vrijeme je proporcionalno: svaki korak ima istu širinu,
// pa linija koja prati sviranje ide ravnomjerno i tačno preko nota.

import { INSTRUMENTS, INST, slotsPerBeat, slotsPerBar, totalSlots } from './patterns.js';

const NS = 'http://www.w3.org/2000/svg';
const SP = 10;            // razmak između linija
const HALF = SP / 2;
const TOP = 72;           // od vrha reda do gornje linije
const HEAD_W = 6.2;       // pola širine glave note
const HEADER = 60;        // ključ i oznaka takta
const PAD_L = 18, PAD_R = 12;

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}

// Za jednu dobu jednog glasa: niz pauza i nota sa trajanjem u koracima.
function beatEvents(p, voice, start, spb) {
  const hitAt = i => voice.filter(inst => p.steps[inst.id][start + i] > 0);
  const hits = [];
  for (let i = 0; i < spb; i++) if (hitAt(i).length) hits.push(i);
  if (!hits.length) return [{ rest: true, slot: start, dur: spb }];
  const events = [];
  if (hits[0] > 0) events.push({ rest: true, slot: start, dur: hits[0] });
  hits.forEach((h, k) => {
    const insts = hitAt(h);
    events.push({
      rest: false, slot: start + h, dur: (hits[k + 1] ?? spb) - h, insts,
      dyn: Object.fromEntries(insts.map(i => [i.id, p.steps[i.id][start + h]])),
    });
  });
  return events;
}

export function renderNotation(container, p, { maxHeight = Infinity } = {}) {
  container.innerHTML = '';
  const pixelW = Math.max(340, container.clientWidth || 900);
  const spb = slotsPerBeat(p), spBar = slotsPerBar(p), total = totalSlots(p);
  const minBar = spBar * (p.division === 12 ? 30 : 23) + PAD_L + PAD_R;
  const up = INSTRUMENTS.filter(i => i.voice === 'up');
  const down = INSTRUMENTS.filter(i => i.voice === 'down');
  const used = v => v.some(inst => p.steps[inst.id].some(Boolean));
  const upUsed = used(up), downUsed = used(down);
  const LINE_H = TOP + 4 * SP + (downUsed ? 64 : 28) + (p.sticking?.trim() ? 24 : 0);

  // Note što veće (bubnjar gleda sa metar udaljenosti), a da stanu u zadatu visinu
  let scale = 1.5, width, linesCount;
  for (;; scale -= 0.05) {
    width = pixelW / scale;
    const fit = Math.max(1, Math.floor((width - HEADER - 8) / minBar));
    linesCount = Math.ceil(p.bars / Math.min(p.bars, fit));
    if ((linesCount * LINE_H + 6) * scale <= maxHeight || scale <= 0.75) break;
  }
  const barsPerLine = Math.ceil(p.bars / linesCount);
  const barW = (width - HEADER - 8) / barsPerLine;
  const slotW = (barW - PAD_L - PAD_R) / spBar;
  const height = linesCount * LINE_H + 6;

  const svg = el('svg', { width: pixelW, height: height * scale, viewBox: `0 0 ${width} ${height}`, class: 'notation-svg' }, container);
  const staffLayer = el('g', {}, svg);
  const notesLayer = el('g', {}, svg);
  const markLayer = el('g', { class: 'marks' }, svg);
  const playhead = el('rect', { class: 'playhead', width: 2, height: 4 * SP + 64, x: -20, y: 0, rx: 1 }, svg);

  // Notni sistemi
  const lines = [];
  for (let L = 0; L < linesCount; L++) {
    const y0 = 6 + L * LINE_H + TOP;
    const firstBar = L * barsPerLine;
    const nBars = Math.min(barsPerLine, p.bars - firstBar);
    const x0 = 4, x1 = HEADER + nBars * barW;
    lines.push({ y0, firstBar });
    for (let i = 0; i < 5; i++) el('line', { x1: x0, x2: x1, y1: y0 + i * SP, y2: y0 + i * SP, class: 'staff' }, staffLayer);
    el('line', { x1: x0, x2: x0, y1: y0, y2: y0 + 4 * SP, class: 'barline' }, staffLayer);
    el('rect', { x: x0 + 12, y: y0 + SP, width: 4.5, height: 2 * SP, class: 'ink' }, staffLayer);
    el('rect', { x: x0 + 21, y: y0 + SP, width: 4.5, height: 2 * SP, class: 'ink' }, staffLayer);
    if (L === 0) {
      el('text', { x: x0 + 44, y: y0 + 2 * SP - 1, class: 'timesig' }, staffLayer).textContent = p.beats;
      el('text', { x: x0 + 44, y: y0 + 4 * SP - 1, class: 'timesig' }, staffLayer).textContent = '4';
    }
    for (let b = 0; b < nBars; b++) {
      const bar = firstBar + b;
      const bx = HEADER + (b + 1) * barW;
      if (p.bars > 1) el('text', { x: HEADER + b * barW + 4, y: y0 - 66, class: 'barnum' }, staffLayer).textContent = bar + 1;
      if (bar === p.bars - 1) {
        el('circle', { cx: bx - 14, cy: y0 + 1.5 * SP, r: 2.2, class: 'ink' }, staffLayer);
        el('circle', { cx: bx - 14, cy: y0 + 2.5 * SP, r: 2.2, class: 'ink' }, staffLayer);
        el('line', { x1: bx - 8, x2: bx - 8, y1: y0, y2: y0 + 4 * SP, class: 'barline' }, staffLayer);
        el('rect', { x: bx - 5, y: y0, width: 4.5, height: 4 * SP, class: 'ink' }, staffLayer);
      } else {
        el('line', { x1: bx, x2: bx, y1: y0, y2: y0 + 4 * SP, class: 'barline' }, staffLayer);
      }
    }
  }

  function slotPos(s) {
    const bar = Math.min(p.bars - 1, Math.max(0, Math.floor(s / spBar)));
    const L = Math.floor(bar / barsPerLine), b = bar - L * barsPerLine;
    return { x: HEADER + b * barW + PAD_L + (s - bar * spBar) * slotW + HEAD_W, line: lines[L], bar };
  }

  const noteEls = Array.from({ length: total }, () => []);

  // Simboli trajanja: beams = broj greda/zastavica (0 četvrtina, 1 osmina, 2 šesnaestina)
  const durSym = d => (p.division === 12
    ? { 1: { beams: 1 }, 2: { beams: 0 }, 3: { beams: 0 } }[d]
    : { 1: { beams: 2 }, 2: { beams: 1 }, 3: { beams: 1, dot: true }, 4: { beams: 0 } }[d]);

  function drawHead(inst, x, y, dyn, slot, y0) {
    const g = el('g', { class: `head dyn${dyn}`, 'data-inst': inst.id }, notesLayer);
    for (let lp = -2; lp >= inst.pos; lp -= 2) el('line', { x1: x - 10, x2: x + 10, y1: y0 + lp * HALF, y2: y0 + lp * HALF, class: 'ledger' }, g);
    if (inst.head === 'normal') {
      el('ellipse', { cx: x, cy: y, rx: HEAD_W, ry: 4.4, transform: `rotate(-20 ${x} ${y})`, class: 'fillhead' }, g);
    } else if (inst.head === 'diamond') {
      el('path', { d: `M${x} ${y - 5.5} L${x + 6} ${y} L${x} ${y + 5.5} L${x - 6} ${y} Z`, class: 'fillhead' }, g);
    } else {
      el('path', { d: `M${x - 4.6} ${y - 4.6} L${x + 4.6} ${y + 4.6} M${x + 4.6} ${y - 4.6} L${x - 4.6} ${y + 4.6}`, class: 'xhead' }, g);
      if (inst.head === 'circlex') el('circle', { cx: x, cy: y, r: 6.6, class: 'xhead', fill: 'none' }, g);
    }
    if (dyn === 1) {
      el('text', { x: x - 12, y: y + 4.5, class: 'paren' }, g).textContent = '(';
      el('text', { x: x + 8, y: y + 4.5, class: 'paren' }, g).textContent = ')';
    }
    noteEls[slot].push(g);
    return g;
  }

  function drawRest(sym, x, y) {
    const g = el('g', { class: 'rest' }, notesLayer);
    if (sym.beams === 0) {
      el('path', { d: `M${x - 3} ${y - 14} L${x + 3} ${y - 7} Q${x - 2} ${y - 3} ${x} ${y + 1} L${x + 4} ${y + 6} Q${x - 4} ${y + 3} ${x - 1} ${y + 12}`, class: 'reststroke' }, g);
    } else {
      const flags = sym.beams;
      for (let k = 0; k < flags; k++) {
        const fy = y - 6 + k * 6, fx = x - 1 - k * 1.5;
        el('circle', { cx: fx - 2.5, cy: fy, r: 2.4, class: 'ink' }, g);
        el('path', { d: `M${fx - 2.5} ${fy + 1.5} Q${fx + 1} ${fy + 2.5} ${fx + 4.5 - 0} ${fy - 2}`, class: 'reststroke thin' }, g);
      }
      el('line', { x1: x + 3.5, y1: y - 8, x2: x - 1.5 - flags * 1.5, y2: y + 7 + flags * 4, class: 'reststroke thin' }, g);
    }
    if (sym.dot) el('circle', { cx: x + 8, cy: y - 5, r: 1.8, class: 'ink' }, g);
  }

  function drawFlags(sx, end, dir, count) {
    for (let k = 0; k < count; k++) {
      const y = end - dir * k * 7;
      const s = -dir; // 1 kada vrat ide gore, pa zastavica pada naniže
      el('path', {
        d: `M${sx} ${y} C${sx + 1} ${y + 7 * s} ${sx + 10} ${y + 9 * s} ${sx + 8} ${y + 19 * s} C${sx + 7} ${y + 12 * s} ${sx + 3} ${y + 10 * s} ${sx} ${y + 8 * s} Z`,
        class: 'ink',
      }, notesLayer);
    }
  }

  function drawBeat(voice, dir, start) {
    const events = beatEvents(p, voice, start, spb);
    const { line } = slotPos(start);
    const { y0 } = line;
    const yOf = pos => y0 + pos * HALF;
    for (const e of events) e.sym = durSym(e.dur);

    const restY = upUsed && downUsed ? (dir < 0 ? y0 + 1 * SP : y0 + 4 * SP + 8) : y0 + 2 * SP;
    for (const e of events.filter(e => e.rest)) drawRest(e.sym, slotPos(e.slot).x, restY);

    const notes = events.filter(e => !e.rest);
    const beamable = notes.filter(n => n.sym.beams > 0);
    const group = beamable.length >= 2 ? beamable : [];
    const stemEnd = n => (dir < 0
      ? Math.min(...n.insts.map(i => yOf(i.pos))) - 32
      : Math.max(...n.insts.map(i => yOf(i.pos))) + 32);
    const beamY = group.length ? (dir < 0 ? Math.min(...group.map(stemEnd)) : Math.max(...group.map(stemEnd))) : null;
    const stemX = n => slotPos(n.slot).x + (dir < 0 ? HEAD_W - 0.6 : -HEAD_W + 0.6);

    for (const n of notes) {
      const x = slotPos(n.slot).x;
      const ys = n.insts.map(i => yOf(i.pos));
      const sx = stemX(n);
      const inGroup = group.includes(n);
      const end = inGroup ? beamY : stemEnd(n);
      el('line', { x1: sx, x2: sx, y1: dir < 0 ? Math.max(...ys) : Math.min(...ys), y2: end, class: 'stem' }, notesLayer);
      if (!inGroup && n.sym.beams > 0) drawFlags(sx, end, dir, n.sym.beams);

      // Sekunda (npr. hi-hat i crash zajedno): gornja glava ide na drugu stranu vrata
      const sorted = [...n.insts].sort((a, b) => b.pos - a.pos);
      let prev = null, prevShifted = false;
      for (const inst of sorted) {
        const shift = dir < 0 && prev && prev.pos - inst.pos === 1 && !prevShifted;
        drawHead(inst, x + (shift ? 2 * HEAD_W - 1 : 0), yOf(inst.pos), n.dyn[inst.id], n.slot, y0);
        if (n.sym.dot) {
          const dy = inst.pos % 2 === 0 ? -HALF : 0;
          el('circle', { cx: x + HEAD_W + 5, cy: yOf(inst.pos) + dy, r: 1.8, class: 'ink' }, notesLayer);
        }
        prev = inst; prevShifted = shift;
      }
      if (Object.values(n.dyn).includes(3)) {
        const ay = dir < 0 ? y0 - 54 : y0 + 4 * SP + 52;
        el('path', { d: `M${x - 5} ${ay - 4} L${x + 5} ${ay} L${x - 5} ${ay + 4}`, class: 'accent' }, notesLayer);
      }
      if (n.insts.some(i => i.open)) el('circle', { cx: x, cy: y0 - 64, r: 3.6, class: 'openmark' }, notesLayer);
    }

    if (group.length) {
      const xs = group.map(stemX);
      const by = dir < 0 ? beamY : beamY - 5;
      el('rect', { x: xs[0] - 0.7, y: by, width: xs[xs.length - 1] - xs[0] + 1.4, height: 5, class: 'ink' }, notesLayer);
      const sy = dir < 0 ? beamY + 8 : beamY - 13;
      group.forEach((n, i) => {
        if (n.sym.beams < 2) return;
        const next = group[i + 1], prevN = group[i - 1];
        if (next && next.sym.beams >= 2) {
          el('rect', { x: xs[i] - 0.7, y: sy, width: xs[i + 1] - xs[i] + 1.4, height: 5, class: 'ink' }, notesLayer);
        } else if (!(prevN && prevN.sym.beams >= 2)) {
          const left = i === group.length - 1;
          el('rect', { x: left ? xs[i] - 9 : xs[i] - 0.7, y: sy, width: 9.7, height: 5, class: 'ink' }, notesLayer);
        }
      });
    }

    if (p.division === 12 && events.length > 1) {
      const cx = (slotPos(start).x + slotPos(start + spb - 1).x) / 2 + (dir < 0 ? HEAD_W : -HEAD_W);
      const ty = dir < 0 ? (beamY ?? y0 - 30) - 6 : (beamY ?? y0 + 75) + 15;
      el('text', { x: cx, y: ty, class: 'tuplet' }, notesLayer).textContent = '3';
    }
  }

  for (const [voice, dir, isUsed] of [[up, -1, upUsed], [down, 1, downUsed]]) {
    if (!isUsed) continue;
    for (let bar = 0; bar < p.bars; bar++)
      for (let beat = 0; beat < p.beats; beat++) drawBeat(voice, dir, bar * spBar + beat * spb);
  }

  if (p.sticking) {
    for (let i = 0; i < Math.min(total, p.sticking.length); i++) {
      const ch = p.sticking[i];
      if (!ch.trim() || ch === '.') continue;
      const { x, line } = slotPos(i);
      el('text', { x, y: line.y0 + 4 * SP + (downUsed ? 76 : 26), class: 'sticking' }, notesLayer).textContent = ch;
    }
  }

  let marks = [];
  return {
    total,
    slotPos,
    setPlayhead(s) {
      if (s == null) return playhead.setAttribute('x', -20);
      const { x, line } = slotPos(s);
      playhead.setAttribute('x', x - 1);
      playhead.setAttribute('y', line.y0 - 32);
    },
    flashSlot(slot) {
      for (const g of noteEls[slot] || []) {
        g.classList.add('now');
        setTimeout(() => g.classList.remove('now'), 170);
      }
    },
    // Oznaka udarca oko note: good zeleni krug, ok sivi, miss isprekidan crveni, extra crvena tačka
    mark(s, instId, kind, loop) {
      const { x, line, bar } = slotPos(s);
      const inst = INST[instId];
      const c = el('circle', { cx: x, cy: line.y0 + inst.pos * HALF, r: kind === 'extra' ? 3.6 : 9.5, class: `mark ${kind}` }, markLayer);
      marks.push({ c, bar, loop });
    },
    clearBar(bar, loop) {
      marks = marks.filter(m => {
        if (m.bar === bar && m.loop < loop) { m.c.remove(); return false; }
        return true;
      });
    },
    clearMarks() { markLayer.innerHTML = ''; marks = []; },
  };
}
