import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, INSTRUMENTS, totalSlots, slotsPerBar, slotOffsetMs, normalize } from '../js/patterns.js';
import { CATALOG_DEFINITIONS, filterPresets } from '../js/preset-catalog.js';
import { EN } from '../js/i18n.js';
import { KIT_ART } from '../js/kit-art-data.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('2D artwork records the current procedural 3D source and every instrument target', async () => {
  assert.equal(KIT_ART.sourceSha256, createHash('sha256').update((await Promise.all(['../js/kit-3d.js', '../js/kit-config.js'].map(path => readFile(new URL(path, import.meta.url), 'utf8')))).map(source => source.replace(/\r\n/g, '\n')).join('\n')).digest('hex'));
  for (const inst of INSTRUMENTS.filter(i => !i.optional)) {
    const pad = KIT_ART.pads[inst.target]; assert.ok(pad, inst.id);
    assert.ok(pad.center.every(Number.isFinite)); assert.equal(pad.outline.length, 64);
    assert.ok(pad.outline.flat().every(Number.isFinite));
  }
});

test('catalog has twenty arrangements in each new category and keeps fourteen basics', () => {
  assert.equal(PRESETS.length, 94); assert.equal(CATALOG_DEFINITIONS.length, 80);
  for (const category of ['latin', 'rock', 'jazz', 'three-eight']) assert.equal(filterPresets(PRESETS, category).length, 20);
  assert.equal(filterPresets(PRESETS, 'basics').length, 14);
});
test('new arrangements have distinct identities and musical contents', () => {
  assert.equal(new Set(PRESETS.map(p => p.id)).size, 94);
  const keys = PRESETS.slice(14).map(p => JSON.stringify([p.beats, p.beatUnit, p.division, p.swing, p.steps, p.sticking]));
  assert.equal(new Set(keys).size, 80);
});
test('catalog is playable with two hands; open and closed hi-hat do not overlap', () => {
  for (const p of PRESETS.slice(14)) for (let slot = 0; slot < totalSlots(p); slot++) {
    assert.ok(INSTRUMENTS.filter(i => !['kick', 'hhp'].includes(i.id) && p.steps[i.id][slot]).length <= 2, `${p.name} slot ${slot}`);
    assert.ok(!(p.steps.hh[slot] && p.steps.hho[slot]));
  }
});
test('all twenty 3/8 patterns retain eighth-note units and quarter-note BPM', () => {
  for (const p of filterPresets(PRESETS, 'three-eight')) {
    assert.equal(p.beats, 3); assert.equal(p.beatUnit, 8);
    assert.ok(Math.abs(slotOffsetMs(p, slotsPerBar(p)) - 90000 / p.bpm) < .00001);
  }
});
test('every new title, difficulty and lesson has an English translation', () => {
  for (const p of PRESETS.slice(14)) for (const text of [p.name, p.lesson, p.difficulty]) assert.ok(EN[text], text);
});
test('search matches both languages, diacritics, meter and active category', () => {
  assert.ok(filterPresets(PRESETS, 'latin', 'baiao').length >= 2);
  assert.ok(filterPresets(PRESETS, 'latin', 'anticipated kick').length);
  assert.equal(filterPresets(PRESETS, 'rock', 'baiao').length, 0);
  assert.equal(filterPresets(PRESETS, 'three-eight', '3/8').length, 20);
});
test('editing a loaded preset never changes the catalog source', () => {
  const source = PRESETS[14], before = JSON.stringify(source), copy = normalize(structuredClone(source));
  copy.steps.kick[0] = copy.steps.kick[0] ? 0 : 3; copy.name = 'Custom';
  assert.equal(JSON.stringify(source), before);
});
