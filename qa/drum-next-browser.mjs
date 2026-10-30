// Rimshot, provera trigera i bubnjarska deonica iz MusicXML-a, u pravom browseru sa simuliranim TD-17.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.DRUMMER_URL || 'http://127.0.0.1:8123';
const channel = process.env.DRUMMER_BROWSER || '';
const artifacts = fileURLToPath(new URL(`./artifacts/drum-next/${channel || 'chromium'}/`, import.meta.url));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [], filter = process.env.DRUMMER_CASE ? new RegExp(process.env.DRUMMER_CASE) : null;
const bridge = '\nglobalThis.__qa = { audio, midi, scorer, settings, play, studio, start, stop, onHit, loadPattern, renderStats, setBpm, get pattern() { return pattern; }, get triggerCheck() { return triggerCheck; }, get songPractice() { return songPractice; } };';

async function scenario(name, fn, { language = 'sr', storage = {}, viewport = { width: 1440, height: 1000 } } = {}) {
  if (filter && !filter.test(name)) return;
  const context = await browser.newContext({ viewport, acceptDownloads: true, serviceWorkers: 'block' });
  const p = await context.newPage(), errors = [];
  p.setDefaultTimeout(10000); p.on('pageerror', e => errors.push(e.message));
  const pending = new Set(); p.on('request', r => pending.add(r.url())); p.on('requestfinished', r => pending.delete(r.url())); p.on('requestfailed', r => pending.delete(r.url()));
  const network = []; p.on('console', m => { if (m.type() === 'error') network.push(m.text()); });
  await p.addInitScript(([language, storage]) => {
    if (!sessionStorage.getItem('qa-init')) {
      sessionStorage.setItem('qa-init', '1'); localStorage.setItem('drummer.language.v1', language);
      for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
    }
    const port = { id: 'td-17', name: 'Test TD-17', onmidimessage: null };
    window.__port = port;
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => ({ inputs: new Map([['td-17', port]]), outputs: new Map() }) });
  }, [language, storage]);
  await p.route('**/js/main.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + bridge }); });
  try {
    await p.goto(base);
    await p.waitForFunction(() => !!window.__qa, null, { timeout: 15000 }).catch(e => { throw new Error(`${e.message} pending: ${[...pending].join(', ')} console: ${network.join(' | ')}`); }); await p.evaluate(() => __qa.studio.journalReady);
    await fn(p, context); assert.deepEqual(errors, [], 'uncaught page errors');
    results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`);
  } catch (e) {
    const screenshot = `failure-${results.length + 1}.png`;
    await p.screenshot({ path: artifacts + screenshot, fullPage: true }).catch(() => {});
    results.push({ name, status: 'FAIL', error: e.stack, errors, screenshot }); console.log(`FAIL ${name}: ${e.message}`);
  } finally { await context.close(); }
}
const midi = (p, data, offset = 0) => p.evaluate(([data, offset]) => __port.onmidimessage({ data, timeStamp: performance.now() + offset }), [data, offset]);
const midiAt = (p, events) => p.evaluate(events => { const t0 = performance.now(); for (const [data, at] of events) __port.onmidimessage({ data, timeStamp: t0 + at }); }, events);
const open = async (p, section, pane) => { await p.locator(`#appNav [data-section=${section}]`).click(); if (pane) await p.locator(`.subtabs [data-pane=${pane}]`).click(); };

await scenario('Rimshot: TD-17 note 40 is its own articulation with sound, key, editor row and notehead', async p => {
  assert.equal(await p.evaluate(() => __qa.midi.map[40]), 'rimshot');
  assert.equal(await p.evaluate(() => __qa.midi.map[38]), 'snare');
  await open(p, 'editor');
  assert.equal(await p.locator('#grid .cell[data-inst=rimshot]').count(), 16);
  await p.locator('#grid .cell[data-inst=rimshot][data-slot="4"]').click();
  assert.equal(await p.evaluate(() => __qa.pattern.steps.rimshot[4]), 2);
  const head = p.locator('#notation .head[data-inst=rimshot]');
  await head.waitFor({ state: 'attached' }); assert.equal(await head.count(), 1); assert.equal(await head.locator('line.xhead').count(), 1, 'slashed rimshot head');
  await p.locator('#notation').screenshot({ path: artifacts + 'rimshot-notation.png' });
  await p.evaluate(() => __qa.audio.ensure());
  await midi(p, [153, 40, 100]);
  assert.match(await p.locator('#lastHit').textContent(), /Rimshot/);
  await p.keyboard.press('KeyX'); assert.match(await p.locator('#lastHit').textContent(), /Rimshot/);
  await open(p, 'settings', 'timing');
  assert.match(await p.locator('#keyHelp').textContent(), /X\s*Rimshot/);
});

await scenario('Rimshot: articulation is scored separately only when the pattern writes rimshots', async p => {
  await p.evaluate(async () => {
    const pattern = structuredClone(__qa.pattern); pattern.steps.snare.fill(0); pattern.steps.rimshot.fill(0); pattern.steps.hh.fill(0); pattern.steps.kick.fill(0);
    pattern.steps.rimshot[0] = 2; pattern.steps.rimshot[4] = 2; pattern.steps.snare[8] = 2; pattern.steps.snare[12] = 2; pattern.id = null;
    __qa.loadPattern(pattern); __qa.settings.countIn = false; __qa.settings.loop = false; __qa.settings.metro = false; __qa.setBpm(60);
    await __qa.start();
  });
  await p.waitForFunction(() => __qa.play.cur?.n >= 0);
  const first = await p.evaluate(() => __qa.play.firstPerf), at = slot => first + slot * 250;
  // Rimshot where written, plain snare where rimshot is written, rimshot where plain is written, plain where plain is written.
  for (const [note, slot] of [[40, 0], [38, 4], [40, 8], [38, 12]]) {
    await p.waitForFunction(perf => performance.now() >= perf - 5, at(slot));
    await p.evaluate(([note, perf]) => __port.onmidimessage({ data: [153, note, 100], timeStamp: perf }), [note, at(slot)]);
    if (slot === 4) assert.match(await p.locator('#lastHit').textContent(), /bez rimshota/);
    if (slot === 8) assert.match(await p.locator('#lastHit').textContent(), /rimshot umjesto običnog/);
  }
  await p.evaluate(() => __qa.stop());
  const stats = await p.evaluate(() => { const s = __qa.scorer.stats(); return { rim: [s.per.rimshot.good + s.per.rimshot.ok, s.per.rimshot.artOk, s.per.rimshot.artChecked], snare: [s.per.snare.good + s.per.snare.ok, s.per.snare.artOk, s.per.snare.artChecked], extra: s.all.extra }; });
  assert.deepEqual(stats, { rim: [2, 1, 2], snare: [2, 1, 2], extra: 0 }, 'all four hits count for timing; half the articulations are wrong');
  await open(p, 'results', 'stats');
  assert.match(await p.locator('#statTable thead').textContent(), /Udarac/);
  assert.match(await p.locator('#statTable tbody').textContent(), /50%/);
  // A pattern without rimshots keeps the old behavior: a rimshot simply counts as the snare.
  await p.evaluate(async () => { __qa.loadPattern(structuredClone(__qa.pattern), {}); });
  await p.evaluate(async () => {
    const pattern = structuredClone(__qa.pattern); pattern.steps.rimshot.fill(0); pattern.steps.snare.fill(0); pattern.steps.snare[0] = 2; pattern.id = 'x2';
    __qa.loadPattern(pattern); await __qa.start();
  });
  await p.waitForFunction(() => __qa.play.cur?.n >= 0);
  const perf = await p.evaluate(() => __qa.play.firstPerf);
  await p.waitForFunction(perf => performance.now() >= perf - 5, perf);
  await p.evaluate(perf => __port.onmidimessage({ data: [153, 40, 100], timeStamp: perf }), perf);
  await p.evaluate(() => __qa.stop());
  assert.deepEqual(await p.evaluate(() => { const s = __qa.scorer.stats().per.snare; return [s.good + s.ok, s.artChecked]; }), [1, 0]);
  assert.doesNotMatch(await p.locator('#statTable thead').textContent(), /Udarac/);
});

await scenario('Rimshot: an older saved MIDI map and profile move note 40 to rimshot once', async p => {
  assert.equal(await p.evaluate(() => __qa.midi.map[40]), 'rimshot');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('drummer.profiles.v1'))[0].map[40]), 'rimshot');
  assert.equal(await p.evaluate(() => __qa.midi.map[41]), 'tom3', 'other custom notes are untouched');
  await p.evaluate(() => { __qa.midi.assign(40, 'snare'); }); await p.reload(); await p.waitForFunction(() => !!window.__qa);
  assert.equal(await p.evaluate(() => __qa.midi.map[40]), 'snare', 'a later deliberate choice is kept');
}, { storage: { 'trener.midiMapa.v1': JSON.stringify({ 36: 'kick', 38: 'snare', 40: 'snare', 41: 'tom3' }),
  'drummer.profiles.v1': JSON.stringify([{ id: 'p1', name: 'Old', map: { 38: 'snare', 40: 'snare' } }]) } });

