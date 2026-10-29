// MIDI ulaz sa bubnja (Web MIDI: Chrome, Edge, Brave). Svaka nota se pretvara u instrument
// prema mapi; fabrička mapa odgovara TD-17, a "Nauči" dodjeljuje sljedeći udareni pad.

import { INSTRUMENTS, INST } from './patterns.js';
import { saveMidiMap, reportError } from './storage.js';
import { normalizeRouting, resolveRoute, sourceMetadata, ROUTING_KEY } from './midi-routing.js';
export { normalizeRouting } from './midi-routing.js';

const MAP_KEY = 'trener.midiMapa.v1';

export function defaultMap() {
  const m = {};
  for (const inst of INSTRUMENTS) for (const n of inst.midiIn) m[n] = inst.id;
  return m;
}
export function normalizeMidiMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultMap();
  return Object.fromEntries(Object.entries(value).filter(([note, inst]) => /^\d+$/.test(note) && Number(note) <= 127 && Object.hasOwn(INST, inst)));
}

export class MidiInput {
  constructor(handlers) {
    this.h = handlers;
    this.access = null;
    this.learn = null;
    this.outId = '';
    this.activeOutputs = new Map();
    try { this.map = normalizeMidiMap(JSON.parse(localStorage.getItem(MAP_KEY))); } catch { this.map = defaultMap(); }
    try { this.routing = normalizeRouting(JSON.parse(localStorage.getItem(ROUTING_KEY))); } catch { this.routing = normalizeRouting(); }
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
    for (const i of inputs) i.onmidimessage = e => this.onMessage(e, i);
    this.h.onStatus({
      ok: inputs.length > 0,
      text: inputs.length ? inputs.map(i => i.name).join(', ') : 'Nema MIDI uređaja. Poveži TD-17 USB kablom i upali ga.',
      outputs,
      inputs,
    });
  }

  onMessage(e, source = e.currentTarget || e.target) {
    const [status, d1, d2] = e.data;
    const type = status & 0xf0;
    const metadata = sourceMetadata(source, status);
    if (type === 0x90 && d2 > 0) {
      if (source) this.h.onNote?.(d1, d2, metadata); else this.h.onNote?.(d1, d2);
      if (this.learn) {
        const assigned = this.learn.scoped
          ? this.setRouting({ ...this.routing, inputs: [...this.routing.inputs, { device: metadata.deviceId || '*', deviceName: metadata.deviceName, channel: metadata.channel, note: d1, inst: this.learn.instId }] })
          : this.assign(d1, this.learn.instId);
        const done = this.learn.done;
        this.learn = null;
        done?.(d1, metadata, assigned !== false);
        return;
      }
      const inst = this.resolve(d1, metadata);
      if (inst && source) this.h.onHit(inst, d2, e.timeStamp, 'midi', d1, metadata);
      else if (inst) this.h.onHit(inst, d2, e.timeStamp, 'midi', d1);
    } else if (type === 0xb0 && d1 === 4) {
      this.h.onPedal?.(d2);
    } else if (type === 0xa0 && d2 > 0) {
      const inst = this.resolve(d1, metadata);
      if (inst) this.h.onChoke?.(inst);
    }
  }

  resolve(note, metadata) { return resolveRoute(this.routing, this.map, note, metadata); }
  startLearn(instId, done, { scoped = false } = {}) { if (Object.hasOwn(INST, instId)) this.learn = { instId, done, scoped }; }
  cancelLearn() { this.learn = null; }

  assign(note, instId) {
    const next = { ...this.map, [note]: instId };
    if (!saveMidiMap(next)) return false;
    this.map = next; return true;
  }

  unassign(note) {
    delete this.map[note];
    this.save();
  }

  reset() {
    this.map = defaultMap();
    this.save();
  }

  saveRouting(value = this.routing) {
    try { localStorage.setItem(ROUTING_KEY, JSON.stringify(value)); return true; }
    catch (error) { if (this.h.onStorageError) this.h.onStorageError(error); else reportError(error, ROUTING_KEY); return false; }
  }
  setRouting(value, persist = true) {
    const routing = normalizeRouting(value);
    if (persist && !this.saveRouting(routing)) return false;
    this.stopOutput(); this.routing = routing; return true;
  }
  save() { const mapSaved = saveMidiMap(this.map); const routingSaved = this.saveRouting(); return mapSaved && routingSaved; }

  notesFor(instId) {
    return Object.entries(this.map).filter(([, v]) => v === instId).map(([k]) => Number(k)).sort((a, b) => a - b);
  }

  // Slanje ritma na drugi program (npr. EZdrummer preko IAC drajvera), kanal 10
  send(note, vel, perfTime) {
    const out = this.outId && this.access?.outputs.get(this.outId);
    return this.sendTo(out, 10, note, vel, perfTime);
  }

  sendInstrument(instId, vel, perfTime) {
    const inst = INST[instId]; if (!inst) return false;
    const route = this.routing.outputs[instId];
    const id = route?.device && route.device !== '*' ? route.device : this.outId;
    return this.sendTo(id && this.access?.outputs.get(id), route?.channel || 10, route?.note ?? inst.midiOut, vel, perfTime);
  }

  sendTo(out, channel, note, vel, perfTime) {
    if (!out) return false;
    if (!Number.isInteger(note) || note < 0 || note > 127 || !Number.isInteger(vel) || vel < 1 || vel > 127 || !Number.isFinite(perfTime)) return false;
    const active = this.activeOutputs.get(out) || new Map();
    const notes = active.get(channel) || new Set(); notes.add(note); active.set(channel, notes); this.activeOutputs.set(out, active);
    try {
      out.send([0x90 | (channel - 1), note, vel], perfTime);
      out.send([0x80 | (channel - 1), note, 0], perfTime + 80);
      return true;
    } catch { this.stopOutput(); return false; }
  }

  stopOutput() {
    const selected = this.outId && this.access?.outputs.get(this.outId);
    if (selected && !this.activeOutputs.has(selected)) this.activeOutputs.set(selected, new Map([[10, new Set()]]));
    for (const [out, channels] of this.activeOutputs) {
      try { out.clear?.(); } catch {}
      for (const [channel, notes] of channels) {
        for (const note of notes) try { out.send([0x80 | (channel - 1), note, 0]); } catch {}
        try { out.send([0xb0 | (channel - 1), 123, 0]); } catch {}
      }
    }
    this.activeOutputs.clear();
  }
}
