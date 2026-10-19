import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base=process.env.DRUMMER_URL||'http://127.0.0.1:8123',channel=process.env.DRUMMER_BROWSER||'';
const dir=fileURLToPath(new URL(`./artifacts/layout/${channel||'chromium'}/`,import.meta.url));await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,...(channel?{channel}:{}),args:['--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader']});
const results=[],filter=process.env.DRUMMER_CASE?new RegExp(process.env.DRUMMER_CASE):null;
const bridge='\nglobalThis.__layoutQA={kit,settings,profiles,configurator,start,stop,onHit};';
async function scenario(name,fn,options={}) {
  if(filter&&!filter.test(name))return;
  const context=await browser.newContext({viewport:{width:1440,height:1100},serviceWorkers:options.offline?'allow':'block'}),p=await context.newPage(),errors=[];
  p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async()=>({inputs:new Map(),outputs:new Map()})}));
  if(options.noWebGL)await p.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...a){return t.startsWith('webgl')?null:get.call(this,t,...a);};});
  if(!options.offline)await p.route('**/js/main.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:await r.text()+bridge});});
  try {await p.goto(base);await p.locator('#kitMove').waitFor();await fn(p,context);assert.deepEqual(errors,[]);results.push({name,status:'PASS'});console.log('PASS '+name);}
  catch(e){await p.screenshot({path:dir+`failure-${results.length+1}.png`,fullPage:true}).catch(()=>{});results.push({name,status:'FAIL',error:e.stack,errors});console.log('FAIL '+name+': '+e.message);}
  finally{await context.close();}
}
async function expanded(p) {await p.locator('#kitConfigurator summary').click();await p.locator('#kitPreset').selectOption('expanded');await p.locator('#kitConfigurator summary').click();}
async function editing(p) {if(await p.locator('#kitMove').getAttribute('aria-pressed')!=='true')await p.locator('#kitMove').click();await p.locator('#kit2dHost').scrollIntoViewIfNeeded();}
async function position(p,id) {return p.locator(`[data-part="${id}"]`).evaluate(e=>({x:+e.dataset.worldX,z:+e.dataset.worldZ}));}
async function point2D(p,id,pedal=false) {
  await p.locator('#kit2dHost').scrollIntoViewIfNeeded();
  return p.evaluate(({id,pedal})=>{
    const node=pedal?document.querySelector(`[data-move-part="${id}"] [data-pad="${id==='hihat'?'hhpedal':id}"]`):document.querySelector(`[data-part="${id}"] ellipse[fill="#161616"]`)||document.querySelector(`[data-part="${id}"] ellipse`);
    const box=node.getBBox(),point=new DOMPoint(box.x+box.width/2,box.y+box.height*(pedal?.85:.5)).matrixTransform(node.getScreenCTM());
    return {x:point.x,y:point.y};
  },{id,pedal});
}
async function drag2D(p,id,dx,dy,{pedal=false,release=true}={}) {
  const start=await point2D(p,id,pedal);await p.mouse.move(start.x,start.y);await p.mouse.down();await p.mouse.move(start.x+dx,start.y+dy,{steps:10});if(release)await p.mouse.up();return start;
}
async function three(p) {await p.locator('#kit3d').click();await p.locator('#kit3dHost canvas').waitFor();await p.locator('#kit3dHost').scrollIntoViewIfNeeded();}
async function sameViews(p) {
  const r=await p.evaluate(()=>[...__layoutQA.kit.three.partGroups].map(([id,g])=>{const node=document.querySelector(`[data-part="${id}"]`);return {id,dx:g.position.x-Number(node.dataset.worldX),dz:g.position.z-Number(node.dataset.worldZ)};}));
  for(const part of r){assert.ok(Math.abs(part.dx)<1e-8,part.id+' x');assert.ok(Math.abs(part.dz)<1e-8,part.id+' z');}
}
await scenario('Layout: mouse drag in 2D persists, preserves other parts and matches 3D',async p=>{
  assert.equal(await p.locator('[data-kit-art]').count(),1);await editing(p);
  const before=await position(p,'kick'),snare=await position(p,'snare');await drag2D(p,'kick',65,35);
  const after=await position(p,'kick');assert.ok(after.x>before.x+.1);assert.ok(after.z>before.z+.1);assert.deepEqual(await position(p,'snare'),snare);
  assert.equal(await p.locator('#kitLayoutReset').isEnabled(),true);
  await three(p);await sameViews(p);await p.locator('#kit2d').click();await p.reload();
  assert.deepEqual(await position(p,'kick'),after);assert.equal(await p.locator('#kitMove').getAttribute('aria-pressed'),'false');
});
await scenario('Layout: second bass and hi-hat pedals move with their own assemblies',async p=>{
  await expanded(p);await editing(p);
  const before=await position(p,'kick2'),first=await position(p,'kick');await drag2D(p,'kick2',40,65,{pedal:true});
  assert.notDeepEqual(await position(p,'kick2'),before);assert.deepEqual(await position(p,'kick'),first);
  const hi=await position(p,'hihat');await drag2D(p,'hihat',-45,35,{pedal:true});assert.notDeepEqual(await position(p,'hihat'),hi);
  const linked=await p.locator('[data-move-part="hihat"]').evaluateAll(es=>es.map(e=>e.getAttribute('transform')));assert.equal(new Set(linked).size,1);
  await three(p);await sameViews(p);
  const parents=await p.evaluate(()=>['kick2','hhpedal'].map(id=>__layoutQA.kit.three.targets.get(id).map(({mesh})=>{let n=mesh;while(!n.userData.part)n=n.parent;return n.userData.part;})));
  assert.ok(parents[0].every(id=>id==='kick2'));assert.ok(parents[1].every(id=>id==='hihat'));
});
await scenario('Layout: real 3D picking moves a part without orbiting; 2D and hit colors stay in sync',async p=>{
  await expanded(p);await editing(p);await three(p);
  const start=await p.evaluate(async()=>{
    const T=await import('/js/vendor/three.module.js'),k=__layoutQA.kit.three;k.scene.updateMatrixWorld(true);k.camera.updateMatrixWorld();
    const center=k.targets.get('floor2')[0].mesh.getWorldPosition(new T.Vector3()).project(k.camera),r=k.renderer.domElement.getBoundingClientRect();
    return {x:r.x+(center.x+1)/2*r.width,y:r.y+(1-center.y)/2*r.height,camera:k.camera.position.toArray(),part:k.partGroups.get('floor2').position.toArray()};
  });
  await p.mouse.move(start.x,start.y);await p.mouse.down();await p.mouse.move(start.x+48,start.y+20,{steps:12});
  assert.deepEqual(await p.evaluate(()=>__layoutQA.kit.three.camera.position.toArray()),start.camera);await p.mouse.up();
  const after=await p.evaluate(()=>({camera:__layoutQA.kit.three.camera.position.toArray(),part:__layoutQA.kit.three.partGroups.get('floor2').position.toArray(),offsets:__layoutQA.settings.kitConfig.offsets}));
  assert.notDeepEqual(after.part,start.part);assert.deepEqual(Object.keys(after.offsets),['floor2']);await sameViews(p);
  await p.evaluate(async()=>{const T=await import('/js/vendor/three.module.js'),k=__layoutQA.kit.three,box=new T.Box3().setFromObject(k.scene);k.camera.updateMatrixWorld();for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new T.Vector3(x,y,z).project(k.camera);if(Math.abs(p.x)>1||Math.abs(p.y)>1)throw Error('moved kit clipped');}});
  const color=await p.evaluate(async()=>{const k=__layoutQA.kit.three;__layoutQA.onHit('floor2',95,performance.now(),'keyboard');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return k.targets.get('floor2')[0].mesh.material.color.getHexString();});assert.notEqual(color,'161616');
  await p.locator('#view-kit').screenshot({path:dir+'custom-3d.png'});await p.locator('#kit2d').click();await p.locator('#view-kit').screenshot({path:dir+'custom-2d.png'});
  const held=await position(p,'floor2');await p.locator('#kit3d').click();await p.locator('#kitMove').click();
  const canvas=await p.locator('#kit3dHost canvas').boundingBox();await p.mouse.move(canvas.x+15,canvas.y+15);await p.mouse.down();await p.mouse.move(canvas.x+115,canvas.y+25,{steps:10});await p.mouse.up();
  assert.deepEqual(await position(p,'floor2'),held);assert.notDeepEqual(await p.evaluate(()=>__layoutQA.kit.three.camera.position.toArray()),after.camera);
});
await scenario('Layout: Escape and pointer cancellation roll back previews without saving',async p=>{
  await editing(p);const before=await position(p,'snare');await drag2D(p,'snare',50,30,{release:false});assert.notDeepEqual(await position(p,'snare'),before);
  await p.keyboard.press('Escape');await p.mouse.up();assert.deepEqual(await position(p,'snare'),before);assert.equal(await p.evaluate(()=>__layoutQA.settings.kitConfig.offsets),undefined);
  await drag2D(p,'snare',50,30,{release:false});await p.locator('.configured-kit').dispatchEvent('pointercancel',{pointerId:1});await p.mouse.up();
  assert.deepEqual(await position(p,'snare'),before);await p.reload();assert.equal(await p.locator('[data-kit-art]').count(),1);
});
await scenario('Layout: releasing outside the kit saves once and bounds the position',async p=>{
  await editing(p);
  await p.evaluate(()=>{const original=Storage.prototype.setItem;window.__layoutWrites=0;Storage.prototype.setItem=function(key,value){try{if(JSON.parse(value)?.kitConfig?.offsets)window.__layoutWrites++;}catch{}return original.call(this,key,value);};});
  const start=await point2D(p,'snare'),box=await p.locator('#kit2dHost').boundingBox();
  await p.mouse.move(start.x,start.y);await p.mouse.down();await p.mouse.move(start.x+80,box.y-30,{steps:16});
  assert.equal(await p.evaluate(()=>window.__layoutWrites),0);await p.mouse.up();assert.equal(await p.evaluate(()=>window.__layoutWrites),1);
  const saved=await p.evaluate(()=>__layoutQA.settings.kitConfig.offsets);assert.ok(saved.snare);assert.ok(Math.abs(saved.snare.x)<=3&&Math.abs(saved.snare.z)<=3);
  assert.equal(await p.locator('.kit-dragging').count(),0);const pos=await position(p,'snare');await p.reload();assert.deepEqual(await position(p,'snare'),pos);
});
await scenario('Layout: named profiles and JSON export/import retain separate custom arrangements',async p=>{
  await editing(p);await drag2D(p,'snare',-40,30);const a=await position(p,'snare');
  await p.locator('#kitConfigurator summary').click();await p.locator('#kitProfileName').fill('Raspored A');await p.locator('#kitProfileSave').click();const id=await p.locator('#kitProfile').inputValue();
  await p.locator('#kitProfileNew').click();await p.locator('#kitConfigurator summary').click();await drag2D(p,'snare',55,0);
  await p.locator('#kitConfigurator summary').click();await p.locator('#kitProfileName').fill('Raspored B');await p.locator('#kitProfileSave').click();
  await p.locator('#kitProfile').selectOption(id);assert.deepEqual(await position(p,'snare'),a);
  const download=p.waitForEvent('download');await p.locator('#kitProfileExport').click();const file=await(await download).path();const data=JSON.parse(await readFile(file,'utf8'));assert.ok(data.profile.kitConfig.offsets.snare);
  await p.locator('#kitLayoutReset').click();await p.locator('#kitProfileImport').setInputFiles(file);await p.waitForFunction(()=>document.querySelectorAll('#kitProfile option').length===4);
  assert.deepEqual(await position(p,'snare'),a);await p.reload();assert.deepEqual(await position(p,'snare'),a);await editing(p);await three(p);await sameViews(p);
});
await scenario('Layout: handedness, removing/readding parts and reset preserve the chosen kit',async p=>{
  await expanded(p);await editing(p);await drag2D(p,'floor2',55,30);const right=await position(p,'floor2');
  await p.locator('#kitConfigurator summary').click();await p.locator('#kitHand').selectOption('left');const left=await position(p,'floor2');assert.equal(left.x,-right.x);assert.equal(left.z,right.z);
  await p.locator('#kit-floors').selectOption('1');assert.equal(await p.locator('[data-part=floor2]').count(),0);await p.locator('#kit-floors').selectOption('2');assert.deepEqual(await position(p,'floor2'),left);
  await p.locator('#kitConfigurator summary').click();await drag2D(p,'floor2',35,0);assert.ok((await position(p,'floor2')).x>left.x);
  await p.locator('#kitLayoutReset').click();assert.equal(await p.evaluate(()=>__layoutQA.settings.kitConfig.offsets),undefined);
  await p.locator('#kitConfigurator summary').click();assert.equal(await p.locator('#kit-kicks').inputValue(),'2');assert.equal(await p.locator('#kit-floors').inputValue(),'2');assert.equal(await p.locator('#kitHand').inputValue(),'left');
});
await scenario('Layout: failed storage rolls back visible positions and never reports a saved move',async p=>{
  await editing(p);const before=await position(p,'snare');await p.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('quota','QuotaExceededError');};});
  await drag2D(p,'snare',45,25);assert.deepEqual(await position(p,'snare'),before);assert.equal(await p.evaluate(()=>__layoutQA.settings.kitConfig.offsets),undefined);
  assert.equal(await p.locator('#storageWarning').isVisible(),true);assert.equal(await p.locator('#kitViewStatus').innerText(),'');
});
await scenario('Layout: starting playback cancels an active gesture and disables layout edits',async p=>{
  await editing(p);await drag2D(p,'snare',40,25,{release:false});await p.evaluate(()=>{__layoutQA.settings.countIn=false;return __layoutQA.start();});await p.mouse.up();
  assert.equal(await p.locator('#kitMove').isEnabled(),false);assert.equal(await p.locator('#kitMove').getAttribute('aria-pressed'),'false');assert.equal(await p.evaluate(()=>__layoutQA.settings.kitConfig.offsets),undefined);
  await p.evaluate(()=>__layoutQA.stop());assert.equal(await p.locator('#kitMove').isEnabled(),true);assert.equal(await p.locator('[data-kit-art]').count(),1);
});
await scenario('Layout: custom positions survive offline reload and first 3D opening',async(p,context)=>{
  await editing(p);await drag2D(p,'snare',-45,25);const pos=await position(p,'snare');
  await p.evaluate(async()=>navigator.serviceWorker.ready);await p.waitForFunction(()=>!!navigator.serviceWorker.controller);await context.setOffline(true);await p.reload();
  assert.deepEqual(await position(p,'snare'),pos);await three(p);assert.equal(await p.locator('#kit3d').getAttribute('aria-pressed'),'true');await p.locator('#kit2d').click();await editing(p);await drag2D(p,'snare',-25,10);assert.notDeepEqual(await position(p,'snare'),pos);
},{offline:true});
await scenario('Layout: English/mobile controls and no-WebGL fallback retain moved parts',async p=>{
  await p.locator('#languageSelect').selectOption('en');await p.setViewportSize({width:390,height:844});await editing(p);await drag2D(p,'snare',-20,20);const pos=await position(p,'snare');
  assert.equal(await p.locator('#kitMove').innerText(),'Move parts');assert.equal(await p.locator('#kitLayoutReset').innerText(),'Reset layout');assert.match(await p.locator('#kitMoveHint').innerText(),/Esc cancels/);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.locator('#kit3d').click();await p.waitForFunction(()=>document.querySelector('#kitViewStatus').textContent.includes('unavailable'));
  assert.deepEqual(await position(p,'snare'),pos);await p.locator('#view-kit').screenshot({path:dir+'phone-layout.png'});
},{noWebGL:true});
const summary={browserVersion:browser.version(),generatedAt:new Date().toISOString(),passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length,results};
await writeFile(dir+'results.json',JSON.stringify(summary,null,2));await browser.close();console.log(JSON.stringify({passed:summary.passed,failed:summary.failed}));if(summary.failed)process.exitCode=1;