await scenario('Triggers: live check finds double triggers, crosstalk, saturation and a short pedal range', async p => {
  await open(p, 'settings', 'triggers');
  assert.match(await p.locator('#triggerCheck [data-trig-status]').textContent(), /Spremno/);
  await p.locator('[data-trig-start]').click();
  assert.equal(await p.locator('[data-trig-stop]').isVisible(), true);
  const events = [];
  let t = 0;
  for (let i = 0; i < 24; i++) { t += 250; events.push([[153, 38, i < 8 ? 30 : i < 16 ? 80 : 127], t]); }
  for (let i = 0; i < 3; i++) { t += 300; events.push([[153, 38, 110], t], [[153, 38, 20], t + 14]); }
  t += 2000;
  for (let i = 0; i < 4; i++) { t += 300; events.push([[153, 36, 120], t], [[153, 45, 9], t + 4]); }
  for (let i = 0; i < 12; i++) events.push([[185, 4, 20 + i * 5], t + i * 20]);
  events.push([[153, 27, 70], t + 400]);
  await midiAt(p, events);
  await p.waitForFunction(() => document.querySelectorAll('#triggerCheck .trig-advice li').length >= 4);
  const advice = await p.locator('#triggerCheck .trig-advice').textContent();
  assert.match(advice, /Dobos: 3 dupla okidanja.*Retrig Cancel/);
  assert.match(advice, /Udarac u Kick okida Tom 2 \(4×\)\. Povećaj Crosstalk Cancel na padu Tom 2/);
  assert.match(advice, /Dobos: \d+% udaraca na 127/);
  assert.match(advice, /Hi-hat pedala šalje samo 20–75/);
  assert.match(advice, /Nota 27 nije mapirana/);
  assert.equal(await p.locator('#triggerCheck [data-trig-zones] tbody tr').count(), 4);
  assert.equal(await p.locator('#triggerCheck .trig-hist i').count(), 32);
  assert.match(await p.locator('[data-trig-status]').textContent(), /Snimam: 39 udaraca/);
  // Practice cannot start while the check is recording.
  await p.locator('#playBtn').click(); assert.equal(await p.evaluate(() => __qa.play.on), false);
  await p.locator('[data-trig-stop]').click();
  assert.match(await p.locator('[data-trig-status]').textContent(), /Provera: 39 udaraca/);
  const [download] = await Promise.all([p.waitForEvent('download'), p.locator('[data-trig-export]').click()]);
  const lines = (await (await download.createReadStream()).toArray()).join('').trim().split('\n').map(JSON.parse);
  assert.equal(lines.filter(l => l.type === 'on').length, 39); assert.equal(lines.filter(l => l.type === 'cc').length, 12);
  assert.equal(lines[0].t, 0);
  await p.locator('#triggerCheck').screenshot({ path: artifacts + 'trigger-check.png' });
  await p.locator('[data-trig-clear]').click();
  assert.equal(await p.locator('#triggerCheck [data-trig-zones] tbody tr').count(), 0);
});

