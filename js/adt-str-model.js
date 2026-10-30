// ADT_STR tau=0.8, converted and quantized by Coming Undone. Optional weights
// remain CC BY-SA 4.0; see THIRD_PARTY_NOTICES.md and vendor/ADT-STR-NOTICE.txt.
const REVISION = '89a917875e272bb492311624d7536b5e27604a64';
const BASE = `https://huggingface.co/swwallowws/coming-undone-browser-models/resolve/${REVISION}`;
export const ADT_STR_SAMPLE_RATE = 24000;
export const ADT_STR_CHUNK = 61440;
export const ADT_STR_FRAMES = 246;
export const ADT_STR_ASSETS = Object.freeze([
  Object.freeze({ id: 'adt-str-encoder-int8-89a9178', bytes: 35709676,
    url: `${BASE}/adt_encoder.int8.onnx`, sha256: '71f89f6aba1dd74bf2792a9b19f89b4a8ec438362e6429d9578ffd9ea2e5320f' }),
  Object.freeze({ id: 'adt-str-decoder-int8-89a9178', bytes: 37204260,
    url: `${BASE}/adt_decoder.int8.onnx`, sha256: '7e8c7d3dc4013461d7a9ce5cf39043d7a052e68efb053ede3055d59c0d975b3e' }),
]);

// The model uses its own contiguous pitch vocabulary, not GM numbers. Unsupported
// auxiliary percussion remains available for explicit mapping instead of silently
// becoming a snare/cymbal. GM 40 is electric snare, not a TD-17 rimshot.
const VOCABULARY = [
  [35, 'acoustic-kick', 'Akustični bas bubanj', 'kick'], [36, 'kick', 'Bas bubanj', 'kick'],
  [37, 'xstick', 'Cross-stick', 'xstick'], [38, 'snare', 'Akustični doboš', 'snare'],
  [39, 'clap', 'Pljesak', ''], [40, 'electric-snare', 'Električni doboš', 'snare'],
  [41, 'low-tom', 'Duboki tom', 'tom3'], [42, 'hihat-closed', 'Zatvoren hi-hat', 'hh'],
  [44, 'hihat-pedal', 'Hi-hat pedala', 'hhp'], [46, 'hihat-open', 'Otvoren hi-hat', 'hho'],
  [47, 'mid-tom', 'Srednji tom', 'tom2'], [49, 'crash', 'Crash činela', 'crash'],
  [50, 'high-tom', 'Visoki tom', 'tom1'], [51, 'ride', 'Ride činela', 'ride'],
  [52, 'china', 'China činela', 'crash2'], [54, 'tambourine', 'Tamburin', ''],
  [55, 'splash', 'Splash činela', 'crash2'], [56, 'cowbell', 'Kravlje zvono', ''],
  [58, 'vibraslap', 'Vibraslap', ''], [60, 'bongo', 'Bongo', ''],
  [69, 'cabasa', 'Kabasa', ''], [71, 'whistle', 'Zviždaljka', ''],
  [73, 'guiro', 'Guiro', ''], [75, 'claves', 'Klaves', ''],
  [78, 'cuica', 'Kuika', ''], [80, 'triangle', 'Triangl', ''],
];
export const ADT_STR_CLASSES = Object.freeze(VOCABULARY.map(([midi, id, label, inst], index) =>
  Object.freeze({ id, label, inst, midi, pitch: index + 35 })));
export const ADT_STR_MODEL = Object.freeze({
  id: 'adt-str-tau08-int8-89a9178', name: 'ADT_STR · tau 0.8',
  bytes: ADT_STR_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0),
  assets: ADT_STR_ASSETS, classes: ADT_STR_CLASSES, license: 'CC BY-SA 4.0',
  source: 'https://huggingface.co/swwallowws/coming-undone-browser-models',
  sourceUrl: 'https://huggingface.co/swwallowws/coming-undone-browser-models',
  sampleRate: ADT_STR_SAMPLE_RATE, backendPreference: 'wasm', predictsVelocity: true,
});

// Consume complete adjacent onset/pitch/(optional velocity) groups only. This
// avoids aligning a malformed token's pitch with a later onset (zip truncation).
export function decodeAdtStrTokens(tokens, { offsetSeconds = 0, durationSeconds = Infinity } = {}) {
  const events = [], seen = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const token = Number(tokens[i]);
    if (token === 3) break;
    if (!Number.isInteger(token) || token < 4 || token >= 300) continue;
    const pitchToken = Number(tokens[i + 1]), group = ADT_STR_CLASSES[pitchToken - 335];
    if (!group) continue;
    const velocityToken = Number(tokens[i + 2]);
    const velocity = velocityToken >= 400 && velocityToken <= 527 ? Math.max(1, velocityToken - 400) : 100;
    const timeSeconds = offsetSeconds + (token - 4) / 100;
    if (timeSeconds < 0 || timeSeconds >= durationSeconds) continue;
    const key = `${timeSeconds}:${group.id}:${velocity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ timeSeconds, inst: group.inst, velocity, group: group.id, midi: group.midi });
  }
  return events.sort((a, b) => a.timeSeconds - b.timeSeconds || a.midi - b.midi);
}
