// Crtež bubnja linijama (crno na bijelom). Pad potamni kad dođe nota, krug se skuplja prema padu
// pred notu, a tvoj udarac se vidi kao obruč: zeleno tačno, sivo skoro, crveno promašaj ili višak.

import { INSTRUMENTS, INST } from './patterns.js';

const NS = 'http://www.w3.org/2000/svg';
const VIEWBOX = '100 150 1030 680';

// Raspored kao na TD-17KVX gledano sa stolice: hi-hat lijevo, crash i ride gore, tomovi na kiku.
const PADS = {
  kick: { kind: 'kick', x: 487, y: 197, w: 353, h: 343, cx: 671, cy: 633, r: 78, label: [663, 226] },
  tom1: { kind: 'drum', cx: 540, cy: 447, r: 92, lugs: 6 },
  tom2: { kind: 'drum', cx: 782, cy: 447, r: 102, lugs: 6 },
  snare: { kind: 'drum', cx: 440, cy: 650, r: 145, lugs: 8 },
  tom3: { kind: 'drum', cx: 928, cy: 618, r: 165, lugs: 8 },
  hhpedal: { kind: 'pedal', pts: [[213, 642], [281, 652], [291, 764], [257, 770]], cx: 260, cy: 706, r: 64, label: [262, 796] },
  hihat: { kind: 'cym', cx: 236, cy: 535, r: 110 },
  crash: { kind: 'cym', cx: 360, cy: 340, r: 136 },
  ride: { kind: 'cym', cx: 922, cy: 296, r: 122 },
};
const KICK_PEDAL = [[636, 560], [706, 560], [690, 706], [652, 706]];
const LABELS = { kick: 'Kick', tom1: 'Tom 1', tom2: 'Tom 2', snare: 'Dobos', tom3: 'Floor tom', hhpedal: 'HH nogom', hihat: 'Hi-hat', crash: 'Crash', ride: 'Ride' };
const HIT_COLORS = { good: '#1e8e3e', ok: '#9a9a9a', extra: '#d93025', miss: '#d93025', free: '#111' };

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const polyPoints = pts => pts.map(p => p.join(',')).join(' ');

function drawPedal(pts, parent) {
  el('polygon', { points: polyPoints(pts), class: 'line thick' }, parent);
  const [tl, tr, br, bl] = pts;
  for (let t = 0.14; t < 0.95; t += 0.1) {
    const [x1, y1] = lerp(tl, bl, t), [x2, y2] = lerp(tr, br, t);
    el('line', { x1, y1, x2, y2, class: 'rung' }, parent);
  }
}

function drawDrum(p, parent) {
  for (let i = 0; i < p.lugs; i++) {
    const a = (i / p.lugs) * 360 + 180 / p.lugs;
    el('rect', { x: p.cx - 13, y: p.cy - p.r - 10, width: 26, height: 18, rx: 2, transform: `rotate(${a} ${p.cx} ${p.cy})`, class: 'ink' }, parent);
  }
  el('circle', { cx: p.cx, cy: p.cy, r: p.r, class: 'line shell' }, parent);
  el('circle', { cx: p.cx, cy: p.cy, r: p.r - 17, class: 'line hair' }, parent);
  el('circle', { cx: p.cx, cy: p.cy, r: p.r * 0.33, class: 'ink' }, parent);
}

function drawCymbal(p, parent) {
  el('circle', { cx: p.cx, cy: p.cy, r: p.r, class: 'line cymbal' }, parent);
  for (let k = 1; k <= 12; k++) {
    el('circle', { cx: p.cx, cy: p.cy, r: p.r * (1 - k * 0.07), class: 'ring', 'stroke-width': (2.3 - k * 0.14).toFixed(2) }, parent);
  }
  el('circle', { cx: p.cx, cy: p.cy, r: 6.5, class: 'ink' }, parent);
}

function drawKick(p, parent) {
  el('rect', { x: p.x + 12, y: p.y + 30, width: p.w - 24, height: p.h - 30, rx: 8, class: 'line body' }, parent);
  el('rect', { x: p.x, y: p.y, width: p.w, height: 46, rx: 12, class: 'line thick' }, parent);
  for (const x of [p.x + 88, p.x + p.w / 2, p.x + p.w - 88]) el('line', { x1: x, x2: x, y1: p.y + 46, y2: p.y + 68, class: 'tick' }, parent);
}

