// Bubnjarska deonica iz MusicXML partiture postaje ritam za vežbu: note se mapiraju na instrumente
// po imenu iz partiture, GM MIDI broju ili položaju na notnom sistemu, pa se poravnavaju na mrežu.
import { INST, blankPattern, slotsPerBeat, totalSlots } from './patterns.js';
import { fileDrumMap } from './midi-file.js';

const kids = (el, name) => [...el.children].filter(child => child.localName === name);
const kid = (el, name) => [...el.children].find(child => child.localName === name);
const num = (el, name, fallback = 0) => { const n = Number(kid(el, name)?.textContent); return Number.isFinite(n) ? n : fallback; };
const STEPS = 'CDEFGAB';

export function drumParts(document) {
  const names = new Map([...document.querySelectorAll('part-list > score-part')].map(p => [p.getAttribute('id'), kid(p, 'part-name')?.textContent?.trim() || '']));
  return [...document.querySelectorAll('score-partwise > part')].map((part, index) => {
    const notes = [...part.querySelectorAll(':scope > measure > note')].filter(n => !kid(n, 'rest'));
    const unpitched = notes.filter(n => kid(n, 'unpitched')).length;
    const percussionClef = [...part.querySelectorAll(':scope > measure > attributes > clef > sign')].some(s => s.textContent.trim() === 'percussion');
    return { id: part.getAttribute('id'), index, name: names.get(part.getAttribute('id')) || `${index + 1}`,
      measures: kids(part, 'measure').length, notes: notes.length, drums: notes.length > 0 && (percussionClef || unpitched >= notes.length / 2) };
  }).filter(p => p.drums);
}

// Ime instrumenta iz partiture (MuseScore, Sibelius, Finale, Dorico) -> Drummer instrument.
// null znači nepoznato ime; '' je udaraljka koje nema u setu (preskoči je, ne pogađaj po položaju).
const AUXILIARY = /cow ?bell|tambourin|clap|shaker|triangle|wood ?block|temple|conga|bongo|timbal|guiro|güiro|cabasa|maraca|clave|agogo|vibra ?slap|whistle|cuica|castanet|jingle|sleigh|chime|gong|tam-?tam/;
export function instrumentFromName(name = '') {
  const n = name.toLowerCase();
  if (AUXILIARY.test(n)) return '';
  if (/hi-?hat|\bhh\b|charleston/.test(n)) return /pedal|foot|nog/.test(n) ? 'hhp' : /open|otvor|half/.test(n) ? 'hho' : 'hh';
  if (/side.?stick|cross.?stick|rim.?click|cross-stick/.test(n)) return 'xstick';
  if (/rim.?shot/.test(n)) return 'rimshot';
  if (/snare|doboš|dobos|caisse claire|kleine trommel|rullante/.test(n)) return 'snare';
  if (/bass drum|kick|\bbd\b|grosse caisse|große trommel|gran cassa|bas bubanj/.test(n)) return 'kick';
  if (/bell|zvono/.test(n) && /ride|bell/.test(n) && !/cow/.test(n)) return 'bell';
  if (/ride/.test(n)) return 'ride';
  if (/crash|splash|china|chinese/.test(n)) return /\b2\b|\bii\b/.test(n) ? 'crash2' : 'crash';
  if (/floor|podni/.test(n)) return 'tom3';
  if (/tom/.test(n)) return /high|\bhi\b|hi-/.test(n) ? 'tom1' : /mid|low/.test(n) ? 'tom2' : 'tom1';
  return null;
}

// GM broj iz <midi-unpitched> (1-128 u MusicXML-u). U GM-u je 40 električni dobos (ne rimshot kao na TD-17),
// 58 vibraslap, a 39, 54, 56 i 60-81 su ručne i latino udaraljke.
const GM = { ...fileDrumMap(), 40: 'snare', 58: '' };
for (const n of [39, 54, 56]) GM[n] = '';
for (let n = 60; n <= 81; n++) GM[n] = '';
export const instrumentFromMidi = note => Number.isInteger(note) && Object.hasOwn(GM, note) ? GM[note] : null;

