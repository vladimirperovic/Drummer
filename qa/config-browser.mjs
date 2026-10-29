import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const channel = process.env.DRUMMER_BROWSER || '';
const dir = process.env.DRUMMER_ARTIFACTS ? process.env.DRUMMER_ARTIFACTS.replace(/[\\/]?$/, '/') : fileURLToPath(new URL(`./artifacts/config/${channel || 'chromium'}/`, import.meta.url));
await mkdir(dir, { recursive:true });
const browser = await chromium.launch({headless:true,...(channel?{channel}:{}),args:['--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader']});
const results=[], filter=process.env.DRUMMER_CASE ? new RegExp(process.env.DRUMMER_CASE) : null;
const bridge='\nglobalThis.__qa = { kit, configurator, profiles, midi, audio, scorer, settings, studio, play, start, stop, onHit, scheduleSlot, loadPattern, applyKit, get pattern() { return pattern; } };';
async function scenario(name,fn,options={}) {
  if(filter&&!filter.test(name))return;
  const context=await browser.newContext({viewport:{width:1440,height:1100},serviceWorkers:options.offline?'allow':'block'});
  const p=await context.newPage(),errors=[]; p.setDefaultTimeout(10000); p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(seed=>{
    if(localStorage.getItem('drummer.language.v1')==null)localStorage.setItem('drummer.language.v1','sr');
    for(const [key,value] of Object.entries(seed||{}))localStorage.setItem(key,key==='drummer.language.v1'?value:JSON.stringify(value));
    Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async()=>({inputs:new Map(),outputs:new Map()})});
  },options.seed);
  if(options.noWebGL) await p.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:get.call(this,type,...args);};});
  if(!options.offline)await p.route('**/js/main.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:await r.text()+bridge});});
  try {await p.goto(base);await p.locator('#kitConfigurator').waitFor();await fn(p,context);assert.deepEqual(errors,[]);results.push({name,status:'PASS'});console.log('PASS '+name);}
  catch(e){await p.screenshot({path:dir+`failure-${results.length+1}.png`,fullPage:true}).catch(()=>{});results.push({name,status:'FAIL',error:e.stack,errors});console.log('FAIL '+name+': '+e.message);}
  finally{await context.close();}
}
const open = async p => {await p.locator('[data-view=kit]').click();await p.locator('#kitConfigurator summary').click();};
const expanded = async p => {await open(p);await p.locator('#kitPreset').selectOption('expanded');};
const three = async p => {await p.locator('#kit3d').click();await p.waitForFunction(()=>__qa.kit.mode==='3d'&&!!__qa.kit.three);await p.locator('#kit3dHost').scrollIntoViewIfNeeded();};

