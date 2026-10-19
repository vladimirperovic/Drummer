// Original vector drawing, built from the same part positions as the 3D scene.
// Rendering and hit feedback work offline and without WebGL.
import { INST } from './patterns.js';
import { kitLayout, kitInstruments, normalizeKit } from './kit-config.js';
import { bindKitDrag } from './kit-drag.js';
import { bindKitPlay } from './kit-play.js';

export function createConfiguredKit(container, configuration, dragCallbacks) {
  const config = normalizeKit(configuration), parts = kitLayout(config), instruments = kitInstruments(config);
  container.replaceChildren();
  const make = (tag, attrs, parent) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent?.appendChild(e); return e;
  };
  const project = (x, y, z) => [x * 180, (z * .91 - y * .4) * 180];
  const bounds = values => {
    const extent = values.flatMap(p => [[(p.x - p.radius - .25) * 180, project(p.x, p.y, p.z)[1] - p.radius * 180 - 45], [(p.x + p.radius + .25) * 180, project(p.x, 0, p.z + .5)[1] + p.radius * 180 + 40]]);
    const x = Math.min(...extent.map(p => p[0])) - 30, y = Math.min(...extent.map(p => p[1])) - 30;
    return [x, y, Math.max(...extent.map(p => p[0])) - x + 30, Math.max(...extent.map(p => p[1])) - y + 30];
  };
  let [x0, y0, width, height] = bounds(parts), pedalValue = 0;
  const svg = make('svg', { viewBox: `${x0} ${y0} ${width} ${height}`, class: 'kit-svg configured-kit', role: 'img', 'aria-label': 'Moj bubanj', 'data-configured-kit': '' }, container);
  make('title', {}, svg).textContent = 'Raspored bubnja';
  const targets = new Map(), labels = [];
  const groups = new Map(), bodies = new Map();
  const partGroup = id => {
    const group = make('g', { 'data-move-part': id }, svg);
    (groups.get(id) || (groups.set(id, []), groups.get(id))).push(group); return group;
  };
  const target = (node, id, rim = false) => {
    node.setAttribute('data-pad', id); node.setAttribute('opacity', '0'); node.setAttribute('class', 'config-hit');
    (targets.get(id) || (targets.set(id, []), targets.get(id))).push({ node, rim });
  };
  const line = (parent, a, b, width = 2) => make('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#333', 'stroke-width': width }, parent);
  for (const p of parts) {
    const support = partGroup(p.id);
    const [x, y] = project(p.x, p.y, p.z), foot = project(p.x, 0, p.z);
    if (p.kind === 'cymbal' || p.kind === 'snare') {
      line(support, [x, y], foot, 2.3);
      for (let n = 0; n < 3; n++) { const a = n * Math.PI * 2 / 3; line(support, project(p.x, .3, p.z), project(p.x + .3 * Math.cos(a), 0, p.z + .3 * Math.sin(a))); }
    } else if (p.kind === 'floor') {
      for (let n = 0; n < 3; n++) { const a = n * Math.PI * 2 / 3; line(support, project(p.x + p.radius * Math.cos(a), p.y, p.z + p.radius * Math.sin(a)), project(p.x + (p.radius + .1) * Math.cos(a), 0, p.z + (p.radius + .1) * Math.sin(a)), 3); }
    } else if (p.kind === 'tom') line(support, [x, y], project(p.x, .55, p.z), 3);
  }
  const drawPedal = (id, x, z, angle = 0) => {
    const [px, py] = project(x, 0, z), g = make('g', { transform: `translate(${px} ${py}) rotate(${angle})` }, partGroup(id === 'hhpedal' ? 'hihat' : id));
    g.setAttribute('data-play-pad', id);
    const d = 'M-12 -25 L12 -25 L16 25 Q0 32 -16 25 Z';
    make('path', { d, fill: '#fff', stroke: '#222', 'stroke-width': 2 }, g);
    for (let n = -15; n < 20; n += 8) line(g, [-9, n], [9, n], 1);
    target(make('path', { d, fill: '#fff' }, g), id);
  };
  for (const p of parts.filter(p => p.kind === 'kick')) drawPedal(p.id, p.x, p.z + .85);
  const hi = parts.find(p => p.id === 'hihat'); drawPedal('hhpedal', hi.x, hi.z + .48, config.leftHanded ? 12 : -12);
  for (const p of [...parts].sort((a, b) => (a.y * .91 + a.z * .4) - (b.y * .91 + b.z * .4))) {
    const [x, y] = project(p.x, p.y + (p.kind === 'kick' ? 0 : p.depth / 2), p.z + (p.kind === 'kick' ? p.depth / 2 : 0));
    const r = p.radius * 180, ry = r * (p.kind === 'kick' ? .4 : .91), depth = p.depth * 180 * (p.kind === 'kick' ? .91 : .4);
    const g = partGroup(p.id); g.setAttribute('data-part', p.id); g.setAttribute('data-play-pad', p.id); bodies.set(p.id, g);
    g.dataset.worldX = p.x; g.dataset.worldZ = p.z;
    const oval = (cy, rx = r, sy = ry, fill = '#fff', stroke = '#222') => make('ellipse', { cx: x, cy, rx, ry: sy, fill, stroke, 'stroke-width': 1.6 }, g);
    if (p.kind !== 'cymbal') {
      const backY = p.kind === 'kick' ? y - depth : y + depth;
      oval(backY);
      make('path', { d: `M${x-r} ${backY} L${x-r} ${y} A${r} ${ry} 0 0 0 ${x+r} ${y} L${x+r} ${backY} A${r} ${ry} 0 0 1 ${x-r} ${backY}`, fill: '#fff', stroke: '#222', 'stroke-width': 1.6 }, g);
      for (let n = 0; n < 5; n++) { const dx = r * Math.cos(n * Math.PI / 4); line(g, [x + dx, y], [x + dx, backY], 1); }
    }
    oval(y);
    if (p.kind === 'cymbal') {
      oval(y, r * .22, ry * .22, '#fff', '#aaa');
      oval(y - 1, 3, 2, '#222');
      target(oval(y), p.id);
      if (p.id === 'ride') { const bell = oval(y, r * .22, ry * .22); target(bell, 'bell'); bell.setAttribute('data-play-pad', 'bell'); }
    } else {
      oval(y, r * .94, ry * .94, 'none', '#999');
      oval(y, r * .33, ry * .33, '#161616', 'none');
      target(oval(y, r * .33, ry * .33), p.id);
      for (let n = 0; n < 8; n++) { const a = n * Math.PI / 4; make('circle', { cx: x + r * .97 * Math.cos(a), cy: y + ry * .97 * Math.sin(a), r: 2.3, fill: '#fff', stroke: '#555' }, g); }
      if (p.kind === 'snare') {
        const rim = oval(y, r, ry, 'none'), id = p.id === 'snare' ? 'rim' : 'rim2';
        target(rim, id, true); rim.setAttribute('data-play-pad', id);
        rim.setAttribute('pointer-events', 'stroke'); rim.setAttribute('stroke-width', '5');
      }
    }
    const inst = instruments.find(i => i.target === p.id), label = inst?.label || 'Hi-hat';
    labels.push({ id: p.id, x, y: y + ry * .62, label });
  }
  const labelGroups = labels.map(p => { const g = partGroup(p.id); make('text', { x: p.x, y: p.y, class: 'config-pad-label' }, g).textContent = p.label; return g; });
  const meter = make('rect', { x: x0 + 16, y: y0 + height - 40, width: 8, height: 0, fill: '#111', 'data-pedal-meter': '' }, svg);
  function flash(id, kind = 'free') {
    const inst = INST[id]; if (!inst) return;
    for (const { node, rim } of targets.get(inst.target) || []) {
      node.getAnimations().forEach(a => a.cancel());
      node.setAttribute('fill', rim ? 'none' : inst.color); node.setAttribute('stroke', rim ? inst.color : 'none'); node.setAttribute('stroke-width', '5');
      if (kind === 'miss') { node.setAttribute('fill', 'none'); node.setAttribute('stroke', '#d93025'); }
      node.animate([{ opacity: .88 }, { opacity: 0 }], { duration: 380, easing: 'ease-out' });
    }
  }
  const drag = bindKitDrag(svg, {
    pick(e) {
      const id = e.target.closest('[data-move-part]')?.dataset.movePart, matrix = svg.getScreenCTM()?.inverse();
      if (!id || !matrix) return null;
      return { id, matrix, point: new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix) };
    },
    delta(e, start) { const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(start.matrix); return { x: (p.x - start.point.x) / 180, z: (p.y - start.point.y) / (180 * .91) }; },
  }, dragCallbacks);
  const playing = bindKitPlay(svg, e => e.target.closest('[data-play-pad]')?.dataset.playPad, dragCallbacks);
  function pedal(v) { pedalValue = v; const h = Math.max(0, Math.min(127, Number(v) || 0)) / 127 * 80; meter.setAttribute('height', h); meter.setAttribute('y', y0 + height - 40 - h); }
  function updateLayout(value, fit = false) {
    const next = kitLayout(value);
    for (const p of next) {
      const initial = parts.find(part => part.id === p.id); if (!initial) continue;
      for (const g of groups.get(p.id) || []) g.setAttribute('transform', `translate(${(p.x - initial.x) * 180} ${(p.z - initial.z) * .91 * 180})`);
      bodies.get(p.id).dataset.worldX = p.x; bodies.get(p.id).dataset.worldZ = p.z;
    }
    for (const p of [...next].sort((a, b) => (a.y * .91 + a.z * .4) - (b.y * .91 + b.z * .4))) if (bodies.has(p.id)) svg.append(bodies.get(p.id));
    svg.append(...labelGroups, meter);
    if (fit) { [x0, y0, width, height] = bounds(next); svg.setAttribute('viewBox', `${x0} ${y0} ${width} ${height}`); meter.setAttribute('x', x0 + 16); pedal(pedalValue); }
  }
  return { pulse: flash, hit: flash, pedal, updateLayout, setEditing: drag.setEditing, cancelDrag: drag.cancel, dispose() { playing.dispose(); drag.dispose(); } };
}
