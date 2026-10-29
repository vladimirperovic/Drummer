import { INST, blankPattern, totalSlots, slotsPerBeat, slotOffsetMs, slotAtMs, barMs } from './patterns.js';

// Capture uses the same musical clock as playback. Quantization never changes
// the original timestamps, and never wraps an end-of-take hit onto bar one.
export function quantizeTake(hits, options = {}) {
  const modes = options.quantize === 'auto' ? ['8', '16', '12'] : [String(options.quantize || '16')];
  const candidates = modes.map(mode => {
    const pattern = blankPattern({ ...options, id: null, preset: false, division: mode === '12' ? 12 : 16 });
    const step = mode === '8' ? 2 : 1, count = totalSlots(pattern), duration = barMs(pattern) * pattern.bars;
    const accepted = [], rejected = []; let collisions = 0;
    for (const h of hits) {
      if (!h || !Object.hasOwn(INST,h.inst) || !Number.isFinite(h.timeMs)) { rejected.push(h); continue; }
      const time = h.timeMs - (Number(options.calib) || 0), raw = slotAtMs(pattern, time) / step;
      const choices = [Math.floor(raw) * step, Math.ceil(raw) * step];
      const slot = 0 + choices.sort((a, b) => Math.abs(slotOffsetMs(pattern, a) - time) - Math.abs(slotOffsetMs(pattern, b) - time))[0];
      if (slot < 0 || slot >= count || time > duration) { rejected.push(h); continue; }
      const velocity = Math.max(1, Math.min(127, Number(h.vel) || 92)), dyn = velocity >= 108 ? 3 : velocity <= 45 ? 1 : 2;
      if (pattern.steps[h.inst][slot]) collisions++;
      pattern.steps[h.inst][slot] = Math.max(pattern.steps[h.inst][slot], dyn);
      accepted.push({ ...h, slot, adjustedTimeMs: time, errorMs: time - slotOffsetMs(pattern, slot), dyn });
    }
    const meanErrorMs = accepted.length ? accepted.reduce((sum, h) => sum + Math.abs(h.errorMs), 0) / accepted.length : 0;
    const beat = 60000 / pattern.bpm;
    // Prefer the simpler grid if two explanations fit almost equally well.
    const penalty = mode === '8' ? 0 : mode === '16' ? beat * .02 : beat * .025;
    return { pattern, accepted, rejected, collisions, meanErrorMs, mode,
      score: meanErrorMs + penalty + rejected.length * beat + collisions * beat * .03,
      gridMs: beat / slotsPerBeat({ ...pattern, beatUnit: 4 }) * step };
  });
  return candidates.sort((a, b) => a.score - b.score)[0];
}
