import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KIT, KIT_LIMITS, KIT_PRESETS, normalizeKit, isDefaultKit, kitLayout, kitInstruments, missingKitInstruments, moveKitPart, KIT_MOVE_LIMIT } from '../js/kit-config.js';
import { INSTRUMENTS, INST, PRESETS, normalize, resize, blankPattern } from '../js/patterns.js';
import { normalizeProfile } from '../js/profiles.js';
import { defaultMap, normalizeMidiMap, MidiInput } from '../js/midi.js';
import { sessionKey, practiceRange } from '../js/practice.js';
import { EN } from '../js/i18n.js';

test('legacy profile and missing kit data retain the standard 13 articulations plus snare rimshot', () => {
  assert.deepEqual(normalizeProfile({ name: 'Old kit', map: {38:'snare'} }).kitConfig, DEFAULT_KIT);
  assert.equal(kitInstruments().length, 14); assert.equal(kitInstruments().some(i => i.id === 'rimshot'), true); assert.equal(isDefaultKit(undefined), true);
  for (const p of PRESETS) assert.deepEqual(missingKitInstruments(p), []);
});
test('kit counts reject coercion and clamp finite numeric values including one/two kicks', () => {
  assert.deepEqual(normalizeKit(null), DEFAULT_KIT);
  assert.equal(normalizeKit({kicks:0}).kicks,1); assert.equal(normalizeKit({kicks:99}).kicks,2);
  assert.equal(normalizeKit({kicks:'2', racks:NaN, floors:Infinity}).kicks,1);
  assert.equal(normalizeKit({racks:-10, floors:1.7, snares:0, leftHanded:'true'}).floors,2);
  assert.equal(normalizeKit({leftHanded:'true'}).leftHanded,false);
});
test('all 768 allowed configurations have unique finite parts and a valid active instrument set', () => {
  let count = 0;
  function visit(keys, value) {
    if (keys.length) { const [key,...rest]=keys; for(let n=KIT_LIMITS[key][0];n<=KIT_LIMITS[key][1];n++) visit(rest,{...value,[key]:n}); return; }
    for (const leftHanded of [false,true]) {
      const c={...value,leftHanded}, layout=kitLayout(c), ids=kitInstruments(c).map(i=>i.id); count++;
      assert.equal(new Set(layout.map(p=>p.id)).size,layout.length);
      assert.equal(layout.filter(p=>p.kind==='kick').length,c.kicks);
      assert.equal(layout.filter(p=>p.kind==='snare').length,c.snares);
      assert.equal(layout.filter(p=>p.kind==='floor').length,c.floors);
      assert.equal(layout.filter(p=>p.kind==='tom').length,c.racks);
      assert.equal(ids.includes('kick2'),c.kicks===2); assert.equal(ids.includes('snare2'),c.snares===2);
      assert.equal(ids.includes('bell'),c.rides===1);
      for (const p of layout) assert.ok([p.x,p.y,p.z,p.radius,p.depth,p.tilt].every(Number.isFinite));
    }
  }
  visit(Object.keys(KIT_LIMITS),{}); assert.equal(count,768);
});
test('left-handed kit mirrors positions and preserves identities, colors and MIDI roles', () => {
  const right=kitLayout(KIT_PRESETS.expanded), left=kitLayout({...KIT_PRESETS.expanded,leftHanded:true});
  right.forEach((p,n)=>{ assert.equal(left[n].id,p.id); assert.equal(left[n].x,-p.x); assert.equal(left[n].y,p.y); assert.equal(left[n].z,p.z); });
  assert.deepEqual(kitInstruments(KIT_PRESETS.expanded).map(i=>i.id),INSTRUMENTS.map(i=>i.id));
});
test('new instrument notes survive normalization, resizing and JSON round trip', () => {
  const p=blankPattern(); for(const i of INSTRUMENTS.filter(i=>i.optional)) p.steps[i.id][0]=3;
  const q=resize(normalize(JSON.parse(JSON.stringify(p))),{bars:2});
  for(const i of INSTRUMENTS.filter(i=>i.optional)) assert.equal(q.steps[i.id][0],3);
  // Rimshot is optional only for journal signatures; it is part of every kit's snare.
  assert.deepEqual(missingKitInstruments(q).map(i=>i.id),INSTRUMENTS.filter(i=>i.optional && i.id!=='rimshot').map(i=>i.id));
  assert.deepEqual(missingKitInstruments(q,KIT_PRESETS.expanded),[]);
});
test('profile retains layout and separate bass mappings without aliasing its input', () => {
  const source={ name:'Two kicks', kitConfig:{...KIT_PRESETS.expanded},map:{36:'kick',35:'kick2'},calib:12,gain:1.2};
  const profile=normalizeProfile(source); source.kitConfig.kicks=1; source.map[35]='snare';
  assert.equal(profile.kitConfig.kicks,2); assert.equal(profile.map[35],'kick2'); assert.equal(profile.calib,12);
});
test('MIDI learning keeps kick 1 and kick 2 independently playable and retains the legacy map', () => {
  globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
  const hits=[], midi=new MidiInput({onHit:(id)=>hits.push(id)}); const initial=defaultMap();
  assert.equal(initial[36],'kick'); assert.equal(initial[35],undefined);
  midi.startLearn('kick2'); midi.onMessage({data:[153,35,100],timeStamp:1});
  midi.onMessage({data:[153,36,100],timeStamp:2}); midi.onMessage({data:[153,35,100],timeStamp:3});
  assert.deepEqual(hits,['kick','kick2']); assert.equal(midi.map[36],'kick');
  assert.equal(normalizeMidiMap(midi.map)[35],'kick2');
});
test('optional parts have distinct keyboard shortcuts and translations', () => {
  const keys=INSTRUMENTS.flatMap(i=>i.keys); assert.equal(new Set(keys).size,keys.length);
  assert.equal(EN['Dobos 2'],'Snare 2'); assert.ok(EN['Bas bubnjevi']);
  assert.notEqual(INST.kick.color,INST.kick2.color); assert.notEqual(INST.kick.midiOut,INST.kick2.midiOut);
});
test('unused optional lanes do not split existing journal comparisons', () => {
  const pattern=blankPattern();pattern.steps.kick[0]=2;
  const old={pattern,range:{...practiceRange(pattern),instruments:INSTRUMENTS.filter(i=>!i.optional).map(i=>i.id)}};
  const current={pattern,range:practiceRange(pattern)};
  assert.equal(sessionKey(old),sessionKey(current));
  const changed=structuredClone(current);changed.pattern.steps.kick2[0]=2;
  assert.notEqual(sessionKey(current),sessionKey(changed));
});

