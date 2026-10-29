// Original procedural drum kit. Opaque white faces hide rear edges; black
// silhouettes and rim lines give a hidden-line drawing, without a wire mesh.
import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { INST } from './patterns.js';
import { kitLayout, normalizeKit } from './kit-config.js';
import { bindKitDrag } from './kit-drag.js';
import { bindKitPlay, meshPad } from './kit-play.js';

export function createKit3D(container, onFailure = () => {}, configuration, dragCallbacks) {
  const config = normalizeKit(configuration), layout = kitLayout(config);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0xffffff);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D bubanj; klikni deo za zvuk, prevuci pozadinu za rotaciju, točkić za zum');
  container.appendChild(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(39, 1, .1, 60);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = .12; controls.enablePan = false;
  controls.minDistance = 3.5; controls.maxDistance = 11;
  controls.minPolarAngle = .12; controls.maxPolarAngle = Math.PI / 2 - .025;
  const ink = new THREE.MeshBasicMaterial({ color: 0x191919, side: THREE.BackSide });
  const line = new THREE.LineBasicMaterial({ color: 0x242424 });
  const targets = new Map(), flashes = new Map();
  const partGroups = new Map();
  // Keep the head, shell, stand and pedal in one movable assembly.
  function appendPart(part, build) {
    const previous = new Set(scene.children); build();
    const children = scene.children.filter(node => !previous.has(node));
    let group = partGroups.get(part.id);
    if (!group) { group = new THREE.Group(); group.userData.part = part.id; group.position.set(part.x, 0, part.z); partGroups.set(part.id, group); scene.add(group); }
    for (const child of children) { child.position.x -= part.x; child.position.z -= part.z; group.add(child); }
  }
  let disposed = false, visible = false, intersecting = false, framed = false, frameId = 0;
  function material(color = 0xffffff) { return new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }); }
  function shape(geometry, parent, color = 0xffffff, outline = true) {
    const mesh = new THREE.Mesh(geometry, material(color)); parent.add(mesh);
    if (outline) {
      const hull = new THREE.Mesh(geometry, ink); hull.scale.setScalar(1.004); mesh.add(hull);
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 24), line));
    }
    return mesh;
  }
  function flashTarget(mesh, id) {
    if (!targets.has(id)) targets.set(id, []);
    targets.get(id).push({ mesh, base: mesh.material.color.clone() });
    mesh.userData.pad = id; return mesh;
  }
  function rod(parent, from, to, radius = .012) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
    const mesh = shape(new THREE.CylinderGeometry(radius, radius, direction.length(), 16), parent, 0x343434, false);
    mesh.position.copy(a.add(b).multiplyScalar(.5)); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return mesh;
  }
  function ring(parent, radius, y, tube = .008) {
    const rim = shape(new THREE.TorusGeometry(radius, tube, 6, 72), parent, 0xffffff, false);
    rim.rotation.x = Math.PI / 2; rim.position.y = y;
    // Thin torus rings are black outlines rather than broad black surfaces.
    rim.material.color.set(0x282828); return rim;
  }
  function collar(parent, x, y, z, radius = .027, height = .055) {
    const joint = shape(new THREE.CylinderGeometry(radius, radius, height, 16), parent);
    joint.position.set(x, y, z); return joint;
  }
  function wing(parent, x, y, z) {
    rod(parent, [x - .038, y, z], [x + .038, y, z], .005);
    collar(parent, x, y, z, .013, .025);
  }
  function drum(id, x, y, z, radius, depth, tilt = 0) {
    const group = new THREE.Group(); group.position.set(x, y, z); group.rotation.x = tilt; scene.add(group);
    shape(new THREE.CylinderGeometry(radius, radius, depth, 72), group);
    const head = shape(new THREE.CylinderGeometry(radius * .94, radius * .94, .012, 72), group, 0xffffff, false);
    head.position.y = depth / 2 + .012;
    const spot = shape(new THREE.CylinderGeometry(radius * .33, radius * .33, .005, 64), group, 0x161616, false);
    spot.position.y = depth / 2 + .022; flashTarget(spot, id);
    const top = ring(group, radius, depth / 2 + .016); ring(group, radius, -depth / 2);
    ring(group, radius * 1.012, depth / 2 - .025, .004); ring(group, radius * 1.012, -depth / 2 + .025, .004);
    if (id === 'snare' || id === 'snare2') flashTarget(top, id === 'snare' ? 'rim' : 'rim2');
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, px = Math.cos(a) * (radius + .018), pz = Math.sin(a) * (radius + .018);
      const lug = shape(new THREE.BoxGeometry(.043, depth * .25, .035), group);
      lug.position.set(px, -.08 * depth, pz); lug.rotation.y = Math.PI / 2 - a;
      rod(group, [px, -.22 * depth, pz], [px, depth / 2 + .022, pz], .006);
      collar(group, px, depth / 2 + .024, pz, .015, .018);
      if (id.startsWith('kick') || id.startsWith('snare')) rod(group, [px, -.2 * depth, pz], [px, -depth / 2 - .01, pz], .006);
    }
    return group;
  }
  function stand(x, z, height) {
    rod(scene, [x, .08, z], [x, .72, z], .014);
    rod(scene, [x, .72, z], [x, height, z], .009);
    collar(scene, x, .4, z); collar(scene, x, .74, z, .022, .045); wing(scene, x + .035, .74, z);
    for (let i = 0; i < 3; i++) {
      const a = i * 2 * Math.PI / 3;
      const ex = x + .35 * Math.cos(a), ez = z + .35 * Math.sin(a);
      rod(scene, [x, .4, z], [ex, .035, ez], .011);
      rod(scene, [x, .18, z], [x + .22 * Math.cos(a), .17, z + .22 * Math.sin(a)], .005);
      const foot = shape(new THREE.SphereGeometry(.023, 10, 8), scene, 0x333333, false); foot.position.set(ex, .03, ez); foot.scale.set(1.5, .7, 1.2);
    }
  }
  for (const p of layout.filter(p => p.kind !== 'cymbal')) {
    appendPart(p, () => {
    const { id, x, y, z, radius, depth, tilt, kind } = p;
    drum(id, x, y, z, radius, depth, tilt);
    if (kind === 'kick') {
      rod(scene, [x - .48, .4, z - .15], [x - .7, .035, z + .35], .02);
      rod(scene, [x + .48, .4, z - .15], [x + .7, .035, z + .35], .02);
    } else if (kind === 'tom') {
      rod(scene, [x, .55, z], [x, y - depth / 2, z], .018);
    } else if (kind === 'snare') {
      stand(x, z, y - .1);
      for (let n = 0; n < 3; n++) {
        const a = n * Math.PI * 2 / 3;
        rod(scene, [x, y - .23, z], [x + radius * .9 * Math.cos(a), y - .12, z + radius * .9 * Math.sin(a)], .008);
      }
    } else if (kind === 'floor') {
      for (let n = 0; n < 3; n++) {
        const a = n * Math.PI * 2 / 3;
        rod(scene, [x + (radius + .01) * Math.cos(a), y, z + (radius + .01) * Math.sin(a)], [x + (radius + .11) * Math.cos(a), .03, z + (radius + .11) * Math.sin(a)], .018);
        collar(scene, x + (radius + .02) * Math.cos(a), y - .18, z + (radius + .02) * Math.sin(a), .026, .07);
      }
    }
    });
  }
  let hiTop;
  function cymbal(id, x, y, z, radius, tilt) {
    stand(x, z, y + .08);
    const group = new THREE.Group(); group.position.set(x, y, z); group.rotation.z = tilt; scene.add(group);
    const points = [[0, .09], [.06, .09], [.09, .075], [.12, .035], [.16, .022], [radius * .6, .01], [radius, 0], [radius, -.008], [.16, .014], [.12, .027], [.09, .067], [.06, .082], [0, .082]].map(([a, b]) => new THREE.Vector2(a, b));
    const mesh = shape(new THREE.LatheGeometry(points.reverse(), 80), group, 0xffffff, false);
    mesh.material.side = THREE.DoubleSide;
    flashTarget(mesh, id); ring(group, radius, -.003, .007);
    ring(group, .13, .032, .0025); ring(group, .064, .091, .0025);
    const bell = shape(new THREE.SphereGeometry(.12, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), group, 0xffffff, false);
    bell.scale.y = .65; bell.position.y = .028;
    collar(group, 0, .105, 0, .022, .022); wing(group, 0, .13, 0);
    collar(group, 0, -.045, 0, .022, .06);
    if (id === 'ride') flashTarget(bell, 'bell');
    else flashTarget(bell, id);
    if (id === 'hihat') {
      hiTop = group;
      const lower = mesh.clone(); lower.material = material(); lower.position.y = -.06; lower.children.length = 0; scene.add(lower); lower.position.add(group.position);
    }
    return group;
  }
  for (const p of layout.filter(p => p.kind === 'cymbal')) appendPart(p, () => cymbal(p.id, p.x, p.y, p.z, p.radius, p.tilt));
  function pedal(id, x, z, rotation = 0) {
    const group = new THREE.Group(); group.position.set(x, .045, z); group.rotation.y = rotation; scene.add(group);
    group.userData.pad = id;
    const base = shape(new THREE.BoxGeometry(.22, .018, .46), group); base.position.y = -.014;
    const board = new THREE.Shape(); board.moveTo(-.065, -.2); board.lineTo(.065, -.2); board.lineTo(.098, .16); board.quadraticCurveTo(.098, .21, 0, .22); board.quadraticCurveTo(-.098, .21, -.098, .16); board.closePath();
    const plate = shape(new THREE.ExtrudeGeometry(board, { depth: .018, bevelEnabled: false, curveSegments: 8 }), group); plate.rotation.x = Math.PI / 2; plate.position.y = .027;
    flashTarget(plate, id);
    for (let n = 0; n < 5; n++) rod(group, [-.075, .018, -.14 + .06 * n], [.075, .018, -.14 + .06 * n], .0035);
    rod(group, [-.095, .035, .19], [.095, .035, .19], .012);
    rod(group, [-.105, 0, -.18], [-.105, .19, -.18], .009);
    rod(group, [.105, 0, -.18], [.105, .19, -.18], .009);
    rod(group, [-.105, .19, -.18], [.105, .19, -.18], .012);
    rod(group, [0, .02, -.16], [0, .18, -.18], .006);
    const coil = Array.from({ length: 65 }, (_, i) => new THREE.Vector3(.13 + .012 * Math.cos(i * Math.PI / 4), .025 + i * .0021, -.18 + .012 * Math.sin(i * Math.PI / 4)));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(coil), line));
    return group;
  }
  for (const p of layout.filter(p => p.kind === 'kick')) {
    appendPart(p, () => {
    pedal(p.id, p.x, p.z + .84);
    rod(scene, [p.x, .08, p.z + .71], [p.x, .52, p.z + .44], .012);
    const beater = shape(new THREE.SphereGeometry(.055, 16, 12), scene); beater.position.set(p.x, .52, p.z + .44);
    });
  }
  const hi = layout.find(p => p.id === 'hihat');
  appendPart(hi, () => pedal('hhpedal', hi.x, hi.z + .36, config.leftHanded ? .2 : -.2));

  const raycaster = new THREE.Raycaster();
  function pointerRay(e) {
    const rect = canvas.getBoundingClientRect();
    camera.updateMatrixWorld(); scene.updateMatrixWorld(true);
    raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2), camera);
    return raycaster.ray;
  }
  const drag = bindKitDrag(canvas, {
    pick(e) {
      pointerRay(e);
      const hit = raycaster.intersectObjects([...partGroups.values()], true).find(hit => hit.object.isMesh);
      if (!hit) return null;
      let owner = hit.object; while (owner && !owner.userData.part) owner = owner.parent;
      if (!owner) return null;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y);
      return { id: owner.userData.part, plane, point: hit.point.clone() };
    },
    delta(e, start) { const p = pointerRay(e).intersectPlane(start.plane, new THREE.Vector3()); return p ? { x: p.x - start.point.x, z: p.z - start.point.z } : null; },
  }, dragCallbacks);
  const playing = bindKitPlay(canvas, e => {
    pointerRay(e);
    const hit = raycaster.intersectObjects([...partGroups.values()], true).find(hit => hit.object.isMesh);
    return hit ? meshPad(hit.object) : null;
  }, dragCallbacks);
  function updateLayout(value, fit = false) {
    for (const p of kitLayout(value)) partGroups.get(p.id)?.position.set(p.x, 0, p.z);
    scene.updateMatrixWorld(true);
    if (fit) {
      camera.updateMatrixWorld(); const box = new THREE.Box3().setFromObject(scene);
      const outside = [box.min.x, box.max.x].some(x => [box.min.y, box.max.y].some(y => [box.min.z, box.max.z].some(z => {
        const p = new THREE.Vector3(x, y, z).project(camera); return Math.abs(p.x) > .98 || Math.abs(p.y) > .98 || p.z > 1;
      })));
      if (outside) frameKit(camera.position.clone().sub(controls.target).normalize());
    }
    invalidate();
  }
  function setEditing(value) {
    drag.setEditing(value); controls.enabled = !value;
    if (value) { controls.enableDamping = false; controls.update(); controls.enableDamping = true; }
    canvas.setAttribute('aria-label', value ? '3D bubanj; prevuci deo za pomeranje' : '3D bubanj; klikni deo za zvuk, prevuci pozadinu za rotaciju, točkić za zum');
    invalidate();
  }

  function reset() {
    frameKit(new THREE.Vector3(3.05, 1.75, 4.2).normalize());
  }
  function frameKit(direction) {
    controls.enableDamping = false; controls.update();
    resize();
    const bounds = new THREE.Box3().setFromObject(scene), center = bounds.getCenter(new THREE.Vector3());
    const vertical = THREE.MathUtils.degToRad(camera.fov), horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize(), up = new THREE.Vector3().crossVectors(direction, right);
    let distance = 0;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const offset = new THREE.Vector3(x, y, z).sub(center);
      distance = Math.max(distance, offset.dot(direction) + Math.max(Math.abs(offset.dot(right)) / Math.tan(horizontal / 2), Math.abs(offset.dot(up)) / Math.tan(vertical / 2)));
    }
    distance *= 1.08;
    controls.maxDistance = Math.max(11, distance * 1.8);
    controls.target.copy(center);
    camera.position.copy(center).add(direction.multiplyScalar(distance));
    controls.update(); controls.enableDamping = true;
  }
  function rotate(amount) {
    const offset = camera.position.clone().sub(controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), amount); camera.position.copy(controls.target).add(offset); controls.update();
  }
  function zoom(factor) {
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
    camera.position.copy(controls.target).add(offset); controls.update();
  }
  const onKey = e => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Home') reset();
      else if (['ArrowLeft', 'ArrowRight'].includes(e.key)) rotate(e.key === 'ArrowLeft' ? -.18 : .18);
      else zoom(['ArrowUp', '+', '='].includes(e.key) ? .9 : 1.1);
    }
  };
  canvas.addEventListener('keydown', onKey);
  function resize() {
    const width = container.clientWidth, height = container.clientHeight;
    if (!width || !height || disposed) return;
    camera.aspect = width / height;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(39) / 2) * Math.max(1, 1.25 / camera.aspect)));
    camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
    invalidate();
  }
  function active() { return !disposed && visible && intersecting && !document.hidden; }
  function invalidate() { if (active() && !frameId) frameId = requestAnimationFrame(render); }
  function render() {
    frameId = 0;
    if (!active()) return;
    const now = performance.now();
    for (const [id, flash] of flashes) {
      const strength = Math.max(0, 1 - (now - flash.time) / 380);
      for (const target of targets.get(id) || []) target.mesh.material.color.copy(target.base).lerp(flash.color, strength);
      if (!strength) flashes.delete(id);
    }
    controls.update(); renderer.render(scene, camera);
    if (flashes.size) invalidate();
  }
  // OrbitControls emits changes throughout damping; flashes request frames
  // until their last color is restored. A settled kit consumes no frames.
  controls.addEventListener('change', invalidate);
  function syncLoop() {
    if (active()) invalidate();
    else if (frameId) { cancelAnimationFrame(frameId); frameId = 0; }
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  const intersection = new IntersectionObserver(entries => { intersecting = entries[0].isIntersecting; syncLoop(); }); intersection.observe(container);
  document.addEventListener('visibilitychange', syncLoop);
  const lost = e => { e.preventDefault(); if (!disposed) onFailure(); };
  canvas.addEventListener('webglcontextlost', lost);
  function pulse(id) {
    const instrument = INST[id]; if (!instrument || !visible) return;
    flashes.set(instrument.target, { time: performance.now(), color: new THREE.Color(instrument.color) });
    invalidate();
  }
  function dispose() {
    if (disposed) return; playing.dispose(); drag.dispose(); disposed = true;
    if (frameId) cancelAnimationFrame(frameId); frameId = 0;
    controls.removeEventListener('change', invalidate); controls.dispose(); observer.disconnect(); intersection.disconnect();
    document.removeEventListener('visibilitychange', syncLoop); canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('keydown', onKey);
    const geometries = new Set(), materials = new Set();
    scene.traverse(node => { if (node.geometry) geometries.add(node.geometry); if (node.material) materials.add(node.material); });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); renderer.dispose(); canvas.remove();
  }
  reset(); resize();
  return { pulse, hit(id, kind) { if (kind !== 'miss') pulse(id); }, pedal(v) { hiTop.position.y = 1.4 + .065 * (1 - THREE.MathUtils.clamp(v, 0, 127) / 127); invalidate(); },
    setVisible(value) { if (!value) drag.cancel(); visible = value; resize(); if (visible && !framed) { reset(); framed = true; } syncLoop(); }, reset, rotate, zoom, dispose, updateLayout, setEditing, cancelDrag: drag.cancel,
    // Kept on the instance for integration checks; nothing is exposed globally.
    camera, targets, renderer, scene, partGroups,
  };
}
