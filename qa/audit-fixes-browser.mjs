import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => ({ inputs: new Map(), outputs: new Map() }) }));
  await page.route('**/js/main.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nglobalThis.audit={songPractice,triggerCheck,studio,toggle,getBackupState};' }); });
  await page.goto(process.env.DRUMMER_URL || 'http://127.0.0.1:8123');
  await page.waitForFunction(() => !!window.audit);
  const results = await page.evaluate(async () => {
    const passed = [], check = (value, message) => { if (!value) throw new Error(message); };
    const { SongPractice } = await import('/js/song-practice.js');
    const { drumPartToPattern, drumKeys } = await import('/js/score-drums.js');
    const { validateBackup, planRestore, backupStorageValues } = await import('/js/backup-restore.js');
    let resolveAudio, sources = 0, stopped = 0; const clicks = [];
    const song = Object.assign(Object.create(SongPractice.prototype), { active: false, from: 0, to: 10, rate: 1, volume: 1,
      reference: { events: [], bpm: 120, meter: { beats: 6, beatUnit: 8 }, offsetSeconds: 0, durationSeconds: 10 },
      renderPlay() {}, renderStage() {}, loop() {}, buffer: () => ({}),
      host: { settings: { countIn: true }, toast() {}, isBusy: () => false, audio: {
        ensure: () => new Promise(resolve => { resolveAudio = resolve; }), ctxToPerf: x => x * 1000,
        click: time => clicks.push(time), ctx: { currentTime: 0, destination: {}, createGain: () => ({ gain: {}, connect() {} }),
          createBufferSource: () => { sources++; return { playbackRate: {}, connect: gain => gain, start() {}, stop() { stopped++; } }; } } } } });
    const first = song.start(); check(song.busy, 'pending start must lock'); check(await song.start() === false, 'duplicate start');
    resolveAudio(); check(await first, 'first start'); check(sources === 1, 'one source'); song.stop(); check(stopped === 1, 'stop the only source');
    const cancelled = song.start(); song.stop(); resolveAudio(); check(await cancelled === false && sources === 1, 'cancel pending start');
    song.host.audio.ensure = async () => { throw new Error('audio unavailable'); }; check(await song.start() === false && !song.busy, 'failure unlocks');
    passed.push('Double Start, cancellation and failed initialization');
    check(clicks.length === 6 && clicks.every((v,i) => !i || Math.abs(v-clicks[i-1]-.25)<1e-9), '6/8 clicks every eighth note');
    let svg = ''; song.report = { bpm:120,meter:{beats:6,beatUnit:8},offsetSeconds:0,reference:[],hits:[],rate:1,to:10 }; song.laneStart=0;
    song.reportPanel={querySelector: selector => selector === '[data-lanes]' ? {set innerHTML(v){svg=v;}} : {}};
    song.renderLanes(); check((svg.match(/class="song-bar"/g)||[]).length === 3, '6/8 two-bar lane has three bar boundaries');
    passed.push('6/8 count-in and report bar grid');
    const { songPractice:s, studio, triggerCheck } = audit;
    s.starting=true; check(studio.host.isPlaying() && studio.backupRestore.busy, 'pending song locks studio');
    document.body.dataset.mode='notes'; audit.toggle(); check(!s.busy, 'global stop cancels hidden song');
    let ended=false; s.active=true; s.source={stop(){ended=true;}}; s.refs=[];s.hits=[];s.from=0;s.to=10;s.perfStart=performance.now();s.reference={durationSeconds:10,events:[],fileName:'test',buffers:{},meter:{beats:4,beatUnit:4}};
    check(studio.host.isPlaying() && studio.backupRestore.busy, 'active song locks studio'); audit.toggle(); check(ended&&!s.active, 'global stop ends hidden active song');
    triggerCheck.recording=true; check(studio.host.isPlaying() && studio.backupRestore.busy, 'trigger capture locks studio'); triggerCheck.recording=false;
    passed.push('Stop across modes and song/trigger studio locks');
    const note = extra => `<note>${extra}<unpitched><display-step>F</display-step><display-octave>4</display-octave></unpitched><duration>1</duration></note>`;
    const convert = notes => { const doc=new DOMParser().parseFromString(`<score-partwise><part-list><score-part id="P"><part-name>Drums</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${notes}</measure></part></score-partwise>`,'text/xml');
      const key=drumKeys(doc,'P')[0].id; return drumPartToPattern(doc,{partId:'P',map:{[key]:'kick'}}).pattern.steps.kick; };
    const cue=convert(note('<cue/>')+note('')); check(cue[0]===0&&cue[4]>0,'cue advances time');
    const ties=convert(note('<tie type="start"/>')+note('<tie type="stop"/><tie type="start"/>')+note('<tie type="stop"/>')); check(ties.filter(Boolean).length===1,'tie continuation is not another hit');
    passed.push('MusicXML cue timing and chained ties');
    const run={id:'song-test',name:'test',from:0,to:2,rate:1,durationSeconds:2,offsetSeconds:0,bpm:120,meter:{beats:6,beatUnit:8},reference:[[1,'kick',null]],hits:[[1,'kick',90,null,'extra']]};
    s.history=[run]; const backup=validateBackup(await audit.getBackupState()); check(backup.songRuns[0].hits[0][2]===90,'full export preserves song hits');
    const current={songRuns:[run]}, incoming=validateBackup({version:2,songRuns:[{...run,name:'new'}]});
    check(planRestore(current,incoming).snapshot.songRuns[0].name==='test','keep conflict');
    check(planRestore(current,incoming,{conflicts:'replace'}).snapshot.songRuns[0].name==='new','replace conflict');
    check(planRestore(current,incoming,{conflicts:'both'}).snapshot.songRuns.length===2,'both conflict');
    check(planRestore(current,validateBackup({version:2,ritmovi:[]}),{mode:'replace'}).snapshot.songRuns.length===1,'old backup preserves songs');
    const restored=planRestore({},incoming,{mode:'replace'}).snapshot;
    check(JSON.parse(backupStorageValues(restored)['drummer.songRuns.v1'])[0].name==='new','restore targets history storage');
    let rejected=false;try{validateBackup({version:2,songRuns:[{...run,hits:[[0,'unknown',90,null,'extra']]}]});}catch{rejected=true;}check(rejected,'invalid song rejected');
    check(planRestore(current,validateBackup({version:2,songRuns:[]}),{mode:'replace'}).snapshot.songRuns.length===0,'explicit empty replacement clears history');
    await studio.journal.restore([], backupStorageValues(restored));
    passed.push('Song history export, merge conflicts, replace, legacy and validation');
    return passed;
  });
  for (const name of results) console.log('PASS '+name);
  await page.reload(); await page.waitForFunction(() => !!window.audit);
  assert.equal(await page.evaluate(() => audit.songPractice.history[0].name), 'new');
  console.log('PASS restored song history survives application reload');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
