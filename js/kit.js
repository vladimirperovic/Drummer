// Crtež bubnja odozgo. Pad zasvijetli bojom instrumenta kad dođe nota, krug se skuplja prema padu
// pred notu, a tvoj udarac se vidi kao obruč: zeleno tačno, narandžasto skoro, crveno promašaj.

import { INSTRUMENTS, INST } from './patterns.js';

const NS = 'http://www.w3.org/2000/svg';
const KEY_LABEL = code => code.replace('Key', '');

const PADS = {
  crash: { cx: 205, cy: 98, r: 74, kind: 'cym', label: 'Crash' },
  ride: { cx: 604, cy: 110, r: 86, kind: 'cym', label: 'Ride' },
  hihat: { cx: 92, cy: 238, r: 58, kind: 'cym', label: 'Hi-hat' },
  tom1: { cx: 336, cy: 150, r: 46, kind: 'drum', label: 'Tom 1' },
  tom2: { cx: 458, cy: 150, r: 48, kind: 'drum', label: 'Tom 2' },
  snare: { cx: 240, cy: 274, r: 56, kind: 'drum', label: 'Dobos' },
  tom3: { cx: 580, cy: 294, r: 64, kind: 'drum', label: 'Floor tom' },
  kick: { cx: 400, cy: 312, w: 150, h: 92, kind: 'kick', label: 'Kick' },
  hhpedal: { cx: 92, cy: 368, w: 34, h: 62, kind: 'pedal', label: 'HH' },
};

const HIT_COLORS = { good: '#40c057', ok: '#fab005', extra: '#fa5252', miss: '#fa5252', free: '#f1f3f5' };

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}

function shape(pad, parent, attrs, grow = 0) {
  if (pad.r) return el('circle', { cx: pad.cx, cy: pad.cy, r: pad.r + grow, ...attrs }, parent);
  return el('rect', {
    x: pad.cx - pad.w / 2 - grow, y: pad.cy - pad.h / 2 - grow,
    width: pad.w + 2 * grow, height: pad.h + 2 * grow, rx: 14 + grow / 2, ...attrs,
  }, parent);
}