export function createKit(container) {
  container.innerHTML = '';
  const svg = el('svg', { viewBox: VIEWBOX, class: 'kit-svg', role: 'img', 'aria-label': 'Bubanj', preserveAspectRatio: 'xMidYMid meet' }, container);
  const art = el('g', {}, svg);
  const fx = el('g', { class: 'fx' }, svg);
  const labels = el('g', { class: 'labels' }, svg);

  // Odozada prema naprijed: kik, pedale, bubnjevi, pa činele preko svega
  drawKick(PADS.kick, art);
  drawPedal(KICK_PEDAL, art);
  for (const id of ['tom1', 'tom2', 'snare', 'tom3']) drawDrum(PADS[id], art);
  drawPedal(PADS.hhpedal.pts, art);
  for (const id of ['hihat', 'crash', 'ride']) drawCymbal(PADS[id], art);

  const keysByTarget = {};
  for (const inst of INSTRUMENTS) (keysByTarget[inst.target] ||= []).push(...inst.keys.map(k => k.replace('Key', '')));

  for (const [id, p] of Object.entries(PADS)) {
    const [lx, ly] = p.label || [p.cx, p.cy + p.r * 0.62];
    el('text', { x: lx, y: ly, class: 'padlabel' }, labels).textContent = LABELS[id];
    const keys = keysByTarget[id];
    if (keys) el('text', { x: lx, y: ly + 19, class: 'keyhint' }, labels).textContent = [...new Set(keys)].join(' ');
  }

  // Mete za osvjetljavanje
  const targets = {};
  const circleTarget = (cx, cy, r, overlay) => ({
    cx, cy, r,
    overlay: overlay || el('circle', { cx, cy, r, class: 'overlay', opacity: 0 }, fx),
    ring: el('circle', { cx, cy, r, class: 'approach', opacity: 0 }, fx),
    hit: el('circle', { cx, cy, r: r + 9, class: 'hitring', opacity: 0 }, fx),
  });
  for (const id of ['tom1', 'tom2', 'snare', 'tom3', 'hihat', 'crash', 'ride']) {
    const p = PADS[id];
    targets[id] = circleTarget(p.cx, p.cy, p.r);
  }
  const ride = PADS.ride, sn = PADS.snare, hp = PADS.hhpedal, k = PADS.kick;
  targets.bell = circleTarget(ride.cx, ride.cy, ride.r * 0.26);
  targets.rim = circleTarget(sn.cx, sn.cy, sn.r, el('circle', { cx: sn.cx, cy: sn.cy, r: sn.r, class: 'overlay rimonly', opacity: 0 }, fx));
  targets.hhpedal = circleTarget(hp.cx, hp.cy, hp.r, el('polygon', { points: polyPoints(hp.pts), class: 'overlay', opacity: 0 }, fx));
  const kickOverlay = el('g', { class: 'overlay', opacity: 0 }, fx);
  el('polygon', { points: polyPoints(KICK_PEDAL) }, kickOverlay);
  el('rect', { x: k.x, y: k.y, width: k.w, height: 46, rx: 12 }, kickOverlay);
  targets.kick = circleTarget(k.cx, k.cy, k.r, kickOverlay);

  // Otvorenost hi-hata sa pedale (CC4)
  el('rect', { x: 188, y: 660, width: 7, height: 100, rx: 3.5, class: 'meterbg' }, svg);
  const meter = el('rect', { x: 188, y: 760, width: 7, height: 0, rx: 3.5, class: 'ink' }, svg);
  const openLabel = el('text', { x: PADS.hihat.cx, y: PADS.hihat.cy + 6, class: 'openlabel', opacity: 0 }, svg);
  openLabel.textContent = 'OTVOREN';

  const fade = (node, from, duration = 380) =>
    node.animate([{ opacity: from }, { opacity: 0 }], { duration, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });

  let frame = {};
  return {
    pulse(instId) {
      const t = targets[INST[instId].target];
      if (!t) return;
      fade(t.overlay, 0.78);
      if (instId === 'hho') fade(openLabel, 1, 500);
    },
    approach(instId, p) {
      const target = INST[instId].target;
      if (!frame[target] || p > frame[target]) frame[target] = p;
    },
    commit() {
      for (const [id, t] of Object.entries(targets)) {
        const p = frame[id];
        if (p == null) { t.ring.setAttribute('opacity', 0); continue; }
        t.ring.setAttribute('r', t.r * (1 + 0.55 * (1 - p)));
        t.ring.setAttribute('opacity', (0.12 + 0.8 * p).toFixed(2));
      }
      frame = {};
    },
    hit(instId, kind) {
      const t = targets[INST[instId].target];
      if (!t) return;
      t.hit.setAttribute('stroke', HIT_COLORS[kind] || HIT_COLORS.free);
      fade(t.hit, kind === 'miss' ? 0.6 : 1, kind === 'miss' ? 300 : 420);
    },
    pedal(v) {
      const h = (v / 127) * 100;
      meter.setAttribute('y', 760 - h);
      meter.setAttribute('height', h);
    },
  };
}