// Standardni bubnjarski zapis: pozicija na liniji/razmaku i glava note.
export function instrumentFromDisplay(step, octave, notehead = 'normal') {
  const index = Number(octave) * 7 + STEPS.indexOf(step);
  if (!Number.isFinite(index) || STEPS.indexOf(step) < 0) return null;
  const pos = 38 - index, x = /x|cross/.test(notehead), diamond = notehead === 'diamond';
  if (pos <= -3) return 'crash2';
  if (pos === -2) return 'crash';
  if (pos === -1) return /circle/.test(notehead) ? 'hho' : 'hh';
  if (pos === 0) return diamond ? 'bell' : 'ride';
  if (pos === 1) return x ? 'crash' : 'tom1';
  if (pos === 2) return 'tom2';
  if (pos === 3) return x ? 'xstick' : 'snare';
  if (pos === 4) return 'tom2';
  if (pos === 5 || pos === 6) return 'tom3';
  if (pos === 7 || pos === 8) return 'kick';
  if (pos >= 9) return 'hhp';
  return null;
}

function partOf(document, partId) {
  const part = [...document.querySelectorAll('score-partwise > part')].find(p => p.getAttribute('id') === partId);
  if (!part) throw new Error('Izabrana bubnjarska deonica ne postoji u partituri.');
  return part;
}

// Ključ za mapiranje: instrument iz partiture ako ga nota navodi, inače položaj i glava note.
export function drumKeys(document, partId) {
  const part = partOf(document, partId), score = [...document.querySelectorAll('part-list > score-part')].find(p => p.getAttribute('id') === partId);
  const defs = new Map();
  for (const si of score ? kids(score, 'score-instrument') : []) defs.set(si.getAttribute('id'), { name: kid(si, 'instrument-name')?.textContent?.trim() || '', midi: null });
  for (const mi of score ? kids(score, 'midi-instrument') : []) {
    const def = defs.get(mi.getAttribute('id')); const n = Number(kid(mi, 'midi-unpitched')?.textContent);
    if (def && Number.isFinite(n)) def.midi = n - 1;
  }
  const keys = new Map();
  for (const note of part.querySelectorAll(':scope > measure > note')) {
    if (kid(note, 'rest')) continue;
    const key = noteKey(note);
    if (!key) continue;
    const entry = keys.get(key.id) || { ...key, ...(defs.get(key.instrument) || {}), count: 0 };
    entry.count++; keys.set(key.id, entry);
  }
  return [...keys.values()].map(k => ({ ...k, suggested: instrumentFromName(k.name) ?? instrumentFromMidi(k.midi) ?? instrumentFromDisplay(k.step, k.octave, k.notehead) ?? '' }))
    .sort((a, b) => b.count - a.count);
}

function noteKey(note) {
  const display = kid(note, 'unpitched') || kid(note, 'pitch'), notehead = kid(note, 'notehead')?.textContent?.trim() || 'normal';
  const step = display && (kid(display, 'display-step') || kid(display, 'step'))?.textContent?.trim();
  const octave = display && (kid(display, 'display-octave') || kid(display, 'octave'))?.textContent?.trim();
  const instrument = kid(note, 'instrument')?.getAttribute('id') || '';
  if (!instrument && !step) return null;
  // Isti instrument na drugom mestu ili sa drugom glavom ostaje poseban red mape (npr. jedan "Drumset" instrument za sve).
  return { id: `${instrument}|${step || ''}${octave || ''}|${notehead}`, instrument, step, octave, notehead };
}

const quarterTempo = (direction) => {
  const sound = direction.localName === 'sound' ? direction : direction.querySelector('sound');
  const tempo = Number(sound?.getAttribute('tempo'));
  if (Number.isFinite(tempo) && tempo > 0) return tempo;
  const metronome = direction.querySelector('metronome');
  const perMinute = Number(metronome && kid(metronome, 'per-minute')?.textContent);
  if (!metronome || !Number.isFinite(perMinute) || perMinute <= 0) return null;
  const unit = { whole: 4, half: 2, quarter: 1, eighth: .5, '16th': .25 }[kid(metronome, 'beat-unit')?.textContent?.trim()] || 1;
  return perMinute * unit * (kid(metronome, 'beat-unit-dot') ? 1.5 : 1);
};

