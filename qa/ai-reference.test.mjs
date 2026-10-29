import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateArrangement} from '../js/ai-reference.js';

test('whole-song reference keeps all bars and nearest hits across section boundaries',()=>{
  const a=candidateArrangement({fileName:'example.wav',durationSeconds:36.2,bpm:120,meter:{beats:4,beatUnit:4},offsetSeconds:2,
    events:[{timeSeconds:1.99,inst:'kick',velocity:120},{timeSeconds:17.98,inst:'snare',velocity:92},{timeSeconds:36.1,inst:'hh',velocity:30}]},'song');
  assert.equal(a.id,'song');assert.equal(a.name,'example');assert.deepEqual(a.sections.map(s=>s.pattern.bars),[8,8,2]);
  assert.equal(a.sections[0].pattern.steps.kick[0],3);
  assert.equal(a.sections[1].pattern.steps.snare[0],2);
  assert.equal(a.sections[2].pattern.steps.hh[17],1);
});
test('triplet reference uses the chosen meter and preserves simultaneous drums',()=>{
  const a=candidateArrangement({durationSeconds:1,bpm:120,meter:{beats:3,beatUnit:8},division:12,
    events:[{timeSeconds:1/6,inst:'kick',velocity:92},{timeSeconds:1/6,inst:'snare',velocity:110}]});
  const p=a.sections[0].pattern;assert.equal(p.beatUnit,8);assert.equal(p.beats,3);assert.equal(p.division,12);
  assert.equal(p.steps.kick[2],2);assert.equal(p.steps.snare[2],3);
});
test('invalid song length and an offset after the song are rejected',()=>{
  assert.throws(()=>candidateArrangement({durationSeconds:3,offsetSeconds:3}));
  assert.throws(()=>candidateArrangement({durationSeconds:Infinity}));
});
