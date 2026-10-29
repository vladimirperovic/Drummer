import { INSTRUMENTS, INST } from './patterns.js';
import { t } from './i18n.js';

const option = (label, value, userText = false) => { const el = new Option(label, value); if (userText) el.dataset.userText = ''; return el; };
export class MidiRoutingUI {
  constructor(host, parent) {
    this.host = host; this.inputs = []; this.outputs = [];
    this.el = document.createElement('details'); this.el.id = 'midiRouting';
    this.el.innerHTML = `<summary>MIDI pravila po uređaju i kanalu</summary>
      <p class="muted">Posebno pravilo ima prednost nad osnovnom mapom. Uređaj + kanal, zatim uređaj, zatim kanal; ostale note koriste osnovnu mapu.</p>
      <div class="routing-form">
        <label>Ulazni uređaj<select id="routingDevice"></select></label>
        <label>Ulazni kanal<select id="routingChannel"></select></label>
        <label>MIDI nota<input id="routingNote" type="number" min="0" max="127" step="1" value="38"></label>
        <label>Instrument<select id="routingInstrument"></select></label>
      </div>
      <div class="row"><button id="routingAdd" type="button">Dodaj ulazno pravilo</button><button id="routingLearn" type="button">Nauči uređaj i kanal</button></div>
      <p id="routingStatus" class="muted" aria-live="polite">Nauči beleži stvarni uređaj, kanal i notu sledećeg udarca.</p>
      <div class="routing-scroll"><table class="routing-table"><thead><tr><th>Uređaj</th><th>Kanal</th><th>Nota</th><th>Instrument</th><th>Radnja</th></tr></thead><tbody id="routingInputs"></tbody></table></div>
      <h4>Nezavisna izlazna mapa</h4>
      <p class="muted">Podrazumevano koristi izabrani MIDI izlaz, kanal 10 i GM notu. Izaberi drugi uređaj, kanal ili notu za pojedini instrument.</p>
      <div class="routing-scroll"><table class="routing-table"><thead><tr><th>Instrument</th><th>MIDI izlaz</th><th>Kanal</th><th>Nota</th></tr></thead><tbody id="routingOutputs"></tbody></table></div>`;
    parent.appendChild(this.el);
    if (!document.getElementById('routingStyles')) {
      const link = document.createElement('link'); link.id = 'routingStyles'; link.rel = 'stylesheet'; link.href = new URL('../routing-next.css', import.meta.url).href; document.head.appendChild(link);
    }
    this.q = selector => this.el.querySelector(selector);
    this.q('#routingChannel').replaceChildren(option('Svi kanali', '0'), ...Array.from({ length: 16 }, (_, i) => option(String(i + 1), String(i + 1))));
    this.q('#routingInstrument').replaceChildren(...INSTRUMENTS.map(inst => option(inst.label, inst.id)));
    this.q('#routingAdd').onclick = () => {
      if (host.isBusy()) return;
      const field = this.q('#routingNote'); if (!field.reportValidity() || field.value === '') return;
      const device = this.q('#routingDevice').value;
      const route = { device, deviceName: this.inputs.find(p => p.id === device)?.name || '', channel: Number(this.q('#routingChannel').value), note: Number(field.value), inst: this.q('#routingInstrument').value };
      this.update({ ...host.midi.routing, inputs: [...host.midi.routing.inputs, route] });
    };
    this.onLearn = (note, source, saved) => {
      if (!saved) this.failed();
      this.q('#routingNote').value = note; this.q('#routingChannel').value = source.channel;
      this.render(); this.q('#routingDevice').value = source.deviceId || '*';
      this.status(saved ? 'Ulazno pravilo je naučeno.' : 'MIDI pravila nisu sačuvana. Oslobodi prostor i pokušaj ponovo.');
      host.renderMap();
    };
    this.q('#routingLearn').onclick = () => {
      if (host.isBusy()) return;
      if (this.isLearning) host.midi.cancelLearn();
      else host.midi.startLearn(this.q('#routingInstrument').value, this.onLearn, { scoped: true });
      this.playState(); this.status(this.isLearning ? 'Udari pad na željenom uređaju i kanalu.' : 'Nauči beleži stvarni uređaj, kanal i notu sledećeg udarca.');
    };
    document.addEventListener('drummer:language', () => this.render());
    this.render();
  }
  get isLearning() { return this.host.midi.learn?.done === this.onLearn; }
  status(value) { this.q('#routingStatus').textContent = value; }
  failed() { this.host.toast('MIDI pravila nisu sačuvana. Oslobodi prostor i pokušaj ponovo.'); }
  update(value) {
    if (this.host.isBusy()) return false;
    if (!this.host.midi.setRouting(value)) { this.failed(); return false; }
    this.render(); this.status('MIDI pravila su sačuvana.'); this.host.renderMap(); return true;
  }
  devices(inputs, outputs) { this.inputs = inputs || []; this.outputs = outputs || [...this.host.midi.access?.outputs?.values() || []]; this.render(); }
  portOptions(ports, extra, firstLabel) {
    const known = new Map(ports.map(p => [p.id, this.portName(p, ports)]));
    for (const p of extra) if (p.device !== '*' && !known.has(p.device)) known.set(p.device, `${p.deviceName || p.device} (${t('nije povezan')})`);
    return [option(t(firstLabel), '*'), ...[...known].map(([id, name]) => option(name, id, true))];
  }
  portName(port, ports) {
    const name = port.name || port.id;
    return ports.filter(p => (p.name || p.id) === name).length > 1 ? `${name} · ${port.id}` : name;
  }
  render() {
    const midi = this.host.midi, chosen = this.q('#routingDevice').value || '*';
    this.q('#routingDevice').replaceChildren(...this.portOptions(this.inputs, midi.routing.inputs, 'Svi uređaji'));
    this.q('#routingDevice').value = [...this.q('#routingDevice').options].some(o => o.value === chosen) ? chosen : '*';
    const rows = midi.routing.inputs.map((route, index) => {
      const row = document.createElement('tr');
      const source = this.inputs.find(p => p.id === route.device);
      for (const [value, userText] of [[route.device === '*' ? t('Svi uređaji') : source ? this.portName(source, this.inputs) : route.deviceName || route.device, true], [route.channel || t('Svi'), false], [route.note, false], [t(INST[route.inst].label), false]]) {
        const cell = document.createElement('td'); cell.textContent = value; if (userText) cell.dataset.userText = ''; row.appendChild(cell);
      }
      const cell = document.createElement('td'), button = document.createElement('button'); button.type = 'button'; button.textContent = 'Obriši'; button.setAttribute('aria-label', t('Obriši ulazno pravilo'));
      button.onclick = () => this.update({ ...midi.routing, inputs: midi.routing.inputs.filter((_, i) => i !== index) }); cell.appendChild(button); row.appendChild(cell); return row;
    });
    if (!rows.length) { const row = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 5; cell.textContent = 'Nema posebnih pravila. Osnovna mapa važi za sve uređaje i kanale.'; row.appendChild(cell); rows.push(row); }
    this.q('#routingInputs').replaceChildren(...rows);
    this.q('#routingOutputs').replaceChildren(...INSTRUMENTS.map(inst => {
      const route = midi.routing.outputs[inst.id], row = document.createElement('tr'); row.dataset.inst = inst.id;
      const name = document.createElement('td'); name.textContent = inst.label; row.appendChild(name);
      const device = document.createElement('select'), channel = document.createElement('input'), note = document.createElement('input');
      device.setAttribute('aria-label', `${t('MIDI izlaz za')} ${t(inst.label)}`); channel.setAttribute('aria-label', `${t('Izlazni kanal za')} ${t(inst.label)}`); note.setAttribute('aria-label', `${t('Izlazna nota za')} ${t(inst.label)}`);
      device.replaceChildren(option(t('Podrazumevano'), ''), ...this.portOptions(this.outputs, route ? [route] : [], 'Izabrani MIDI izlaz'));
      device.value = route?.device || ''; device.dataset.routeDevice = '';
      channel.type = note.type = 'number'; channel.min = '1'; channel.max = '16'; note.min = '0'; note.max = '127'; channel.step = note.step = '1';
      channel.value = route?.channel || 10; note.value = route?.note ?? inst.midiOut;
      for (const control of [device, channel, note]) {
        const cell = document.createElement('td'); cell.appendChild(control); row.appendChild(cell);
        control.onchange = () => {
          if (this.host.isBusy()) return;
          if (!channel.reportValidity() || !note.reportValidity() || channel.value === '' || note.value === '') return;
          const outputs = { ...midi.routing.outputs };
          if (!device.value) delete outputs[inst.id];
          else outputs[inst.id] = { device: device.value, deviceName: this.outputs.find(p => p.id === device.value)?.name || route?.deviceName || '', channel: Number(channel.value), note: Number(note.value) };
          this.update({ ...midi.routing, outputs });
        };
      }
      return row;
    }));
    this.playState();
  }
  playState() {
    const busy = this.host.isBusy(); if (busy && this.isLearning) this.host.midi.cancelLearn();
    for (const el of this.el.querySelectorAll('button,input,select')) el.disabled = busy;
    for (const row of this.q('#routingOutputs').rows) for (const input of row.querySelectorAll('input')) input.disabled = busy || !row.querySelector('select').value;
    this.q('#routingLearn').textContent = this.isLearning ? 'Otkaži učenje' : 'Nauči uređaj i kanal';
  }
}
