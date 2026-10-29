import { INST, INSTRUMENTS, normalize, slotsPerBar, slotOffsetMs, slotAtMs, slotDurationMs } from './patterns.js';
import { renderNotation } from './notation.js';
import { getLanguage } from './i18n.js';

const words = (sr, en) => getLanguage() === 'en' ? en : sr;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const NS = 'http://www.w3.org/2000/svg';
const signed = value => `${value > 0 ? '+' : ''}${Number(value.toFixed(1))} ms`;
const svgEl = (tag, attrs, parent, text) => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  parent.appendChild(node); return node;
};

export function performancePasses(session) {
  const values = [...(session.timeline || []), ...(session.expected || []), ...session.hits];
  return [...new Set(values.map(e => Math.max(0, Number(e.loop) || 0)))].sort((a, b) => a - b);
}

// The recorded slot clock includes live tempo changes and swing. Interpolation
// uses that clock, rather than stretching a whole session at its final BPM.
export function performanceBar(session, loop, bar) {
  const p = session.pattern, spBar = slotsPerBar(p), firstSlot = (bar - 1) * spBar;
  const timeline = (session.timeline || []).filter(e => e.loop === loop).sort((a, b) => a.slot - b.slot);
  const fallback = { slot: ((session.range?.from || 1) - 1) * spBar, timeMs: 0, bpm: session.bpmStart || p.bpm };
  const knots = timeline.length ? timeline : [fallback];
  const timeAt = slot => {
    let anchor = knots[0];
    for (const knot of knots) { if (knot.slot > slot) break; anchor = knot; }
    const timed = { ...p, bpm: anchor.bpm || p.bpm };
    return anchor.timeMs + slotOffsetMs(timed, slot) - slotOffsetMs(timed, anchor.slot);
  };
  const slotAt = timeMs => {
    let low = 0, high = knots.length;
    while (low < high) { const mid = (low + high) >> 1; if (knots[mid].timeMs <= timeMs) low = mid + 1; else high = mid; }
    const a = knots[Math.max(0, low - 1)], b = knots[low];
    if (b && a !== b && timeMs >= a.timeMs && b.timeMs > a.timeMs)
      return a.slot + (timeMs - a.timeMs) / (b.timeMs - a.timeMs) * (b.slot - a.slot);
    const timed = { ...p, bpm: a.bpm || p.bpm };
    return slotAtMs(timed, slotOffsetMs(timed, a.slot) + timeMs - a.timeMs);
  };
  const expectedById = new Map((session.expected || []).map(e => [e.id, e]));
  const firstBar = session.range?.from || 1, lastBar = session.range?.to || p.bars;
  const hits = session.hits.filter(h => h.loop === loop).map((hit, index) => {
    const expected = expectedById.get(hit.expectedId);
    const adjustedTimeMs = expected && Number.isFinite(hit.err) ? expected.timeMs + hit.err : hit.timeMs - (session.calib || 0);
    const slot = slotAt(adjustedTimeMs);
    const owner = expected ? Math.floor(expected.slot / spBar) + 1 : Math.max(firstBar, Math.min(lastBar, Math.floor(slot / spBar) + 1));
    return { ...hit, index, expected, adjustedTimeMs, localSlot: slot - firstSlot, bar: owner };
  }).filter(hit => hit.bar === bar);
  const expected = (session.expected || []).filter(e => e.loop === loop && e.slot >= firstSlot && e.slot < firstSlot + spBar);
  const hitIds = new Set(session.hits.map(h => h.expectedId).filter(Boolean));
  const missed = expected.filter(e => !hitIds.has(e.id));
  const oneBar = normalize({ ...p, bars: 1, steps: Object.fromEntries(INSTRUMENTS.map(i => [i.id, p.steps[i.id].slice(firstSlot, firstSlot + spBar)])), sticking: (p.sticking || '').slice(firstSlot, firstSlot + spBar) });
  if (timeline.length) {
    const scheduled = new Set(timeline.map(e => e.slot));
    for (const values of Object.values(oneBar.steps)) for (let i = 0; i < spBar; i++) if (!scheduled.has(firstSlot + i)) values[i] = 0;
  }
  // Recording can edit the live pattern; scored expectations are the source of
  // truth for the notes the player actually heard during this pass.
  for (const e of expected) oneBar.steps[e.inst][e.slot - firstSlot] = e.dyn;
  const end = knots.at(-1), timed = { ...p, bpm: end.bpm || p.bpm };
  return { pattern: oneBar, hits, expected, missed, firstSlot, startMs: timeAt(firstSlot),
    endMs: Math.min(timeAt(firstSlot + spBar), end.timeMs + slotDurationMs(timed, end.slot)), loop, bar };
}