await scenario('Configurator: standard defaults and every count including one/two bass drums',async p=>{
  await open(p);assert.equal(await p.locator('#kit-kicks').inputValue(),'1');assert.equal(await p.locator('#kitLearnList button').count(),13);
  await p.locator('#kit-kicks').selectOption('2');assert.equal(await p.locator('[data-part=kick2]').count(),1);
  await p.locator('#kit-kicks').selectOption('1');assert.equal(await p.locator('[data-kit-art]').count(),1);
  await p.locator('#kitPreset').selectOption('expanded');assert.equal(await p.locator('#kitLearnList button').count(),19);
  assert.equal(await p.locator('#kit2dHost [data-part]').count(),14);
  await p.setViewportSize({width:1440,height:1600});await p.locator('#view-kit').screenshot({path:dir+'configurator.png'});await p.setViewportSize({width:1440,height:1100});
  await p.locator('#kitConfigurator summary').click();await p.locator('#view-kit').screenshot({path:dir+'expanded-2d.png'});
  await p.locator('[data-view=editor]').click();assert.equal(await p.locator('#grid .cell[data-slot="0"]').count(),19);
  await p.locator('[data-inst=kick2][data-slot="0"]').click();assert.equal(await p.locator('[data-inst=kick2][data-slot="0"]').getAttribute('data-v'),'2');
});
await scenario('Configurator: left-handed positions mirror with stable hit targets',async p=>{
  await expanded(p);const right=await p.locator('[data-part=kick] ellipse').first().getAttribute('cx');
  await p.locator('#kitHand').selectOption('left');const left=await p.locator('[data-part=kick] ellipse').first().getAttribute('cx');assert.equal(+left,-right);
  await p.locator('#kitConfigurator summary').click();await p.locator('#view-kit').screenshot({path:dir+'left-2d.png'});
});
await scenario('Configurator: all nineteen MIDI learn targets flash only their own 2D surfaces',async p=>{
  await expanded(p);
  const r=await p.evaluate(async()=>{
    const {INSTRUMENTS}=await import('/js/patterns.js');const seen=[];
    for(const [n,i] of INSTRUMENTS.entries()){
      document.querySelector(`[data-kit-learn="${i.id}"]`).click();__qa.midi.onMessage({data:[153,60+n,92],timeStamp:performance.now()});
      if(__qa.midi.map[60+n]!==i.id)throw Error('learn '+i.id);
      for(const a of document.getAnimations())a.cancel();
      __qa.midi.onMessage({data:[153,60+n,92],timeStamp:performance.now()});
      const active=[...document.querySelectorAll('.config-hit')].filter(e=>e.getAnimations().length);
      if(!active.length||active.some(e=>e.dataset.pad!==i.target))throw Error('wrong target '+i.id);
      seen.push(i.id);
    }
    return seen;
  });assert.equal(r.length,19);
});
await scenario('Configurator: both bass drums score and record separately, with distinct editor colors',async p=>{
  await expanded(p);await p.locator('[data-view=editor]').click();
  const r=await p.evaluate(async()=>{
    const {blankPattern}=await import('/js/patterns.js');const pattern=blankPattern();pattern.steps.kick[0]=3;pattern.steps.kick2[0]=1;__qa.loadPattern(pattern);
    __qa.settings.countIn=false;__qa.settings.record=true;await __qa.start();clearInterval(__qa.play.timer);
    __qa.scheduleSlot(0,__qa.play.nextTime);
    // Use the real audio/performance boundary, before the scorer's miss timeout.
    await new Promise(resolve=>{const tick=()=>performance.now()>__qa.play.firstPerf&&__qa.play.cur?resolve():requestAnimationFrame(tick);tick();});
    __qa.onHit('kick',92,__qa.play.firstPerf,'midi',36);__qa.onHit('kick2',92,__qa.play.firstPerf,'midi',35);
    const stats=__qa.scorer.stats();const p=__qa.pattern;__qa.stop();
    return {good:stats.all.good,one:p.steps.kick[0],two:p.steps.kick2[0],session:(await __qa.studio.loadSession(__qa.studio.sessions[0].id)).hits.map(h=>h.inst)};
  });assert.equal(r.good,2);assert.equal(r.one,2);assert.equal(r.two,2);assert.deepEqual(r.session,['kick','kick2']);
  // Stop opens the saved performance report; inspect the recorded editor next.
  await p.locator('[data-view=editor]').click();
  await p.locator('#grid .cell[data-inst="kick"][data-slot="0"][data-v="2"]').waitFor();
  await p.locator('#grid .cell[data-inst="kick2"][data-slot="0"][data-v="2"]').waitFor();
  const colors=await p.locator('#grid .cell[data-slot="0"][data-v="2"]').evaluateAll(es=>es.map(e=>getComputedStyle(e).backgroundColor));assert.equal(new Set(colors).size,2);
});
await scenario('Configurator: expanded 3D has all targets, independent colors, and survives rebuilds',async p=>{
  await expanded(p);await p.locator('#kitConfigurator summary').click();await three(p);
  const r=await p.evaluate(async()=>{
    const {INSTRUMENTS}=await import('/js/patterns.js');const k=__qa.kit.three;
    const THREE=await import('/js/vendor/three.module.js');
    const box=new THREE.Box3().setFromObject(k.scene);k.camera.updateMatrixWorld();
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const point=new THREE.Vector3(x,y,z).project(k.camera);if(Math.abs(point.x)>1||Math.abs(point.y)>1)throw Error('clipped 3D set');
    }
    for(const i of INSTRUMENTS){const targets=k.targets.get(i.target);if(!targets?.length)throw Error(i.id);const scale=targets[0].mesh.scale.toArray().join();__qa.kit.pulse(i.id);
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      if(targets.every(t=>t.mesh.material.color.equals(t.base))||targets[0].mesh.scale.toArray().join()!==scale)throw Error('flash '+i.id);
    }
    return [...k.targets.keys()];
  });assert.equal(r.length,18);await p.locator('#view-kit').screenshot({path:dir+'expanded-3d.png'});
  await p.locator('#kitConfigurator summary').click();await p.locator('#kit-kicks').selectOption('1');await p.waitForFunction(()=>__qa.kit.mode==='3d'&&!__qa.kit.three.targets.has('kick2'));
  assert.equal(await p.locator('#kit3dHost canvas').count(),1);
  await p.locator('#kit-kicks').selectOption('2');await p.waitForFunction(()=>__qa.kit.three?.targets.has('kick2'));
  await p.locator('#kitHand').selectOption('left');await p.waitForFunction(()=>__qa.kit.mode==='3d');await p.locator('#kitConfigurator summary').click();await p.locator('#view-kit').screenshot({path:dir+'left-3d.png'});
});
await scenario('Configurator: profile save/load restores parts, handedness, map, gain and calibration',async p=>{
  await expanded(p);await p.locator('#kitHand').selectOption('left');await p.locator('[data-kit-learn=kick2]').click();await p.evaluate(()=>__qa.midi.onMessage({data:[153,35,100],timeStamp:1}));
  await p.evaluate(()=>{__qa.settings.calib=23;__qa.settings.velocityGain=1.3;});await p.locator('#kitProfileName').fill('My two kicks');await p.locator('#kitProfileSave').click();
  const id=await p.locator('#kitProfile').inputValue();assert.ok(id);
  await p.locator('#kitPreset').selectOption('standard');await p.locator('#kitProfileNew').click();await p.locator('#kitProfileName').fill('Small');await p.locator('#kitProfileSave').click();
  await p.locator('#kitProfile').selectOption(id);assert.equal(await p.locator('#kit-kicks').inputValue(),'2');assert.equal(await p.locator('#kitHand').inputValue(),'left');
  assert.deepEqual(await p.evaluate(()=>[__qa.midi.map[35],__qa.settings.calib,__qa.settings.velocityGain]),['kick2',23,1.3]);
  await p.reload();await open(p);assert.equal(await p.locator('#kit-kicks').inputValue(),'2');assert.equal(await p.locator('#kitProfile').inputValue(),id);
});
await scenario('Configurator: profile export/import round trip and invalid input preserve existing data',async p=>{
  await expanded(p);await p.locator('#kitProfileName').fill('Portable kit');
  const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#kitProfileExport').click()]);await download.saveAs(dir+'profile.json');
  const data=JSON.parse(await readFile(dir+'profile.json','utf8'));assert.equal(data.profile.kitConfig.kicks,2);
  await p.locator('#kitPreset').selectOption('standard');await p.locator('#kitProfileImport').setInputFiles(dir+'profile.json');await p.waitForFunction(()=>__qa.profiles.items.length===1);
  assert.equal(await p.locator('#kit-kicks').inputValue(),'2');
  await p.locator('#kitProfileImport').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"type":"wrong"}')});
  await p.waitForFunction(()=>document.querySelector('#toast').textContent.includes('ispravan profil'));assert.equal(await p.evaluate(()=>__qa.profiles.items.length),1);
});
await scenario('Configurator: legacy profiles migrate to the original kit',async p=>{
  await expanded(p);await p.locator('#kitProfile').selectOption('old');assert.equal(await p.locator('#kit-kicks').inputValue(),'1');assert.equal(await p.locator('[data-kit-art]').count(),1);
  assert.equal(await p.evaluate(()=>__qa.midi.map[38]),'snare');
},{seed:{'drummer.profiles.v1':[{id:'old',name:'Old TD-17',map:{38:'snare'},calib:17}]}});
await scenario('Configurator: unavailable pattern lanes remain intact and playback explains missing parts',async p=>{
  await p.evaluate(async()=>{const {blankPattern}=await import('/js/patterns.js');const pat=blankPattern();pat.steps.kick2[0]=3;__qa.loadPattern(pat);});
  await p.locator('[data-view=editor]').click();assert.equal(await p.locator('[data-inst=kick2][data-slot="0"]').getAttribute('data-v'),'3');
  assert.equal(await p.evaluate(()=>__qa.start()),false);assert.match(await p.locator('#toast').textContent(),/nisu u tvom setu/);
  await expanded(p);assert.equal(await p.evaluate(()=>__qa.pattern.steps.kick2[0]),3);assert.equal(await p.evaluate(()=>__qa.start()),true);await p.evaluate(()=>__qa.stop());
});
await scenario('Configurator: controls and profile application are blocked during playback',async p=>{
  await open(p);await p.locator('#kit-kicks').selectOption('2');await p.evaluate(()=>__qa.start());
  assert.equal(await p.locator('#kit-kicks').isEnabled(),false);assert.equal(await p.locator('#kitProfileSave').isEnabled(),false);
  await p.evaluate(()=>__qa.profiles.apply({name:'Ignore',kitConfig:{kicks:1},map:{}}));assert.equal(await p.evaluate(()=>__qa.settings.kitConfig.kicks),2);
  await p.evaluate(()=>__qa.stop());assert.equal(await p.locator('#kit-kicks').isEnabled(),true);
});
await scenario('Configurator: storage failure keeps the prior kit and does not claim a saved profile',async p=>{
  await open(p);await p.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('quota');};});
  await p.locator('#kit-kicks').selectOption('2');assert.equal(await p.locator('#kit-kicks').inputValue(),'1');assert.equal(await p.locator('[data-kit-art]').count(),1);
  await p.locator('#kitProfileSave').click();assert.equal(await p.evaluate(()=>__qa.profiles.items.length),0);assert.equal(await p.locator('#storageWarning').isVisible(),true);
});
await scenario('Configurator: English labels, mobile layout and 2D fallback without WebGL',async p=>{
  await expanded(p);await p.locator('#languageSelect').selectOption('en');assert.equal(await p.locator('#kitConfigurator summary').innerText(),'My drum kit');assert.match(await p.locator('#kit-kicks').locator('..').innerText(),/Bass drums/);assert.equal(await p.locator('#kitProfileName').inputValue(),'My device');
  await p.locator('#kit3d').click();await p.waitForFunction(()=>document.querySelector('#kitViewStatus').textContent.includes('unavailable'));
  assert.equal(await p.locator('[data-part=kick2]').count(),1);
  await p.setViewportSize({width:390,height:844});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await p.locator('#kitConfigurator').screenshot({path:dir+'phone-config.png'});await p.locator('#kitConfigurator summary').click();await p.locator('#view-kit').screenshot({path:dir+'phone-kit.png'});
},{noWebGL:true});
await scenario('Configurator: saved custom kit and both renderers are available fully offline',async(p,context)=>{
  await expanded(p);await p.evaluate(async()=>navigator.serviceWorker.ready);await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);await p.reload();await p.locator('[data-part=kick2]').waitFor();
  await p.locator('#kit3d').click();await p.locator('#kit3dHost canvas').waitFor();assert.equal(await p.locator('#kit3d').getAttribute('aria-pressed'),'true');
},{offline:true});
await scenario('Configurator: minimum kit, canceled learning and rapid 3D rebuilds do not leak renderers',async p=>{
  await expanded(p);await p.locator('[data-kit-learn=kick2]').click();await p.locator('#kit-kicks').selectOption('1');assert.equal(await p.evaluate(()=>__qa.midi.learn),null);
  for(const key of ['racks','floors','crashes','rides'])await p.locator('#kit-'+key).selectOption('0');
  await p.locator('#kit-snares').selectOption('1');assert.equal(await p.locator('[data-part]').count(),3);assert.equal(await p.locator('#kitLearnList button').count(),6);
  await three(p);await p.evaluate(()=>{for(let n=0;n<8;n++)__qa.applyKit({...__qa.settings.kitConfig,kicks:n%2+1});});
  await p.waitForFunction(()=>__qa.kit.mode==='3d'&&__qa.kit.three.targets.has('kick2'));assert.equal(await p.locator('#kit3dHost canvas').count(),1);
});
await scenario('Configurator: two snares have distinct notation heads and both kicks belong to foot focus',async p=>{
  await expanded(p);await p.evaluate(async()=>{const {blankPattern}=await import('/js/patterns.js');const pat=blankPattern();for(const id of ['snare','snare2','kick','kick2'])pat.steps[id][0]=2;__qa.loadPattern(pat);});
  const heads=await p.locator('#notation .notation-svg .head').evaluateAll(es=>es.map(e=>({id:e.dataset.inst,x:e.dataset.x,y:e.dataset.y})));
  assert.equal(heads.length,4);assert.notEqual(heads.find(h=>h.id==='snare').x,heads.find(h=>h.id==='snare2').x);
  assert.equal(await p.locator('#notation .kit-note-badge').count(),2);
  await p.locator('[data-view=practice]').click();await p.locator('#focusFeet').click();
  assert.deepEqual(await p.locator('#focusInstruments input:checked').evaluateAll(es=>es.map(e=>e.value).sort()),['hhp','kick','kick2']);
});
const summary={browserVersion:browser.version(),generatedAt:new Date().toISOString(),passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length,results};
await writeFile(dir+'results.json',JSON.stringify(summary,null,2));await browser.close();console.log(JSON.stringify({passed:summary.passed,failed:summary.failed}));if(summary.failed)process.exitCode=1;