await scenario('Triggers: English view and phone width', async p => {
  await open(p, 'settings', 'triggers');
  await p.locator('[data-trig-start]').click();
  await midiAt(p, Array.from({ length: 40 }, (_, i) => [[153, i % 2 ? 38 : 36, 60 + i], i * 200]));
  await p.locator('[data-trig-stop]').click();
  assert.match(await p.locator('#triggerCheck .trig-advice').textContent(), /No double triggers or crosstalk/);
  assert.match(await p.locator('#triggerCheck h3').textContent(), /Trigger check/);
  assert.match(await p.locator('#triggerCheck thead').first().textContent(), /Velocity 1–127/);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal page scroll');
  await p.screenshot({ path: artifacts + 'trigger-phone.png' });
}, { language: 'en', viewport: { width: 390, height: 844 } });

// MuseScore-style drum set export: instruments with GM numbers, a percussion clef, two voices,
// accents, a ghost note, a tempo marking and a triplet bar.
const inst = { kick: ['P1-I36', 'Bass Drum 1', 37, 'F', 4], snare: ['P1-I39', 'Acoustic Snare', 39, 'C', 5], hh: ['P1-I43', 'Closed Hi-Hat', 43, 'G', 5],
  crash: ['P1-I50', 'Crash Cymbal 1', 50, 'A', 5], cow: ['P1-I57', 'Cowbell', 57, 'E', 5] };
