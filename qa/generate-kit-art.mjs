// Reproducible 2D artwork rendered exclusively from our procedural 3D scene.
// Run with the local app server: node qa/generate-kit-art.mjs
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = root + 'assets/kit/'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => ({ inputs: new Map(), outputs: new Map() }) }));
  await page.route('**/js/main.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nglobalThis.__art = kit;' }); });
  await page.goto(process.env.DRUMMER_URL || 'http://127.0.0.1:8123/');
  await page.waitForFunction(() => !!globalThis.__art);
  const art = await page.evaluate(async () => {
    const THREE = await import('/js/vendor/three.module.js'); await __art.select('3d');
    const { meshPad } = await import('/js/kit-play.js');
    const { scene, renderer, targets } = __art.three; __art.three.setVisible(false);
    const width = 1600, height = 1100, camera = new THREE.OrthographicCamera(-2.3, 2.3, 1.58125, -1.58125, .1, 30);
    camera.position.set(0, 8, 3.2); camera.lookAt(0, 1.02, .08); camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene), corners = [];
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
    const xmin = Math.min(...corners.map(p => p.x)), xmax = Math.max(...corners.map(p => p.x));
    const ymin = Math.min(...corners.map(p => p.y)), ymax = Math.max(...corners.map(p => p.y));
    const halfHeight = Math.max((ymax - ymin) / 2 + .15, ((xmax - xmin) / 2 + .15) * height / width);
    const halfWidth = halfHeight * width / height, cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
    camera.left = cx - halfWidth; camera.right = cx + halfWidth; camera.top = cy + halfHeight; camera.bottom = cy - halfHeight; camera.updateProjectionMatrix();
    renderer.setPixelRatio(1); renderer.setSize(width, height, false); renderer.setClearColor(0xffffff);
    renderer.render(scene, camera);
    const image = renderer.domElement.toDataURL('image/png'), masks = {}, pads = {};
    const project = point => { const p = point.clone().project(camera); return [+(width * (p.x + 1) / 2).toFixed(2), +(height * (1 - p.y) / 2).toFixed(2)]; };
    for (const [id, meshes] of targets) {
      const mesh = meshes[0].mesh, group = mesh.parent;
      const center = project(mesh.getWorldPosition(new THREE.Vector3()));
      // The scoring outline follows the instrument surface, projected by the
      // same orthographic camera used to draw the base image and hit masks.
      const drum = ['kick', 'snare', 'tom1', 'tom2', 'tom3'].includes(id);
      const radius = drum ? mesh.geometry.parameters.radiusTop / .33 : id === 'rim' ? .4 : id === 'bell' ? .1 : id === 'hhpedal' ? .15 : Math.max(...mesh.geometry.attributes.position.array.filter((_, i) => i % 3 === 0));
      const cy = mesh.position.y;
      const outline = Array.from({ length: 64 }, (_, n) => {
        const a = n * Math.PI * 2 / 64;
        return project(group.localToWorld(new THREE.Vector3(Math.cos(a) * radius, cy, Math.sin(a) * radius)));
      });
      pads[id] = { center, outline };
    }
    const colors = new Map();
    scene.traverse(n => { if (n.material?.color && !colors.has(n.material)) { colors.set(n.material, n.material.color.clone()); n.material.color.set(0x000000); } });
    renderer.setClearColor(0x000000);
    for (const [id, meshes] of targets) {
      for (const { mesh } of meshes) mesh.material.color.set(0xffffff);
      renderer.render(scene, camera); masks[id] = renderer.domElement.toDataURL('image/png');
      for (const { mesh } of meshes) mesh.material.color.set(0x000000);
    }
    for (const [material, color] of colors) material.color.copy(color);
    // Flat ID colors, with the same geometry and depth buffer as the drawing.
    // This lets mouse picking follow the visible part, including its shell and
    // pedal, instead of overlapping bounding boxes or projected ellipses.
    const pickColors = Object.fromEntries([...targets.keys()].map((id, i) => [id, [32 + i * 16, 120, 200]]));
    const originals = new Map(), hidden = [];
    scene.traverse(node => {
      if (node.isLine) { hidden.push([node, node.visible]); node.visible = false; }
      if (!node.isMesh) return;
      originals.set(node, node.material);
      const color = pickColors[meshPad(node)] || [0, 0, 0];
      node.material = node.material.clone(); node.material.color.setRGB(...color.map(v => v / 255), THREE.SRGBColorSpace);
    });
    renderer.render(scene, camera); const pickImage = renderer.domElement.toDataURL('image/png');
    for (const [node, material] of originals) { node.material.dispose(); node.material = material; }
    for (const [node, visible] of hidden) node.visible = visible;
    return { width, height, image, masks, pads, pickColors, pickImage };
  });
  const png = url => Buffer.from(url.split(',')[1], 'base64');
  await writeFile(out + 'drummer-2d.png', png(art.image));
  for (const [id, url] of Object.entries(art.masks)) await writeFile(out + `mask-${id}.png`, png(url));
  await writeFile(out + 'pick-map.png', png(art.pickImage));
  const sourceSha256 = createHash('sha256').update((await Promise.all(['js/kit-3d.js', 'js/kit-config.js'].map(path => readFile(root + path, 'utf8')))).map(source => source.replace(/\r\n/g, '\n')).join('\n')).digest('hex');
  await writeFile(root + 'js/kit-art-data.js', '// Generated by qa/generate-kit-art.mjs from js/kit-3d.js. No external artwork.\nexport const KIT_ART = ' + JSON.stringify({ width: art.width, height: art.height, sourceSha256, pads: art.pads, pickColors: art.pickColors }) + ';\n');
  console.log(`Rendered original 2D artwork and ${Object.keys(art.masks).length} occluded hit masks (${art.width}×${art.height}).`);
} finally { await browser.close(); }