// Čita sve takte deonice: vreme svake note u četvrtinama od početka takta, uz meru i tempo koji važe.
function readMeasures(part) {
  let divisions = 1, beats = 4, beatType = 4, bpm = null;
  return kids(part, 'measure').map((measure, index) => {
    const events = []; let cursor = 0, last = 0, tremolo = 0, tied = 0, grace = 0;
    for (const child of measure.children) {
      if (child.localName === 'attributes') {
        divisions = num(child, 'divisions', divisions) || divisions;
        const time = kid(child, 'time');
        if (time && kid(time, 'beats')) { beats = Number(kid(time, 'beats').textContent); beatType = Number(kid(time, 'beat-type')?.textContent); }
      } else if (child.localName === 'direction' || child.localName === 'sound') {
        bpm = quarterTempo(child) ?? bpm;
      } else if (child.localName === 'backup') cursor = Math.max(0, cursor - num(child, 'duration'));
      else if (child.localName === 'forward') cursor += num(child, 'duration');
      else if (child.localName === 'note') {
        const chord = !!kid(child, 'chord'), duration = num(child, 'duration');
        const start = chord ? last : cursor;
        if (kid(child, 'grace') || kid(child, 'cue')) { grace++; continue; }
        if (!chord) { last = cursor; cursor += duration; }
        if (kid(child, 'rest')) continue;
        const ties = kids(child, 'tie').map(t => t.getAttribute('type'));
        if (ties.includes('stop') && !ties.includes('start')) { tied++; continue; }
        const key = noteKey(child); if (!key) continue;
        const notations = kid(child, 'notations'), articulations = notations && kid(notations, 'articulations');
        if (notations?.querySelector('tremolo')) tremolo++;
        const accent = !!articulations && (kid(articulations, 'accent') || kid(articulations, 'strong-accent'));
        const ghost = kid(child, 'notehead')?.getAttribute('parentheses') === 'yes';
        events.push({ quarter: start / divisions, key: key.id, dyn: accent ? 3 : ghost ? 1 : 2 });
      }
    }
    return { index, number: measure.getAttribute('number') || String(index + 1), beats, beatType, bpm, events, tremolo, tied, grace };
  });
}

export function drumPartToPattern(document, { partId, from = 1, bars = 1, map = {}, quantize = 'auto', name = '' } = {}) {
  const measures = readMeasures(partOf(document, partId));
  from = Math.max(1, Math.min(measures.length, Math.round(from) || 1));
  bars = Math.max(1, Math.min(8, Math.round(bars) || 1, measures.length - from + 1));
  const selected = measures.slice(from - 1, from - 1 + bars), first = selected[0];
  if (first.beats < 2 || first.beats > 7 || ![4, 8].includes(first.beatType))
    throw new Error(`Mera ${first.beats}/${first.beatType} nije podržana. Izaberi deo sa merom od 2 do 7 doba, /4 ili /8.`);
  if (selected.some(m => m.beats !== first.beats || m.beatType !== first.beatType))
    throw new Error('Izabrani deo menja meru. Skrati deo ili pomeri početak posle promene.');
  const all = selected.flatMap(m => m.events);
  const error = per => all.reduce((sum, e) => sum + Math.abs(e.quarter * per - Math.round(e.quarter * per)), 0);
  const division = quantize === '12' || (quantize === 'auto' && all.length && error(3) < error(4) * .5) ? 12 : 16;
  const tempo = first.bpm;
  const p = blankPattern({ name: name || 'Bubnjevi iz partiture', bars, beats: first.beats, beatUnit: first.beatType, division, bpm: tempo || 100 });
  const perQuarter = slotsPerBeat(p) * p.beatUnit / 4, perBar = totalSlots(p) / bars;
  let imported = 0, ignored = 0, collisions = 0, outside = 0;
  selected.forEach((measure, bar) => {
    for (const e of measure.events) {
      const inst = map[e.key];
      if (!Object.hasOwn(INST, inst)) { ignored++; continue; }
      const step = Math.round(e.quarter * perQuarter);
      if (step < 0 || step >= perBar) { outside++; continue; }
      const slot = bar * perBar + step;
      if (p.steps[inst][slot]) collisions++;
      p.steps[inst][slot] = Math.max(p.steps[inst][slot], e.dyn); imported++;
    }
  });
  const sum = key => selected.reduce((n, m) => n + m[key], 0);
  return { pattern: p, imported, ignored, collisions, outside, tremolo: sum('tremolo'), tied: sum('tied'), grace: sum('grace'),
    measures: measures.length, from, bars, bpm: p.bpm, tempoFound: !!tempo, clampedTempo: !!tempo && Math.round(tempo) !== p.bpm };
}
