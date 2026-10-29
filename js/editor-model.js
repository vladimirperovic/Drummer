import { INSTRUMENTS, INST, normalize, slotsPerBar, slotsPerBeat, totalSlots } from './patterns.js';

const snapshot = pattern => structuredClone(normalize(pattern));
const key = pattern => JSON.stringify(normalize(pattern));
const rangeError = () => { throw new Error('Izaberi važeći opseg taktova.'); };

// History contains complete patterns, including metadata and original dynamics.
// Transactions retain only their initial state until end(), so a recording or
// paint gesture consumes one history entry instead of one entry per hit.
export class PatternHistory {
  constructor(pattern, { limit = 100, saved = true } = {}) {
    this.limit = Math.max(1, Math.min(200, Number(limit) || 100));
    this.reset(pattern, { saved });
  }
  reset(pattern, { saved = true } = {}) {
    this.current = snapshot(pattern); this.past = []; this.future = []; this.depth = 0; this.label = '';
    this.savedKey = saved ? key(this.current) : null;
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  isDirty(pattern = this.current) { return this.savedKey !== key(pattern); }
  hasChanges(pattern) { return key(pattern) !== key(this.current); }
  capture(pattern, label = '') {
    if (this.depth || key(pattern) === key(this.current)) return false;
    this.past.push({ pattern: this.current, label });
    if (this.past.length > this.limit) this.past.shift();
    this.current = snapshot(pattern); this.future = []; return true;
  }
  begin(pattern = this.current, label = '') {
    if (!this.depth) { this.capture(pattern); this.label = label; }
    this.depth++;
  }
  end(pattern = this.current) {
    if (!this.depth) return this.capture(pattern);
    if (--this.depth) return false;
    return this.capture(pattern, this.label);
  }
  cancel() { this.depth = 0; return snapshot(this.current); }
  undo() {
    if (this.depth || !this.canUndo) return null;
    const previous = this.past.pop(); this.future.push({ pattern: this.current, label: previous.label });
    this.current = previous.pattern; return snapshot(this.current);
  }
  redo() {
    if (this.depth || !this.canRedo) return null;
    const next = this.future.pop(); this.past.push({ pattern: this.current, label: next.label });
    this.current = next.pattern; return snapshot(this.current);
  }
  markSaved(pattern) {
    // Save As establishes a new document identity. An ordinary save keeps its
    // undo chain, and returning to the saved content clears the dirty marker.
    if (pattern.id !== this.current.id) { this.reset(pattern); return; }
    while (this.depth) this.end(pattern);
    this.capture(pattern); this.savedKey = key(pattern);
  }
}

export function copyBars(pattern, from, to) {
  const p = snapshot(pattern);
  if (![from, to].every(Number.isInteger) || from < 1 || to < from || to > p.bars) rangeError();
  const size = slotsPerBar(p), begin = (from - 1) * size, end = to * size;
  return { version: 1, bars: to - from + 1, beats: p.beats, beatUnit: p.beatUnit, division: p.division,
    swing: p.swing, groups: [...p.groups],
    steps: Object.fromEntries(INSTRUMENTS.map(inst => [inst.id, p.steps[inst.id].slice(begin, end)])),
    sticking: p.sticking.padEnd(totalSlots(p), ' ').slice(begin, end) };
}

export function pasteBars(pattern, clipboard, start) {
  const p = snapshot(pattern);
  if (!clipboard || clipboard.version !== 1 || !Number.isInteger(clipboard.bars) || clipboard.bars < 1 || clipboard.bars > 8) throw new Error('Prvo kopiraj taktove.');
  if (!Number.isInteger(start) || start < 1 || start + clipboard.bars - 1 > 8) throw new Error('Lepljenje može obuhvatiti najviše osam taktova.');
  if (p.beats !== clipboard.beats || p.beatUnit !== clipboard.beatUnit || p.division !== clipboard.division || p.swing !== clipboard.swing)
    throw new Error('Za lepljenje uskladi meru, podelu i swing sa kopiranim taktovima.');
  const size = slotsPerBar(p), length = clipboard.bars * size, offset = (start - 1) * size;
  if (!clipboard.steps || INSTRUMENTS.some(inst => !Array.isArray(clipboard.steps[inst.id]) || clipboard.steps[inst.id].length !== length)) throw new Error('Kopirani taktovi nisu ispravni.');
  const result = normalize({ ...p, bars: Math.max(p.bars, start + clipboard.bars - 1) });
  for (const inst of INSTRUMENTS) result.steps[inst.id].splice(offset, length, ...clipboard.steps[inst.id]);
  const hands = result.sticking.padEnd(totalSlots(result), ' ').split('');
  hands.splice(offset, length, ...(clipboard.sticking || '').padEnd(length, ' ').slice(0, length));
  result.sticking = hands.join('').trimEnd();
  return normalize(result);
}

export const RUDIMENTS = {
  single: 'RL', double: 'RRLL', paradiddle: 'RLRRLRLL', doubleParadiddle: 'RLRLRRLRLRLL', sixStroke: 'RLLRRL',
};

export function generatePattern(template, options = {}) {
  const kind = options.kind === 'fill' ? 'fill' : 'rudiment';
  const difficulty = ['easy', 'medium', 'hard'].includes(options.difficulty) ? options.difficulty : 'medium';
  const orchestration = ['snare', 'split', 'around', 'linear'].includes(options.orchestration) ? options.orchestration : 'snare';
  const accent = ['beat', 'cycle', 'right', 'left', 'offbeat', 'none'].includes(options.accent) ? options.accent : 'beat';
  const custom = String(options.sticking || '').toUpperCase().replace(/\s/g, '');
  if (custom && (!/^[RL]+$/.test(custom) || custom.length > 32)) throw new Error('Ruke unesi kao niz R/L, najviše 32 udarca.');
  let sequence = custom || RUDIMENTS[options.rudiment] || RUDIMENTS.single;
  if (sequence[0] !== (options.lead === 'L' ? 'L' : 'R')) sequence = sequence.replace(/[RL]/g, hand => hand === 'R' ? 'L' : 'R');
  const active = new Set((options.instruments || INSTRUMENTS.map(inst => inst.id)).filter(id => Object.hasOwn(INST, id)));
  const snare = active.has('snare') ? 'snare' : [...active].find(id => INST[id].voice === 'up');
  if (!snare) throw new Error('Uključi bar jedan ručni instrument za generator.');
  const right = active.has(options.right) ? options.right : active.has('hh') ? 'hh' : snare;
  const left = active.has(options.left) ? options.left : snare;
  const around = [snare, 'tom1', 'tom2', 'tom3', 'tom4', 'floor2'].filter((id, index, list) => active.has(id) && list.indexOf(id) === index);
  const variant = Math.max(0, Math.floor(Number(options.variant) || 0));
  const p = normalize({ ...template, id: null, preset: false, name: options.name || (kind === 'fill' ? 'Generisani prelaz' : 'Generisani rudiment'),
    bars: options.bars ?? template.bars, steps: {}, sticking: '' });
  // A generated exercise is original content, not a renamed catalog entry.
  for (const field of ['nameEn', 'lesson', 'lessonEn', 'category', 'difficulty']) delete p[field];
  const spb = slotsPerBeat(p), total = totalSlots(p), hands = Array(total).fill(' ');
  const stride = difficulty === 'easy' ? (spb === 3 ? 3 : 2) : 1;
  let hit = 0;
  for (let slot = 0; slot < total; slot += stride) {
    // Advanced fills introduce a deterministic displaced rest. Changing the
    // variation moves the opening without losing the selected sticking order.
    if (kind === 'fill' && difficulty === 'hard' && (slot + variant) % (spb * 2) === spb - 1) continue;
    const hand = sequence[hit % sequence.length];
    const isFoot = orchestration === 'linear' && active.has('kick') && (hit + variant) % 4 === 3;
    const inst = isFoot ? 'kick' : orchestration === 'split' ? (hand === 'R' ? right : left)
      : orchestration === 'around' || kind === 'fill' && orchestration === 'linear'
        ? around[(Math.floor(hit / (difficulty === 'easy' ? 2 : 4)) + variant) % around.length] : snare;
    const accented = accent === 'beat' ? slot % spb === 0 : accent === 'cycle' ? hit % sequence.length === 0
      : accent === 'right' ? hand === 'R' : accent === 'left' ? hand === 'L' : accent === 'offbeat' ? slot % spb === Math.floor(spb / 2) : false;
    p.steps[inst][slot] = accented ? 3 : difficulty === 'hard' || variant > 0 && (hit + variant) % 5 === 0 ? 1 : 2;
    if (!isFoot) hands[slot] = hand;
    hit++;
  }
  p.sticking = hands.join('').trimEnd();
  return p;
}
