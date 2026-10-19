// Instrumenti, model ritma i gotovi ritmovi.
//
// Ritam je mreža: za svaki instrument niz jačina po koraku (0 nema, 1 ghost, 2 normalno, 3 akcenat).
// division 16 = šesnaestine (4 koraka po dobi), 12 = osminske triole (3 koraka po dobi).

// pos: položaj na notnom sistemu u polovinama razmaka, 0 = gornja linija (F5), raste naniže.
// midiIn: note koje TD-17 šalje po fabričkim podešavanjima, midiOut: GM nota za slanje ritma.
export const INSTRUMENTS = [
  { id: 'crash', label: 'Crash', pos: -2, head: 'x', voice: 'up', midiIn: [49, 55, 57, 52], midiOut: 49, color: '#f4c95d', keys: ['KeyE'], target: 'crash' },
  { id: 'ride', label: 'Ride', pos: 0, head: 'x', voice: 'up', midiIn: [51, 59], midiOut: 51, color: '#f0a35e', keys: ['KeyI'], target: 'ride' },
  { id: 'bell', label: 'Ride zvono', pos: 0, head: 'diamond', voice: 'up', midiIn: [53], midiOut: 53, color: '#e8b07a', keys: ['KeyO'], target: 'bell' },
  { id: 'hh', label: 'Hi-hat zatvoren', pos: -1, head: 'x', voice: 'up', midiIn: [42, 22], midiOut: 42, color: '#5fd0f0', keys: ['KeyD', 'KeyK'], target: 'hihat' },
  { id: 'hho', label: 'Hi-hat otvoren', pos: -1, head: 'x', open: true, voice: 'up', midiIn: [46, 26], midiOut: 46, color: '#4dabf7', keys: ['KeyS'], target: 'hihat' },
  { id: 'tom1', label: 'Tom 1', pos: 1, head: 'normal', voice: 'up', midiIn: [48, 50], midiOut: 48, color: '#9c8cff', keys: ['KeyG'], target: 'tom1' },
  { id: 'tom2', label: 'Tom 2', pos: 2, head: 'normal', voice: 'up', midiIn: [45, 47], midiOut: 45, color: '#b98cf0', keys: ['KeyH'], target: 'tom2' },
  { id: 'snare', label: 'Dobos', pos: 3, head: 'normal', voice: 'up', midiIn: [38, 40], midiOut: 38, color: '#ff6b6b', keys: ['KeyF', 'KeyJ'], target: 'snare' },
  { id: 'xstick', label: 'Cross-stick', pos: 3, head: 'circlex', voice: 'up', midiIn: [37], midiOut: 37, color: '#ff9e9e', keys: ['KeyC'], target: 'rim' },
  { id: 'tom3', label: 'Floor tom', pos: 5, head: 'normal', voice: 'up', midiIn: [43, 58], midiOut: 43, color: '#cf7dff', keys: ['KeyL'], target: 'tom3' },
  { id: 'kick', label: 'Kick', pos: 7, head: 'normal', voice: 'down', midiIn: [36], midiOut: 36, color: '#ffa94d', keys: ['KeyV', 'KeyB', 'KeyN'], target: 'kick' },
  { id: 'hhp', label: 'Hi-hat nogom', pos: 9, head: 'x', voice: 'down', midiIn: [44], midiOut: 44, color: '#74c0fc', keys: ['KeyA'], target: 'hhpedal' },
];
export const INST = Object.fromEntries(INSTRUMENTS.map(i => [i.id, i]));
export const DYN_VEL = [0, 40, 92, 122];

export const slotsPerBeat = p => (p.division === 12 ? 3 : 4);
export const slotsPerBar = p => p.beats * slotsPerBeat(p);
export const totalSlots = p => p.bars * slotsPerBar(p);

const clampDyn = v => (v >= 1 && v <= 3 ? Math.round(v) : 0);

export function normalize(p) {
  const q = { name: 'Novi ritam', bpm: 90, beats: 4, bars: 1, division: 16, sticking: '', ...p };
  q.bars = Math.min(8, Math.max(1, q.bars | 0));
  q.beats = Math.min(7, Math.max(2, q.beats | 0));
  q.division = q.division === 12 ? 12 : 16;
  q.bpm = Math.min(260, Math.max(30, Math.round(q.bpm) || 90));
  const n = totalSlots(q);
  const steps = {};
  for (const inst of INSTRUMENTS) {
    const src = p.steps?.[inst.id] || [];
    steps[inst.id] = Array.from({ length: n }, (_, i) => clampDyn(src[i]));
  }
  return { ...q, steps };
}

export const blankPattern = (over = {}) => normalize({ id: null, ...over });

// Mijenja broj taktova, doba ili podjelu, a postojeće udarce prenosi na najbliži korak.
export function resize(p, { bars = p.bars, beats = p.beats, division = p.division }) {
  const q = normalize({ ...p, bars, beats, division, steps: {} });
  const oldSpb = slotsPerBeat(p), newSpb = slotsPerBeat(q);
  const oldBar = slotsPerBar(p), newBar = slotsPerBar(q);
  for (const inst of INSTRUMENTS) {
    p.steps[inst.id].forEach((v, i) => {
      if (!v) return;
      const bar = Math.floor(i / oldBar), inBar = i % oldBar;
      const beat = Math.floor(inBar / oldSpb), sub = Math.round(((inBar % oldSpb) * newSpb) / oldSpb);
      if (bar >= q.bars || beat >= q.beats || sub >= newSpb) return;
      const j = bar * newBar + beat * newSpb + sub;
      q.steps[inst.id][j] = Math.max(q.steps[inst.id][j], v);
    });
  }
  q.sticking = division === p.division && beats === p.beats ? p.sticking || '' : '';
  return q;
}

