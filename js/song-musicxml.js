import { INSTRUMENTS, INST } from './patterns.js';

const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

// A whole-song score, independent of the editor's eight-bar pattern limit.
// Quantization only affects this score. Projects retain the original event times.
export function songMusicXml({ events, fileName = 'Drums', durationSeconds, bpm = 120, meter = { beats: 4, beatUnit: 4 }, division = 16, offsetSeconds = 0 }) {
  const { beats, beatUnit } = meter;
  if (!Array.isArray(events) || events.length > 100000 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 600 ||
      !Number.isFinite(bpm) || bpm < 30 || bpm > 260 || !Number.isInteger(beats) || beats < 2 || beats > 12 || ![4, 8].includes(beatUnit) ||
      ![12, 16].includes(division) || !Number.isFinite(offsetSeconds) || offsetSeconds < 0 || offsetSeconds >= durationSeconds) throw new Error('Invalid song score');
  const perBeat = division === 12 ? 3 : beatUnit === 8 ? 2 : 4;
  const slots = beats * perBeat, slotSeconds = 60 / bpm * 4 / beatUnit / perBeat;
  const unit = 480 * 4 / beatUnit / perBeat;
  // Preserve any lead-in hits in full preceding measures; the selected first
  // downbeat remains a bar boundary, including when it is not at audio time zero.
  const leadBars = Math.ceil(offsetSeconds / (slots * slotSeconds) - 1e-9);
  const origin = offsetSeconds - leadBars * slots * slotSeconds;
  const bars = Math.max(1, Math.ceil((durationSeconds - origin) / (slots * slotSeconds) - 1e-9));
  const grid = new Map();
  for (const event of events) {
    if (!event || !Object.hasOwn(INST, event.inst) || !Number.isFinite(event.timeSeconds) || event.timeSeconds < 0 || event.timeSeconds >= durationSeconds) throw new Error('Invalid drum event');
    const slot = Math.min(bars * slots - 1, Math.max(0, Math.round((event.timeSeconds - origin) / slotSeconds)));
    if (!grid.has(slot)) grid.set(slot, new Map());
    const group = grid.get(slot), previous = group.get(event.inst);
    if (!previous || (event.velocity || 92) > (previous.velocity || 92)) group.set(event.inst, event);
  }
  const used = new Set(events.map(e => e.inst));
  const instruments = INSTRUMENTS.filter(inst => used.has(inst.id));
  const partList = instruments.map(inst => `<score-instrument id="P1-${inst.id}"><instrument-name>${xml(inst.label)}</instrument-name></score-instrument>`).join('') +
    instruments.map(inst => `<midi-instrument id="P1-${inst.id}"><midi-channel>10</midi-channel><midi-unpitched>${inst.midiOut + 1}</midi-unpitched></midi-instrument>`).join('');
  const measures = [];
  const durationNotation = length => {
    const quarter = length * unit / 480;
    if (quarter === 1) return '<type>quarter</type>';
    if (quarter === .5) return '<type>eighth</type>';
    if (quarter === .75) return '<type>eighth</type><dot/>';
    if (quarter === .25) return '<type>16th</type>';
    const type = beatUnit === 4 ? (length === 2 ? 'quarter' : 'eighth') : (length === 2 ? 'eighth' : '16th');
    return `<type>${type}</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>`;
  };
  for (let bar = 0; bar < bars; bar++) {
    let body = bar === 0 ? `<attributes><divisions>480</divisions><time><beats>${beats}</beats><beat-type>${beatUnit}</beat-type></time><clef><sign>percussion</sign></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>` : '';
    for (let slot = 0; slot < slots;) {
      const hits = [...(grid.get(bar * slots + slot)?.values() || [])];
      // Extend to the next attack or beat boundary: readable rests and beams,
      // without ties that could imply a second percussion attack.
      let length = 1;
      while ((slot + length) % perBeat && !grid.has(bar * slots + slot + length)) length++;
      const duration = length * unit, notation = durationNotation(length);
      if (!hits.length) { body += `<note><rest/><duration>${duration}</duration><voice>1</voice>${notation}</note>`; slot += length; continue; }
      hits.forEach((event, index) => {
        const inst = INST[event.inst], pos = 38 - inst.pos, step = 'CDEFGAB'[pos % 7], octave = Math.floor(pos / 7);
        const velocity = Math.max(1, Math.min(127, Number(event.velocity) || 92));
        const head = inst.open ? 'circle-x' : inst.head === 'diamond' ? 'diamond' : ['x', 'circlex', 'rimshot'].includes(inst.head) ? 'x' : 'normal';
        body += `<note dynamics="${(velocity / 90 * 100).toFixed(2)}">${index ? '<chord/>' : ''}<unpitched><display-step>${step}</display-step><display-octave>${octave}</display-octave></unpitched><duration>${duration}</duration><instrument id="P1-${inst.id}"/><voice>1</voice>${notation}<stem>up</stem><notehead${velocity < 55 ? ' parentheses="yes"' : ''}>${head}</notehead>${velocity > 108 ? '<notations><articulations><accent/></articulations></notations>' : ''}</note>`;
      });
      slot += length;
    }
    if (bar === bars - 1) body += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
    measures.push(`<measure number="${bar + 1}">${body}</measure>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${xml(fileName)}</work-title></work><identification><encoding><software>Drummer</software></encoding><miscellaneous><miscellaneous-field name="audio-origin-seconds">${origin}</miscellaneous-field><miscellaneous-field name="first-downbeat-seconds">${offsetSeconds}</miscellaneous-field></miscellaneous></identification><part-list><score-part id="P1"><part-name>Drumset</part-name>${partList}</score-part></part-list><part id="P1">${measures.join('\n')}</part></score-partwise>`;
}
