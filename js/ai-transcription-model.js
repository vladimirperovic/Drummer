import { INST } from './patterns.js';
import { ADT_STR_MODEL, ADT_STR_CLASSES } from './adt-str-model.js';
export { ADT_STR_MODEL, ADT_STR_CLASSES } from './adt-str-model.js';

export const ADTOF_MODEL = Object.freeze({
  id: 'adtof-frame-rnn-d0e809b', name: 'ADTOF Frame_RNN', bytes: 2171762,
  url: 'https://huggingface.co/thebluescreen/adtof-drums-onnx/resolve/d0e809bb1c1b6fe8a4a00c576852117a0636ab5a/adtof_frame_rnn.onnx',
  sha256: '189ca3c2bc7339a5f0fdc0bb11069d4bcc4fafabd142e945228c368c379b6227',
  license: 'CC BY-NC-SA 4.0', source: 'https://huggingface.co/thebluescreen/adtof-drums-onnx',
});
export const ADTOF_CLASSES = Object.freeze([
  { id: 'kick', label: 'Bas bubanj', inst: 'kick', threshold: .22 },
  { id: 'snare', label: 'Doboš', inst: 'snare', threshold: .24 },
  { id: 'toms', label: 'Tomovi zajedno', inst: 'tom1', threshold: .32 },
  { id: 'hihat', label: 'Hi-hat zajedno', inst: 'hh', threshold: .22 },
  { id: 'cymbals', label: 'Činele zajedno', inst: 'crash', threshold: .30 },
]);
export const ADTOF_SAMPLE_RATE = 44100, ADTOF_FPS = 100;

export const TRANSCRIBER_MODELS = Object.freeze([
  Object.freeze({ ...ADTOF_MODEL, sourceUrl: ADTOF_MODEL.source, assets: Object.freeze([ADTOF_MODEL]),
    classes: ADTOF_CLASSES, sampleRate: ADTOF_SAMPLE_RATE, predictsVelocity: false }),
  ADT_STR_MODEL,
]);
export function getTranscriptionModel(id = ADTOF_MODEL.id) {
  const canonical = id === 'adtof' ? ADTOF_MODEL.id : id === 'adt-str' ? ADT_STR_MODEL.id : id;
  const model = TRANSCRIBER_MODELS.find(entry => entry.id === canonical);
  if (!model) throw new Error('Nepoznat model za transkripciju.');
  return model;
}
export const getTranscriptionClasses = id => getTranscriptionModel(id).classes;

export function transcriptionEvents(result, options = {}) {
  const model = getTranscriptionModel(result?.modelId);
  if (model.id === ADTOF_MODEL.id) return activationEvents(result.activations, { durationSeconds: result.durationSeconds, ...options });
  if (!Array.isArray(result.events)) throw new Error('Neispravan izlaz AI modela.');
  const mapping = options.mapping || {}, duration = Math.min(options.durationSeconds ?? Infinity, result.durationSeconds ?? Infinity);
  return result.events.flatMap(event => {
    const group = model.classes.find(entry => entry.id === event.group);
    const inst = group && (Object.hasOwn(mapping, group.id) ? mapping[group.id] : group.inst);
    if (!inst || !Object.hasOwn(INST, inst) || !Number.isFinite(event.timeSeconds) || event.timeSeconds < 0 || event.timeSeconds >= duration) return [];
    return [{ ...event, inst, velocity: Math.max(1, Math.min(127, Math.round(event.velocity) || 100)) }];
  });
}

