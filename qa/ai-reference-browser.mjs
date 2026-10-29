import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
try{
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>Object.defineProperty(navigator,'requestMIDIAccess',{value:async()=>({inputs:new Map(),outputs:new Map()})}));
 await page.route('**/js/main.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nglobalThis.__aiReference={applyAiCandidate,studio,audio,settings,play};'});});
 await page.goto(process.env.DRUMMER_URL||'http://127.0.0.1:8123');await page.waitForFunction(()=>!!globalThis.__aiReference);
 await page.locator('[data-mode=song]').click(); await page.locator('#appNav [data-pane=ai]').click();
 assert.equal(await page.locator('#tool-ai').isVisible(),true);
 await page.locator('[data-mode=notes]').click(); await page.locator('#appNav [data-section=library]').click(); await page.locator('.subtabs [data-pane=import]').click();assert.equal(await page.locator('#tool-ai').isVisible(),false);
 await page.evaluate(async()=>{
  const q=__aiReference;await q.studio.journalReady;await q.audio.ensure();
  q.settings.countIn=false;q.settings.metro=false;
  const buffer=q.audio.ctx.createBuffer(1,Math.ceil(q.audio.ctx.sampleRate*5),q.audio.ctx.sampleRate);
  q.applyAiCandidate({fileName:'public-fixture.wav',durationSeconds:5,bpm:240,meter:{beats:2,beatUnit:4},division:16,
    offsetSeconds:0,audioBuffer:buffer,backingBuffer:buffer,events:Array.from({length:20},(_,i)=>({timeSeconds:i*.25,inst:'snare',velocity:92}))});
  globalThis.__songStarts=[];const original=q.studio.backing.scheduleSong.bind(q.studio.backing);
  q.studio.backing.scheduleSong=(...args)=>{__songStarts.push(args);return original(...args);};
  return q.studio.startArrangement();
 });
 await page.waitForFunction(()=>__aiReference.play.on);
 await page.waitForFunction(()=>!__aiReference.play.on&&!__aiReference.studio.run,{},{timeout:12000});
 const result=await page.evaluate(async()=>({sessions:await __aiReference.studio.exportSessions(),starts:__songStarts.length,sections:__aiReference.studio.arrangements.draft.sections.length}));
 assert.equal(result.sections,2);assert.equal(result.starts,1);assert.equal(result.sessions.length,2);
 assert.deepEqual(result.sessions.map(s=>s.expected.length).sort((a,b)=>a-b),[4,16]);
 assert.equal(result.sessions.reduce((n,s)=>n+s.durationMs,0),5000);
 assert.deepEqual(errors,[]);console.log('PASS AI full-song reference: two editable sections, one continuous audio source, complete journal and AI tab navigation');
}finally{await browser.close();}