export function patternInfo(p) {
  const div = p.division === 12 ? 'triole' : 'šesnaestine';
  const bars = p.bars === 1 ? '1 takt' : p.bars < 5 ? `${p.bars} takta` : `${p.bars} taktova`;
  return `${p.beats}/4 · ${bars} · ${div} · ${p.bpm} BPM`;
}

// Gotovi ritmovi: '.' nema, 'g' ghost, 'x' normalno, 'X' akcenat; razmaci i | su samo radi čitljivosti.
const CH = { g: 1, x: 2, X: 3 };
function preset(name, opts, tracks) {
  const p = blankPattern({ name, ...opts });
  for (const [id, str] of Object.entries(tracks)) {
    const s = str.replace(/[\s|]/g, '');
    p.steps[id] = p.steps[id].map((_, i) => CH[s[i]] || 0);
  }
  return { ...p, id: 'preset-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), preset: true };
}

export const PRESETS = [
  preset('Osnovni rok', { bpm: 90 }, {
    hh: 'x.x. x.x. x.x. x.x.',
    snare: '.... x... .... x...',
    kick: 'x... .... x... ....',
  }),
  preset('Rok sa duplim kikom', { bpm: 90 }, {
    hh: 'x.x. x.x. x.x. x.x.',
    snare: '.... x... .... x...',
    kick: 'x... ..x. x.x. ....',
  }),
  preset('Šesnaestine na hi-hatu', { bpm: 78 }, {
    hh: 'Xxxx Xxxx Xxxx Xxxx',
    snare: '.... X... .... X...',
    kick: 'x... .... x.x. ....',
  }),
  preset('Disko', { bpm: 112 }, {
    hh: 'x... x... x... x...',
    hho: '..x. ..x. ..x. ..x.',
    snare: '.... x... .... x...',
    kick: 'x... x... x... x...',
  }),
  preset('Half-time', { bpm: 75 }, {
    hh: 'x.x. x.x. x.x. x.x.',
    snare: '.... .... X... ....',
    kick: 'x... ...x .... ..x.',
  }),
  preset('Funk sa ghost notama', { bpm: 86 }, {
    hh: 'x.x. x.x. x.x. x.x.',
    snare: '.... X..g .g.. X..g',
    kick: 'x.x. .... ..x. .x..',
  }),
  preset('Shuffle (triole)', { bpm: 92, division: 12 }, {
    hh: 'x.x x.x x.x x.x',
    snare: '... X.. ... X..',
    kick: 'x.. ... x.. ..x',
  }),
  preset('Jazz ride (triole)', { bpm: 120, division: 12 }, {
    ride: 'x.. x.x x.. x.x',
    hhp: '... x.. ... x..',
  }),
  preset('Four on the floor', { bpm: 122 }, {
    kick: 'x... x... x... x...',
    hho: '..x. ..x. ..x. ..x.',
    snare: '.... x... .... x...',
  }),
  preset('Pop balada (cross-stick)', { bpm: 72 }, {
    hh: 'x.x. x.x. x.x. x.x.',
    xstick: '.... x... .... x...',
    kick: 'x... .... x.x. ....',
  }),
  preset('Bossa nova', { bpm: 130, bars: 2 }, {
    ride: 'x.x. x.x. x.x. x.x. | x.x. x.x. x.x. x.x.',
    xstick: 'x..x ..x. ..x. .x.. | ..x. .x.. x... x...',
    kick: 'x..x x..x x..x x..x | x..x x..x x..x x..x',
    hhp: '.... x... .... x... | .... x... .... x...',
  }),
  preset('Pojedinačni udarci RLRL', { bpm: 70, sticking: 'RLRLRLRLRLRLRLRL' }, {
    snare: 'Xxxx Xxxx Xxxx Xxxx',
    hhp: 'x... x... x... x...',
  }),
  preset('Paradiddle', { bpm: 65, sticking: 'RLRRLRLLRLRRLRLL' }, {
    snare: 'Xxxx Xxxx Xxxx Xxxx',
    hhp: 'x... x... x... x...',
  }),
  preset('Fill niz tomove', { bpm: 85, bars: 2, sticking: ' '.repeat(16) + 'RLRLRLRLRLRLRLRL' }, {
    crash: 'x... .... .... .... | .... .... .... ....',
    hh: '..x. x.x. x.x. x.x. | .... .... .... ....',
    snare: '.... x... .... x... | xxxx .... .... ....',
    tom1: '.... .... .... .... | .... xxxx .... ....',
    tom2: '.... .... .... .... | .... .... xxxx ....',
    tom3: '.... .... .... .... | .... .... .... xxxx',
    kick: 'x... .... x... .... | x... x... x... x...',
  }),
];