test('manual offsets reject malformed input, clamp distances and omit zero/unknown parts', () => {
  const c=normalizeKit({offsets:{kick:{x:Infinity,z:'2'},snare:{x:99,z:-99},tom1:[1,2],unknown:{x:1,z:1},ride:{x:.123456,z:0}}});
  assert.deepEqual(c.offsets,{snare:{x:KIT_MOVE_LIMIT,z:-KIT_MOVE_LIMIT},ride:{x:.123,z:0}});
  assert.equal(isDefaultKit({offsets:{kick:{x:0,z:0}}}),true);
  assert.equal(isDefaultKit(c),false);
  assert.deepEqual(normalizeKit({offsets:[{x:1}]}),DEFAULT_KIT);
});
test('moving a part changes only its floor position, without changing MIDI roles or counts', () => {
  const initial=KIT_PRESETS.expanded, c=moveKitPart(initial,'kick2',.6,-.3);
  const before=kitLayout(initial),after=kitLayout(c);
  before.forEach((p,n)=>{assert.equal(after[n].x,p.x+(p.id==='kick2'?.6:0));assert.equal(after[n].z,p.z+(p.id==='kick2'?-.3:0));assert.equal(after[n].y,p.y);});
  assert.equal(initial.offsets,undefined); assert.deepEqual(kitInstruments(initial),kitInstruments(c));
  assert.deepEqual(moveKitPart(c,'missing',1,1),c);assert.deepEqual(moveKitPart(c,'kick',NaN,0),c);
});
test('left-handed dragging follows the pointer and mirrors custom arrangements consistently', () => {
  const c={...DEFAULT_KIT,leftHanded:true},moved=moveKitPart(c,'snare',.5,.25);
  assert.deepEqual(moved.offsets.snare,{x:-.5,z:.25});
  const before=kitLayout(c).find(p=>p.id==='snare'),after=kitLayout(moved).find(p=>p.id==='snare');
  assert.equal(after.x,before.x+.5);assert.equal(after.z,before.z+.25);
  const right=kitLayout({...moved,leftHanded:false}).find(p=>p.id==='snare');assert.equal(after.x,-right.x);
});
test('profiles deep-copy manual positions; temporarily removed parts retain their arrangement', () => {
  const c=moveKitPart(KIT_PRESETS.expanded,'kick2',.5,.3),p=normalizeProfile({kitConfig:c});
  c.offsets.kick2.x=2;assert.equal(p.kitConfig.offsets.kick2.x,.5);
  const smaller=normalizeKit({...p.kitConfig,kicks:1});assert.equal(kitLayout(smaller).some(p=>p.id==='kick2'),false);
  assert.equal(kitLayout({...smaller,kicks:2}).find(p=>p.id==='kick2').x,1.15);
  assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(p))).kitConfig,p.kitConfig);
});
test('resetting offsets preserves selected parts and restores their automatic placement', () => {
  const custom=moveKitPart({...KIT_PRESETS.expanded,leftHanded:true},'floor2',1,-1);
  const reset=normalizeKit({...custom,offsets:undefined});
  assert.deepEqual(reset,{...KIT_PRESETS.expanded,leftHanded:true});
  assert.deepEqual(kitLayout(reset),kitLayout({...KIT_PRESETS.expanded,leftHanded:true}));
});
