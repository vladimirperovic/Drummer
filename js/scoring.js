// Ocjenjivanje: svaki udarac se uparuje sa najbližom očekivanom notom istog instrumenta.

// [tačno, skoro] u milisekundama
export const LEVELS = { strogo: [15, 45], normalno: [25, 70], lagano: [40, 100] };

// Otvoren i zatvoren hi-hat su isti pad: udarac se računa, a otvorenost je stvar pedale
const SAME_PAD = { hho: 'hh' };
const padKey = id => SAME_PAD[id] || id;

const dynamicsOk = (dyn, vel) => (dyn === 3 ? vel >= 95 : dyn === 1 ? vel <= 55 : vel >= 40 && vel <= 118);

export class Scorer {
  constructor() {
    this.level = 'normalno';
    this.calib = 0;
    this.currentLoop = 0;
    this.reset();
  }

  reset() {
    this.pending = [];
    this.results = [];
    this.loops = new Map();
    this.totals = { good: 0, ok: 0, miss: 0, extra: 0 };
    this.instrumentStats = new Map();
  }

  expect(note) { this.pending.push({ ...note, done: false }); }

  hit(inst, perf, vel) {
    const [good, ok] = LEVELS[this.level];
    const t = perf - this.calib;
    let best = null;
    for (const n of this.pending) {
      if (n.done || padKey(n.inst) !== padKey(inst)) continue;
      const err = t - n.perf;
      if (Math.abs(err) <= ok && (!best || Math.abs(err) < Math.abs(best.err))) best = { n, err };
    }
    if (!best) return this.record({ kind: 'extra', inst, vel, perf: t }, this.currentLoop);
    best.n.done = true;
    return this.record({
      kind: Math.abs(best.err) <= good ? 'good' : 'ok',
      inst: best.n.inst, err: best.err, vel, dynOk: dynamicsOk(best.n.dyn, vel), note: best.n,
    }, best.n.loop);
  }

  // Note kojima je prošao rok, a niko ih nije udario
  sweep(now) {
    const [, ok] = LEVELS[this.level];
    const limit = now - this.calib - ok - 20;
    const missed = [];
    this.pending = this.pending.filter(n => {
      if (n.perf > limit) return true;
      if (!n.done) missed.push(this.record({ kind: 'miss', inst: n.inst, note: n }, n.loop));
      return false;
    });
    return missed;
  }

  record(r, loop) {
    this.results.push(r);
    const s = this.instrumentStats.get(r.inst) || { good: 0, ok: 0, miss: 0, extra: 0, errs: [], vels: [], dynOk: 0, mean: 0, m2: 0 };
    s[r.kind]++; this.totals[r.kind]++;
    if (r.err != null) {
      s.errs.push(r.err); s.vels.push(r.vel); if (r.dynOk) s.dynOk++;
      const delta = r.err - s.mean;
      s.mean += delta / s.errs.length;
      s.m2 += delta * (r.err - s.mean);
    }
    this.instrumentStats.set(r.inst, s);
    const L = this.loops.get(loop) || { good: 0, ok: 0, miss: 0, extra: 0 };
    L[r.kind]++;
    this.loops.set(loop, L);
    return r;
  }

  loopScore(loop) {
    const L = this.loops.get(loop);
    if (!L) return null;
    const expected = L.good + L.ok + L.miss;
    if (!expected) return null;
    return Math.round((100 * (L.good + 0.5 * L.ok)) / (expected + 0.5 * L.extra));
  }

  stats() {
    const per = {};
    const all = { ...this.totals };
    for (const [inst, state] of this.instrumentStats) {
      const count = state.errs.length;
      // The hot UI uses sampleCount. Existing report consumers still receive
      // ordinary independent arrays, copied only if they request the samples.
      let errs, vels;
      const s = { good: state.good, ok: state.ok, miss: state.miss, extra: state.extra,
        get errs() { return errs ||= state.errs.slice(0, count); },
        get vels() { return vels ||= state.vels.slice(0, count); }, dynOk: state.dynOk,
        expected: state.good + state.ok + state.miss,
        mean: count ? state.mean : null,
        spread: count > 1 ? Math.sqrt(Math.max(0, state.m2 / count)) : null };
      Object.defineProperty(s, 'sampleCount', { value: count });
      per[inst] = s;
    }
    const expected = all.good + all.ok + all.miss;
    const accuracy = expected ? Math.round((100 * (all.good + 0.5 * all.ok)) / (expected + 0.5 * all.extra)) : null;
    return { per, all, expected, accuracy };
  }
}