// Peak picking uses local mean (100 ms before / 10 ms after), local maximum
// (20 ms before / 10 ms after) and a 20 ms refractory interval. Model confidence
// is retained separately: it is not a prediction of MIDI velocity.
export function activationEvents(activations, { sensitivity = 1, mapping = {}, durationSeconds = Infinity } = {}) {
  if (!(activations instanceof Float32Array) || activations.length % 5 || !activations.every(Number.isFinite)) throw new Error('Neispravan izlaz AI modela.');
  const frames = activations.length / 5, events = [], gain = Math.max(.5, Math.min(2, Number(sensitivity) || 1));
  for (let channel = 0; channel < 5; channel++) {
    const group = ADTOF_CLASSES[channel], inst = Object.hasOwn(mapping, group.id) ? mapping[group.id] : group.inst;
    if (!inst) continue;
    let last = -Infinity;
    for (let frame = 0; frame < frames; frame++) {
      const confidence = activations[frame * 5 + channel];
      if (!Number.isFinite(confidence) || confidence < group.threshold / gain) continue;
      let average = 0, maximum = 0;
      for (let i = frame - 10; i <= frame + 1; i++) average += i >= 0 && i < frames ? activations[i * 5 + channel] : 0;
      average /= 12;
      if (confidence < average + group.threshold / gain) continue;
      for (let i = Math.max(0, frame - 2); i <= Math.min(frames - 1, frame + 1); i++) maximum = Math.max(maximum, activations[i * 5 + channel]);
      if (confidence < maximum || frame - last <= 2 || frame / ADTOF_FPS >= durationSeconds) continue;
      events.push({ timeSeconds: frame / ADTOF_FPS, inst, velocity: 92, confidence, group: group.id }); last = frame;
    }
  }
  return events.sort((a, b) => a.timeSeconds - b.timeSeconds || a.inst.localeCompare(b.inst));
}

export function estimateDrumTempo(events) {
  const times = [...new Set(events.filter(event => ['kick', 'snare'].includes(event.inst)).map(event => event.timeSeconds))].sort((a, b) => a - b);
  if (times.length < 4) return null;
  const scores = new Map();
  for (let i = 0; i < times.length; i++) for (let j = i + 1; j < Math.min(times.length, i + 9); j++) {
    let gap = times[j] - times[i]; if (gap < .12 || gap > 3) continue;
    let bpm = 60 / gap; while (bpm < 70) bpm *= 2; while (bpm > 180) bpm /= 2;
    const rounded = Math.round(bpm); scores.set(rounded, (scores.get(rounded) || 0) + 1 / (j - i));
  }
  let best = null, score = 0;
  for (const bpm of scores.keys()) { const sum = (scores.get(bpm - 1) || 0) + scores.get(bpm) + (scores.get(bpm + 1) || 0); if (sum > score) { best = bpm; score = sum; } }
  return best;
}

// A conventional tempo/meter track keeps exported MIDI useful to a DAW while
// preserving the model's raw onset times (no grid quantization on export).
export function transcriptionMidi(events, { bpm = 120, beats = 4, beatUnit = 4, durationSeconds = 0, noteMap = {} } = {}) {
  bpm = Math.max(30, Math.min(260, Number(bpm) || 120));
  const ppq = 960, microseconds = Math.round(60000000 / bpm), ticksPerSecond = ppq * 1000000 / microseconds;
  const notes = [];
  for (const event of events) {
    const note = noteMap[event.inst] ?? INST[event.inst]?.midiOut;
    if (!Number.isInteger(note) || note < 0 || note > 127 || !Number.isFinite(event.timeSeconds) || event.timeSeconds < 0) continue;
    const tick = Math.round(event.timeSeconds * ticksPerSecond), velocity = Math.max(1, Math.min(127, Math.round(event.velocity || 92)));
    notes.push({ tick, status: 0x99, note, velocity }, { tick: tick + Math.max(1, Math.round(.04 * ticksPerSecond)), status: 0x89, note, velocity: 0 });
  }
  notes.sort((a, b) => a.tick - b.tick || a.status - b.status);
  const vlq = value => { const bytes = [value & 127]; while ((value = Math.floor(value / 128)) > 0) bytes.unshift((value & 127) | 128); return bytes; };
  const track = [0, 255, 81, 3, microseconds >>> 16 & 255, microseconds >>> 8 & 255, microseconds & 255,
    0, 255, 88, 4, Math.max(2, Math.min(7, Math.round(beats))), beatUnit === 8 ? 3 : 2, 24, 8];
  let last = 0;
  for (const note of notes) { track.push(...vlq(note.tick - last), note.status, note.note, note.velocity); last = note.tick; }
  track.push(...vlq(Math.max(0, Math.round(durationSeconds * ticksPerSecond) - last)), 255, 47, 0);
  const output = new Uint8Array(22 + track.length), view = new DataView(output.buffer);
  output.set([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, ppq >> 8, ppq & 255, 77, 84, 114, 107]);
  view.setUint32(18, track.length); output.set(track, 22); return output;
}
