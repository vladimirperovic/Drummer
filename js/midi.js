// MIDI ulaz sa bubnja (Web MIDI: Chrome, Edge, Brave). Svaka nota se pretvara u instrument
// prema mapi; fabrička mapa odgovara TD-17, a "Nauči" dodjeljuje sljedeći udareni pad.

import { INSTRUMENTS } from './patterns.js';

const MAP_KEY = 'trener.midiMapa.v1';

export function defaultMap() {
  const m = {};
  for (const inst of INSTRUMENTS) for (const n of inst.midiIn) m[n] = inst.id;
  return m;
}

export class MidiInput {
  constructor(handlers) {
    this.h = handlers;
    this.access = null;
    this.learn = null;
    this.outId = '';
    try { this.map = JSON.parse(localStorage.getItem(MAP_KEY)) || defaultMap(); } catch { this.map = defaultMap(); }
  }

  get supported() { return !!navigator.requestMIDIAccess; }

  async init() {
    if (!this.supported) {
      this.h.onStatus({ ok: false, text: 'Ovaj browser nema MIDI. Otvori aplikaciju u Chrome-u, Edge-u ili Brave-u.' });
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch {
      this.h.onStatus({ ok: false, text: 'MIDI nije dozvoljen. Dozvoli MIDI za ovu stranicu u podešavanjima browsera.' });
      return;
    }
    this.access.onstatechange = () => this.bind();
    this.bind();
  }

  bind() {
    const inputs = [...this.access.inputs.values()];
    const outputs = [...this.access.outputs.values()];
    for (const i of inputs) i.onmidimessage = e => this.onMessage(e);
    this.h.onStatus({
      ok: inputs.length > 0,
      text: inputs.length ? inputs.map(i => i.name).join(', ') : 'Nema MIDI uređaja. Poveži TD-17 USB kablom i upali ga.',
      outputs,
    });
  }

  onMessage(e) {
    const [status, d1, d2] = e.data;
    const type = status & 0xf0;
    if (type === 0x90 && d2 > 0) {
      this.h.onNote?.(d1, d2);
      if (this.learn) {
        this.assign(d1, this.learn.instId);
        const done = this.learn.done;
        this.learn = null;
        done?.(d1);
        return;
      }
      const inst = this.map[d1];
      if (inst) this.h.onHit(inst, d2, e.timeStamp, 'midi');
    } else if (type === 0xb0 && d1 === 4) {
      this.h.onPedal?.(d2);
    } else if (type === 0xa0 && d2 > 0) {
      const inst = this.map[d1];
      if (inst) this.h.onChoke?.(inst);
    }
  }

  startLearn(instId, done) { this.learn = { instId, done }; }
  cancelLearn() { this.learn = null; }

  assign(note, instId) {
    this.map[note] = instId;
    this.save();
  }

  unassign(note) {
    delete this.map[note];
    this.save();
  }

  reset() {
    this.map = defaultMap();
    this.save();
  }

  save() { try { localStorage.setItem(MAP_KEY, JSON.stringify(this.map)); } catch {} }

  notesFor(instId) {
    return Object.entries(this.map).filter(([, v]) => v === instId).map(([k]) => Number(k)).sort((a, b) => a - b);
  }

  // Slanje ritma na drugi program (npr. EZdrummer preko IAC drajvera), kanal 10
  send(note, vel, perfTime) {
    const out = this.outId && this.access?.outputs.get(this.outId);
    if (!out) return false;
    out.send([0x99, note, vel], perfTime);
    out.send([0x89, note, 0], perfTime + 80);
    return true;
  }
}