export function createKit(container) {
  container.innerHTML = '';
  const svg = el('svg', { viewBox: '0 0 720 420', class: 'kit-svg', role: 'img', 'aria-label': 'Bubanj' }, container);
  const defs = el('defs', {}, svg);
  const grad = el('radialGradient', { id: 'cymGrad', cx: '45%', cy: '40%', r: '65%' }, defs);
  el('stop', { offset: '0%', 'stop-color': '#f3d58a' }, grad);
  el('stop', { offset: '55%', 'stop-color': '#c9993f' }, grad);
  el('stop', { offset: '100%', 'stop-color': '#7d5b22' }, grad);
  const mesh = el('pattern', { id: 'mesh', width: 5, height: 5, patternUnits: 'userSpaceOnUse' }, defs);
  el('rect', { width: 5, height: 5, fill: '#3a3f47' }, mesh);
  el('circle', { cx: 2.5, cy: 2.5, r: 0.9, fill: '#4a5059' }, mesh);

  el('ellipse', { cx: 360, cy: 236, rx: 352, ry: 182, class: 'rug' }, svg);
  // pedale
  el('rect', { x: 386, y: 362, width: 28, height: 52, rx: 6, class: 'pedal' }, svg);

  const keysByTarget = {};
  for (const inst of INSTRUMENTS) (keysByTarget[inst.target] ||= []).push(...inst.keys.map(KEY_LABEL));

  const targets = {};
  const padLayer = el('g', {}, svg);
  const fxLayer = el('g', { class: 'fx' }, svg);

  for (const [id, pad] of Object.entries(PADS)) {
    const g = el('g', { class: `pad pad-${id}` }, padLayer);
    if (pad.kind === 'cym') {
      el('circle', { cx: pad.cx, cy: pad.cy, r: pad.r, fill: 'url(#cymGrad)', class: 'cym' }, g);
      for (const k of [0.82, 0.64, 0.46]) el('circle', { cx: pad.cx, cy: pad.cy, r: pad.r * k, class: 'groove' }, g);
      el('circle', { cx: pad.cx, cy: pad.cy, r: pad.r * 0.24, class: 'bellshape' }, g);
    } else if (pad.kind === 'drum') {
      el('circle', { cx: pad.cx, cy: pad.cy, r: pad.r, class: 'rimshape' }, g);
      el('circle', { cx: pad.cx, cy: pad.cy, r: pad.r - 6, fill: 'url(#mesh)' }, g);
    } else if (pad.kind === 'kick') {
      shape(pad, g, { class: 'kickshell' });
      el('circle', { cx: pad.cx, cy: pad.cy, r: 32, fill: 'url(#mesh)', class: 'kickpad' }, g);
    } else {
      shape(pad, g, { class: 'pedal' });
    }
    const labelY = pad.kind === 'pedal' ? pad.cy + 4 : pad.kind === 'cym' ? pad.cy + pad.r * 0.24 + 18 : pad.cy + 5;
    el('text', { x: pad.cx, y: labelY, class: 'padlabel' }, g).textContent = pad.label;
    const keys = keysByTarget[id === 'snare' ? 'snare' : id];
    if (keys && pad.kind !== 'pedal') el('text', { x: pad.cx, y: labelY + 16, class: 'keyhint' }, g).textContent = [...new Set(keys)].join(' ');
    if (pad.kind === 'pedal' && keys) el('text', { x: pad.cx, y: pad.cy + pad.h / 2 + 15, class: 'keyhint' }, g).textContent = keys.join(' ');

    targets[id] = {
      pad,
      overlay: shape(pad, fxLayer, { class: 'overlay', opacity: 0 }),
      ring: shape(pad, fxLayer, { class: 'approach', opacity: 0, fill: 'none' }),
      hit: shape(pad, fxLayer, { class: 'hitring', opacity: 0, fill: 'none' }, 5),
    };
  }
  // Zvono ride-a i obruč dobosa (cross-stick) su posebne mete
  const ride = PADS.ride, sn = PADS.snare;
  const bellPad = { cx: ride.cx, cy: ride.cy, r: ride.r * 0.24 };
  targets.bell = {
    pad: bellPad,
    overlay: shape(bellPad, fxLayer, { class: 'overlay', opacity: 0 }),
    ring: shape(bellPad, fxLayer, { class: 'approach', opacity: 0, fill: 'none' }),
    hit: shape(bellPad, fxLayer, { class: 'hitring', opacity: 0, fill: 'none' }, 4),
  };
  const rimPad = { cx: sn.cx, cy: sn.cy, r: sn.r };
  targets.rim = {
    pad: rimPad,
    overlay: shape(rimPad, fxLayer, { class: 'overlay rimonly', opacity: 0, fill: 'none' }),
    ring: shape(rimPad, fxLayer, { class: 'approach', opacity: 0, fill: 'none' }),
    hit: shape(rimPad, fxLayer, { class: 'hitring', opacity: 0, fill: 'none' }, 5),
  };

  // Otvorenost hi-hata (CC4 sa pedale)
  el('rect', { x: 160, y: 196, width: 7, height: 84, rx: 3.5, class: 'meterbg' }, svg);
  const meter = el('rect', { x: 160, y: 280, width: 7, height: 0, rx: 3.5, class: 'meter' }, svg);
  const openLabel = el('text', { x: 92, y: 168, class: 'openlabel', opacity: 0 }, svg);
  openLabel.textContent = 'OTVORI';

  const fade = (node, from, duration = 380) =>
    node.animate([{ opacity: from }, { opacity: 0 }], { duration, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });

  let frame = {};
  return {
    pulse(instId) {
      const inst = INST[instId], t = targets[inst.target];
      if (!t) return;
      if (t.overlay.classList.contains('rimonly')) t.overlay.setAttribute('stroke', inst.color);
      else t.overlay.setAttribute('fill', inst.color);
      fade(t.overlay, 0.85);
      if (instId === 'hho') fade(openLabel, 1, 600);
    },
    approach(instId, p) {
      const inst = INST[instId];
      const cur = frame[inst.target];
      if (!cur || p > cur.p) frame[inst.target] = { p, color: inst.color };
    },
    commit() {
      for (const [id, t] of Object.entries(targets)) {
        const f = frame[id];
        if (!f) { t.ring.setAttribute('opacity', 0); continue; }
        const grow = (1 - f.p) * (t.pad.r ? t.pad.r * 0.6 : 34);
        if (t.pad.r) t.ring.setAttribute('r', t.pad.r + grow);
        else {
          const { pad } = t;
          t.ring.setAttribute('x', pad.cx - pad.w / 2 - grow);
          t.ring.setAttribute('y', pad.cy - pad.h / 2 - grow);
          t.ring.setAttribute('width', pad.w + 2 * grow);
          t.ring.setAttribute('height', pad.h + 2 * grow);
        }
        t.ring.setAttribute('stroke', f.color);
        t.ring.setAttribute('opacity', (0.15 + 0.75 * f.p).toFixed(2));
      }
      frame = {};
    },
    hit(instId, kind) {
      const t = targets[INST[instId].target];
      if (!t) return;
      t.hit.setAttribute('stroke', HIT_COLORS[kind] || HIT_COLORS.free);
      fade(t.hit, kind === 'miss' ? 0.5 : 1, kind === 'miss' ? 300 : 420);
    },
    pedal(v) {
      const h = (v / 127) * 84;
      meter.setAttribute('y', 280 - h);
      meter.setAttribute('height', h);
    },
  };
}