function drawHead(parent, inst, x, y, className, radius = 5.6) {
  const g = svgEl('g', { class: className }, parent);
  if (inst.head === 'normal') svgEl('ellipse', { cx: x, cy: y, rx: radius, ry: radius * .7, transform: `rotate(-20 ${x} ${y})` }, g);
  else if (inst.head === 'diamond') svgEl('path', { d: `M${x} ${y - radius}L${x + radius} ${y}L${x} ${y + radius}L${x - radius} ${y}Z` }, g);
  else {
    svgEl('path', { d: `M${x - radius} ${y - radius}L${x + radius} ${y + radius}M${x + radius} ${y - radius}L${x - radius} ${y + radius}`, fill: 'none' }, g);
    if (inst.head === 'circlex') svgEl('circle', { cx: x, cy: y, r: radius + 2, fill: 'none' }, g);
  }
  return g;
}

export function renderPerformanceReport(container, session) {
  const passes = performancePasses(session);
  if (!passes.length) { container.replaceChildren(); return; }
  container.className = 'performance-report';
  container.innerHTML = `<header><div><h3>${words('Tvoje sviranje u notama', 'Your performance in notation')}</h3><p>${words('Crne note su zadatak. Crvene note ispod pokazuju kada si stvarno udario. Levo = ranije, desno = kasnije.', 'Black notes are the exercise. Red notes below show when you actually played. Left = early, right = late.')}</p></div></header>
    <div class="performance-controls"><label>${words('Prolaz', 'Pass')} <select data-report-pass>${passes.map(n => `<option value="${n}">${n + 1}</option>`).join('')}</select></label><label>${words('Takt', 'Bar')} <select data-report-bar></select></label><label>${words('Instrument', 'Instrument')} <select data-report-instrument><option value="">${words('Svi instrumenti', 'All instruments')}</option>${INSTRUMENTS.filter(i => session.hits.some(h => h.inst === i.id) || session.pattern.steps[i.id]?.some(Boolean)).map(i => `<option value="${i.id}">${esc(i.label)}</option>`).join('')}</select></label><button type="button" data-report-prev aria-label="${words('Prethodni takt', 'Previous bar')}">←</button><button type="button" data-report-next aria-label="${words('Sledeći takt', 'Next bar')}">→</button></div>
    <p class="performance-legend"><span class="reference-key">● ${words('Zadato', 'Expected')}</span><span class="actual-key">● ${words('Tvoj udarac', 'Your hit')}</span><span class="miss-key">○ ${words('Propuštena nota', 'Missed note')}</span><span>+ ms ${words('kasniš', 'late')} / − ms ${words('žuriš', 'early')}</span></p>
    <p class="performance-summary" aria-live="polite"></p><div class="performance-scroll"><div class="performance-score"></div></div><p class="performance-calibration"></p><details class="performance-details"><summary>${words('Tačna vremena udaraca', 'Exact hit times')}</summary><div class="table-wrap"><table class="data-table"><thead><tr><th>${words('Instrument', 'Instrument')}</th><th>${words('Vreme od početka', 'Time from start')}</th><th>${words('Odstupanje', 'Timing error')}</th><th>${words('Ishod', 'Result')}</th></tr></thead><tbody></tbody></table></div></details>`;
  const find = selector => container.querySelector(selector);
  const passSelect = find('[data-report-pass]'), barSelect = find('[data-report-bar]'), instrument = find('[data-report-instrument]');
  const barsForPass = () => {
    const slots = (session.timeline || []).filter(e => e.loop === +passSelect.value).map(e => Math.floor(e.slot / slotsPerBar(session.pattern)) + 1);
    return slots.length ? [...new Set(slots)].sort((a, b) => a - b) : Array.from({ length: (session.range?.to || session.pattern.bars) - (session.range?.from || 1) + 1 }, (_, i) => (session.range?.from || 1) + i);
  };
  const draw = () => {
    const model = performanceBar(session, +passSelect.value, +barSelect.value), selected = instrument.value;
    if (selected) for (const id of Object.keys(model.pattern.steps)) if (id !== selected) model.pattern.steps[id].fill(0);
    const hits = model.hits.filter(h => !selected || h.inst === selected), missed = model.missed.filter(e => !selected || e.inst === selected);
    const width = Math.max(1100, slotsPerBar(model.pattern) * 58 + 180);
    const score = renderNotation(find('.performance-score'), model.pattern, { pageWidth: width, barsPerLine: 1, barOffset: model.bar - 1, finalBar: false });
    const svg = score.svg || find('svg'), first = score.slotPos(0), next = score.slotPos(1), slotWidth = next.x - first.x;
    const half = score.geometry?.halfStep || 5, shift = 190, y0 = first.line.y0 + shift;
    const layer = svgEl('g', { class: 'performance-overlay' }, svg);
    const pos = (id, slot) => score.instrumentPos ? score.instrumentPos(id, slot) : { ...score.slotPos(slot), y: first.line.y0 + INST[id].pos * half };
    const xAt = slot => first.x + slot * slotWidth;
    const actualX = hit => {
      // Chord engraving can shift one head sideways. Keep that same offset for
      // its played head so an on-time chord does not appear rhythmically late.
      const referenceSlot = hit.expected ? hit.expected.slot - model.firstSlot : null;
      const headOffset = referenceSlot == null ? 0 : pos(hit.expected.inst, referenceSlot).x - xAt(referenceSlot);
      return xAt(hit.localSlot) + headOffset;
    };
    for (let line = 0; line < 5; line++) svgEl('line', { x1: 4, x2: xAt(slotsPerBar(model.pattern)), y1: y0 + line * half * 2, y2: y0 + line * half * 2, class: 'performance-staff' }, layer);
    svgEl('text', { x: 8, y: y0 - 70, class: 'performance-staff-label' }, layer, words('TVOJI UDARCI', 'YOUR HITS'));
    for (const inst of INSTRUMENTS) {
      model.pattern.steps[inst.id].forEach((dyn, slot) => {
        if (!dyn) return;
        const at = pos(inst.id, slot);
        svgEl('line', { x1: at.x, x2: at.x, y1: at.y + 10, y2: at.y + shift - 8, class: 'performance-guide' }, layer);
        drawHead(layer, inst, at.x, at.y + shift, 'performance-ghost');
      });
    }
    for (const e of missed) {
      const at = pos(e.inst, e.slot - model.firstSlot);
      const g = svgEl('g', { class: 'performance-missed', 'data-expected-id': e.id }, layer);
      svgEl('circle', { cx: at.x, cy: at.y + shift, r: 10 }, g);
      svgEl('title', {}, g, `${INST[e.inst].label}: ${words('propuštena nota', 'missed note')}`);
    }
    const lanes = [-Infinity, -Infinity, -Infinity, -Infinity];
    for (const h of [...hits].sort((a, b) => a.localSlot - b.localSlot)) {
      const inst = INST[h.inst], x = actualX(h), y = y0 + inst.pos * half;
      const group = svgEl('g', { class: 'performance-hit', 'data-time-ms': h.timeMs, 'data-adjusted-time-ms': h.adjustedTimeMs, 'data-slot': h.localSlot, 'data-inst': h.inst, tabindex: 0 }, layer);
      const label = h.err == null ? words(h.kind === 'extra' ? 'višak' : 'slobodno', h.kind === 'extra' ? 'extra' : 'free') : signed(h.err);
      svgEl('title', {}, group, `${inst.label}: ${(h.timeMs / 1000).toFixed(3)} s; ${label}`);
      group.setAttribute('aria-label', `${inst.label}, ${(h.timeMs / 1000).toFixed(3)} s, ${label}`);
      drawHead(group, inst, x, y, 'performance-actual');
      svgEl('line', { x1: x + 5, x2: x + 5, y1: y, y2: y - 25, class: 'performance-stem' }, group);
      if (inst.badge) svgEl('text', { x, y: y - 29, class: 'performance-badge' }, group, inst.badge);
      if (h.expected) {
        const reference = pos(h.expected.inst, h.expected.slot - model.firstSlot);
        svgEl('line', { x1: reference.x, x2: x, y1: y + 12, y2: y + 12, class: 'performance-offset' }, group);
      }
      const lane = lanes.findIndex(end => end < x - 22), chosen = lane < 0 ? lanes.indexOf(Math.min(...lanes)) : lane;
      lanes[chosen] = x + 25;
      const labelY = y0 + 94 + chosen * 18;
      svgEl('line', { x1: x, x2: x, y1: y + 15, y2: labelY - 11, class: 'performance-label-guide' }, group);
      svgEl('text', { x, y: labelY, class: 'performance-delta' }, group, label);
    }
    const vb = svg.viewBox.baseVal, minX = Math.min(0, ...hits.map(h => actualX(h) - 32)), maxX = Math.max(vb.width, ...hits.map(h => actualX(h) + 32));
    const height = y0 + 165 - vb.y;
    svg.setAttribute('viewBox', `${minX} ${vb.y} ${maxX - minX} ${height}`);
    svg.setAttribute('width', width); svg.setAttribute('height', height * width / (maxX - minX));
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', words(`Prolaz ${model.loop + 1}, takt ${model.bar}: zadate note i stvarni udarci`, `Pass ${model.loop + 1}, bar ${model.bar}: expected notes and actual hits`));
    find('.performance-summary').textContent = words(`${hits.length} udaraca · ${missed.length} propuštenih nota · jedan takt po prikazu`, `${hits.length} hits · ${missed.length} missed notes · one bar at a time`);
    find('.performance-calibration').textContent = words(`Položaj crvenih nota i odstupanje uključuju kalibraciju (${session.calib || 0} ms). Tabela čuva originalno vreme udarca.`, `Red-note positions and timing errors include calibration (${session.calib || 0} ms). The table preserves original hit times.`);
    find('tbody').innerHTML = [...hits].sort((a, b) => a.timeMs - b.timeMs).map(h => `<tr><td>${esc(INST[h.inst].label)}</td><td>${(h.timeMs / 1000).toFixed(3)} s</td><td>${h.err == null ? '—' : signed(h.err)}</td><td>${words(({ good: 'tačno', ok: 'skoro', extra: 'višak', free: 'van fokusa' })[h.kind] || h.kind, h.kind)}</td></tr>`).join('') || `<tr><td colspan="4">${words('Nema zabeleženih udaraca u ovom taktu.', 'No recorded hits in this bar.')}</td></tr>`;
    find('[data-report-prev]').disabled = barSelect.selectedIndex === 0 && passSelect.selectedIndex === 0;
    find('[data-report-next]').disabled = barSelect.selectedIndex === barSelect.options.length - 1 && passSelect.selectedIndex === passSelect.options.length - 1;
  };
  const setBars = () => { barSelect.innerHTML = barsForPass().map(b => `<option value="${b}">${b}</option>`).join(''); };
  passSelect.onchange = () => { setBars(); draw(); };
  barSelect.onchange = instrument.onchange = draw;
  for (const [key, delta] of [['prev', -1], ['next', 1]]) find(`[data-report-${key}]`).onclick = () => {
    const next = barSelect.selectedIndex + delta;
    if (next >= 0 && next < barSelect.options.length) barSelect.selectedIndex = next;
    else { passSelect.selectedIndex += delta; setBars(); if (delta < 0) barSelect.selectedIndex = barSelect.options.length - 1; }
    draw();
  };
  setBars(); draw();
}