const note = (key, duration, { chord = false, voice = 1, accent = false, ghost = false, triplet = false } = {}) => {
  const [id, , , step, octave] = inst[key];
  return `<note>${chord ? '<chord/>' : ''}<unpitched><display-step>${step}</display-step><display-octave>${octave}</display-octave></unpitched><duration>${duration}</duration><instrument id="${id}"/><voice>${voice}</voice>`
    + `${triplet ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' : ''}${key === 'hh' || key === 'crash' ? '<notehead>x</notehead>' : ghost ? '<notehead parentheses="yes">normal</notehead>' : ''}`
    + `${accent ? '<notations><articulations><accent/></articulations></notations>' : ''}</note>`;
};
const rest = (duration, voice) => `<note><rest/><duration>${duration}</duration><voice>${voice}</voice></note>`;
const hhBar = snareAt => Array.from({ length: 8 }, (_, i) => note('hh', 6) + (snareAt[i] ? note('snare', 6, { chord: true, accent: snareAt[i] === 'X' }) : '')).join('');
const drumsXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><work><work-title>Groove fixture</work-title></work><part-list>
<score-part id="P0"><part-name>Piano</part-name></score-part>
<score-part id="P1"><part-name>Drumset</part-name>${Object.values(inst).map(([id, name]) => `<score-instrument id="${id}"><instrument-name>${name}</instrument-name></score-instrument>`).join('')}
${Object.values(inst).map(([id, , midi]) => `<midi-instrument id="${id}"><midi-channel>10</midi-channel><midi-unpitched>${midi}</midi-unpitched></midi-instrument>`).join('')}</score-part></part-list>
<part id="P0">${[1, 2, 3].map(n => `<measure number="${n}">${n === 1 ? '<attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' : ''}<note><pitch><step>C</step><octave>4</octave></pitch><duration>48</duration><type>whole</type></note></measure>`).join('')}</part>
<part id="P1">
<measure number="1"><attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef></attributes>
<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>112</per-minute></metronome></direction-type><sound tempo="112"/></direction>
${hhBar([0, 0, 'x', 0, 0, 0, 'X', 0])}<backup><duration>48</duration></backup>${note('kick', 12, { voice: 2 })}${rest(12, 2)}${note('kick', 12, { voice: 2 })}${rest(12, 2)}</measure>
<measure number="2">${note('crash', 6)}${note('kick', 6, { chord: true })}${note('hh', 3)}${note('snare', 3, { ghost: true })}${note('hh', 6)}${note('snare', 6, { chord: true })}${note('hh', 6)}${note('hh', 6)}${note('hh', 6)}${note('hh', 6)}${note('snare', 6, { chord: true, accent: true })}${note('cow', 6)}<backup><duration>48</duration></backup>${rest(24, 2)}${note('kick', 12, { voice: 2 })}${rest(12, 2)}</measure>
<measure number="3">${Array.from({ length: 12 }, (_, i) => note('hh', 4, { triplet: true }) + (i % 6 === 3 ? note('snare', 4, { chord: true, triplet: true }) : '')).join('')}</measure>
</part></score-partwise>`;

await scenario('Score: a MusicXML drum part becomes an editable practice pattern', async p => {
  await p.locator('#scoreFile').setInputFiles({ name: 'groove.musicxml', mimeType: 'application/xml', buffer: Buffer.from(drumsXml) });
  await p.locator('#scoreImportCanvas svg').first().waitFor({ timeout: 20000 });
  assert.equal(await p.locator('#scoreDrums').isVisible(), true);
  assert.deepEqual(await p.locator('#scoreDrumPart option').allTextContents(), ['Drumset (3)'], 'only the drum part is offered');
  assert.equal(await p.locator('#scoreDrumBars').inputValue(), '2');
  const summary = p.locator('#scoreDrumSummary');
  assert.match(await summary.textContent(), /Takt 1–2 \/ 3 · 4\/4 · šesnaestine · 112 BPM · Udarci: 24/);
  assert.match(await summary.textContent(), /preskočeno: 1/, 'cowbell has no drum in the kit');
  const map = Object.fromEntries(await p.locator('#scoreDrumMap label').evaluateAll(list => list.map(l => [l.querySelector('span').textContent.split(' · ')[0], l.querySelector('select').value])));
  assert.deepEqual(map, { 'Closed Hi-Hat': 'hh', 'Acoustic Snare': 'snare', 'Bass Drum 1': 'kick', 'Crash Cymbal 1': 'crash', Cowbell: '' });
  await p.locator('#scoreDrums').screenshot({ path: artifacts + 'score-drums.png' });
  // Triplet bar switches the automatic grid.
  await p.locator('#scoreDrumFrom').fill('3'); await p.locator('#scoreDrumFrom').dispatchEvent('change');
  assert.match(await summary.textContent(), /Takt 3–3 \/ 3 · 4\/4 · triole/);
  await p.locator('#scoreDrumFrom').fill('1'); await p.locator('#scoreDrumFrom').dispatchEvent('change');
  await p.locator('#scoreDrums summary').click();
  await p.locator('#scoreDrumMap label', { hasText: 'Cowbell' }).locator('select').selectOption('bell');
  assert.doesNotMatch(await summary.textContent(), /preskočeno/);
  await p.locator('#scoreDrumApply').click();
  assert.equal(await p.locator('#scoreImportDialog').isVisible(), false);
  const pattern = await p.evaluate(() => { const q = __qa.pattern; return { name: q.name, bars: q.bars, bpm: q.bpm, division: q.division,
    hh: q.steps.hh.slice(0, 16).join(''), snare: q.steps.snare.join(''), kick: q.steps.kick.join(''), crash: q.steps.crash.join(''), bell: q.steps.bell.join('') }; });
  assert.deepEqual(pattern, { name: 'Groove fixture — Drumset', bars: 2, bpm: 112, division: 16,
    hh: '2020202020202020', snare: '00002000000030000001200000003000', kick: '20000000200000002000000020000000',
    crash: '00000000000000002000000000000000', bell: '00000000000000000000000000000020' });
  assert.equal(await p.locator('#appNav [data-section=editor]').getAttribute('aria-current'), 'page');
  assert.equal(await p.locator('#notation .head[data-inst=snare].dyn1').count(), 1, 'ghost note keeps its parentheses');
});

await scenario('Score: pitched-only scores keep the reading view without a drum panel', async p => {
  const piano = drumsXml.replace(/<score-part id="P1">[\s\S]*?<\/score-part>/, '').replace(/<part id="P1">[\s\S]*?<\/part>/, '');
  await p.locator('#scoreFile').setInputFiles({ name: 'piano.musicxml', mimeType: 'application/xml', buffer: Buffer.from(piano) });
  await p.locator('#scoreImportCanvas svg').first().waitFor({ timeout: 20000 });
  assert.equal(await p.locator('#scoreDrums').isHidden(), true);
});

// Pesma: referenca kao iz AI analize (stvarna vremena udaraca), sintetički zvuk od 5 sekundi.
const songSetup = async (p, { countIn = false } = {}) => p.evaluate(async countIn => {
  await __qa.audio.ensure(); __qa.settings.countIn = countIn;
  const buffer = new AudioBuffer({ length: 44100 * 5, numberOfChannels: 1, sampleRate: 44100 }), data = buffer.getChannelData(0);
  for (let s = 0; s < 20; s++) for (let i = 0; i < 400; i++) data[Math.round((.5 + s * .25) * 44100) + i] = Math.sin(i * .3) * (1 - i / 400);
  const events = [];
  for (let b = 0; b < 8; b++) { events.push({ timeSeconds: .5 + b * .5, inst: b % 2 ? 'snare' : 'kick' }); events.push({ timeSeconds: .5 + b * .5, inst: 'hh' }); }
  __qa.songPractice.setReference({ events, durationSeconds: 5, fileName: 'Test groove.mp3', bpm: 120, meter: { beats: 4, beatUnit: 4 }, offsetSeconds: .5,
    buffers: { original: buffer, drums: buffer, without: null } });
}, countIn);

await scenario('Song: mode switch swaps notation for the live meter and keeps note sections out of the way', async p => {
  assert.equal(await p.evaluate(() => document.body.dataset.mode), 'notes');
  assert.equal(await p.locator('.sheet').isVisible(), true); assert.equal(await p.locator('#songStage').isVisible(), false);
  assert.deepEqual(await p.locator('#appNav button').evaluateAll(list => list.filter(b => b.getClientRects().length).map(b => b.dataset.section || b.dataset.pane || b.id)),
    ['kit', 'library', 'editor', 'practice', 'results', 'settings', 'searchOpen'], 'notes menu');
  await p.locator('button[data-mode=song]').click();
  assert.equal(await p.evaluate(() => document.body.dataset.mode), 'song');
  assert.equal(await p.evaluate(() => document.body.hasAttribute('aria-pressed')), false, 'only the switch buttons are pressed');
  assert.equal(await p.locator('.sheet').isVisible(), false); assert.equal(await p.locator('#songStage').isVisible(), true);
  assert.equal(await p.locator('#appNav [data-section=library]').isVisible(), false); assert.equal(await p.locator('.tempo').isVisible(), false);
  assert.equal(await p.locator('[data-song-empty]').isVisible(), true);
  // Start without a song explains the first step instead of starting the pattern.
  await p.locator('#playBtn').click(); assert.equal(await p.evaluate(() => __qa.play.on), false);
  assert.equal(await p.locator('#appNav [data-pane=ai]').getAttribute('aria-current'), 'page');
  assert.deepEqual(await p.locator('#appNav button').evaluateAll(list => list.filter(b => b.getClientRects().length).map(b => b.dataset.section || b.dataset.pane || b.id)),
    ['kit', 'ai', 'songplay', 'songreport', 'settings', 'searchOpen'], 'song menu');
  // Arrangement and pattern backing now live in Practice and switch back to Notes.
  await p.locator('button[data-mode=notes]').click(); await p.locator('#appNav [data-section=practice]').click();
  await p.locator('.subtabs [data-pane=arrangement]').click(); assert.equal(await p.locator('#studio-arrangement').isVisible(), true);
  await p.locator('button[data-mode=song]').click(); assert.equal(await p.evaluate(() => document.body.dataset.section), 'song');
  await p.reload(); await p.waitForFunction(() => !!window.__qa);
  assert.equal(await p.evaluate(() => document.body.dataset.mode), 'song', 'mode is remembered');
});

await scenario('Song: playing along shows early/late live and a whole-song report against the song hits', async p => {
  await p.locator('button[data-mode=song]').click(); await songSetup(p);
  await p.locator('#appNav [data-pane=songplay]').click();
  assert.match(await p.locator('#song-play [data-play-info]').textContent(), /Test groove\.mp3 · 16 udaraca bubnja · 0:05/);
  assert.deepEqual(await p.locator('[data-play-backing] option').evaluateAll(list => list.map(o => o.disabled)), [false, false, true], 'no “without drums” audio in this reference');
  await p.locator('[data-play-backing]').selectOption('drums');
  await p.locator('#playBtn').click();
  await p.waitForFunction(() => __qa.songPractice.active);
  assert.equal(await p.locator('#playBtn').textContent(), '■ Stop');
  const start = await p.evaluate(() => __qa.songPractice.perfStart);
  // Kick on time, snare 35 ms late, hi-hat 20 ms early; the last two hi-hats are missed and one extra tom is played.
  const hits = [];
  for (let b = 0; b < 8; b++) {
    const at = start + (500 + b * 500);
    hits.push([b % 2 ? 38 : 36, at + (b % 2 ? 35 : 0)]);
    if (b < 6) hits.push([42, at - 20]);
  }
  hits.push([48, start + 4300]);
  for (const [note, at] of hits.slice(0, 6)) {
    await p.waitForFunction(at => performance.now() >= at, at);
    await p.evaluate(([note, at]) => __port.onmidimessage({ data: [153, note, 100], timeStamp: at }), [note, at]);
  }
  const meter = await p.locator('[data-song-value]').textContent();
  assert.match(meter, /Kasniš|Žuriš|U tempu/);
  await p.locator('#songStage').screenshot({ path: artifacts + 'song-stage.png' });
  for (const [note, at] of hits.slice(6)) await p.evaluate(([note, at]) => __port.onmidimessage({ data: [153, note, 100], timeStamp: at }), [note, at]);
  await p.waitForFunction(() => !__qa.songPractice.active, null, { timeout: 15000 });
  assert.equal(await p.locator('#song-report').isVisible(), true);
  const cards = await p.locator('#song-report .song-card strong').allTextContents();
  assert.deepEqual(cards.slice(3), ['14/16', '2', '1'], 'matched, missed and extra');
  assert.match(cards[1], /Kasniš|U tempu|Žuriš/);
  assert.equal(await p.locator('#song-report .song-windows .song-window').count(), 3, 'one column per bar: 4.5 s at 2 s per bar');
  assert.equal(await p.locator('#song-report .song-lanes circle[fill]').count(), 14);
  assert.equal(await p.locator('#song-report .song-lanes .song-missed').count(), 2);
  assert.equal(await p.locator('#song-report .song-lanes .song-extra').count(), 1);
  assert.match(await p.locator('.song-families').textContent(), /Doboš4\/4Kasniš 35 ms/);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('drummer.songRuns.v1')));
  assert.equal(saved.length, 1); assert.equal(saved[0].backing, 'drums');
  await p.locator('#song-report').screenshot({ path: artifacts + 'song-report.png' });
  await p.locator('[data-lane=next]').click(); assert.match(await p.locator('[data-lane-label]').textContent(), /takt 2–3/, 'the last window stays inside the 3-bar song');
});

await scenario('Song: count-in, half speed and a pattern cannot start during the song', async p => {
  await p.locator('button[data-mode=song]').click(); await songSetup(p, { countIn: true });
  await p.locator('#appNav [data-pane=songplay]').click(); await p.locator('[data-play-rate]').selectOption('0.5');
  const before = await p.evaluate(() => { document.activeElement.blur(); return performance.now(); });
  await p.keyboard.press('Space'); await p.waitForFunction(() => __qa.songPractice.active);
  const start = await p.evaluate(() => __qa.songPractice.perfStart);
  assert.ok(start - before > 3000, 'four clicks at 60 effective BPM before the first beat');
  assert.equal(await p.evaluate(() => __qa.start()), false);
  // At 50% a hit 20 ms late in real time is 20 ms late, not 10.
  const first = start + 500 / .5;
  await p.waitForFunction(at => performance.now() >= at, first + 20);
  const result = await p.evaluate(at => __qa.songPractice.hit('kick', 100, at), first + 20);
  assert.ok(Math.abs(result.err - 20) < .5, JSON.stringify(result));
  await p.keyboard.press('Space'); await p.waitForFunction(() => !__qa.songPractice.active);
});

await browser.close();
await writeFile(artifacts + 'results.json', JSON.stringify(results, null, 2));
const failed = results.filter(r => r.status === 'FAIL');
console.log(`${results.length - failed.length}/${results.length} drum-next browser scenarios passed`);
if (failed.length) process.exitCode = 1;
