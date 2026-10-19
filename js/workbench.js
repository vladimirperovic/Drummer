import { INSTRUMENTS } from './patterns.js';
import { parseMidiFile, metadataAt, midiToPattern, fileDrumMap } from './midi-file.js';
import { renderPrint } from './printing.js';
const $ = id => document.getElementById(id);

export class Workbench {
  constructor(host) { this.host = host; this.file = null; this.loadToken = 0; this.bind(); this.playState(); }
  show(name) {
    for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === name);
    for (const panel of ['import', 'print', 'offline', 'mcp']) $(`tool-${panel}`).hidden = panel !== name;
    if (name === 'print') this.printPreview();
  }
  bind() {
    for (const b of document.querySelectorAll('[data-tool]')) b.onclick = () => this.show(b.dataset.tool);
    $('midiFile').onchange = async e => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      const token = ++this.loadToken; this.file = null; this.playState();
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error('MIDI fajl je veći od 10 MB.');
        const parsed = parseMidiFile(await file.arrayBuffer());
        if (token !== this.loadToken) return;
        this.file = parsed; this.filename = file.name.replace(/\.midi?$/i, ''); this.map = fileDrumMap();
        const meta = metadataAt(parsed);
        $('midiName').value = this.filename;
        $('midiTrack').replaceChildren(new Option('Sve trake', ''), ...parsed.tracks.map(t => new Option(`${t.index + 1}. ${t.name} (${t.notes})`, t.index)));
        const channels = [...new Set(parsed.notes.map(n => n.channel))].sort((a, b) => a - b);
        $('midiChannel').replaceChildren(new Option('Svi kanali', ''), ...channels.map(c => new Option(String(c), c)));
        $('midiChannel').value = channels.includes(10) ? '10' : '';
        $('midiStart').value = 0; $('midiBars').value = 1;
        $('midiBeats').value = meta.beats >= 2 && meta.beats <= 7 ? meta.beats : 4;
        $('midiUnit').value = meta.beatUnit === 8 ? 8 : 4;
        this.renderMapping(); this.preview();
      } catch (error) { if (token === this.loadToken) { $('midiSummary').textContent = error.message; this.host.toast(error.message); } }
      this.playState();
    };
    for (const id of ['midiTrack', 'midiChannel', 'midiStart', 'midiBars', 'midiBeats', 'midiUnit', 'midiQuantize', 'midiName']) $(id).onchange = () => this.preview();
    $('midiReadMeter').onclick = () => {
      if (!this.file) return;
      const m = metadataAt(this.file, Number($('midiStart').value));
      if (m.beats < 2 || m.beats > 7 || ![4, 8].includes(m.beatUnit)) return this.host.toast('Mera u ovom delu nije podržana. Izaberi meru ručno.');
      $('midiBeats').value = m.beats; $('midiUnit').value = m.beatUnit; this.preview();
    };
    $('midiMapping').onchange = e => { const sel = e.target.closest('[data-midi-note]'); if (sel) { this.map[sel.dataset.midiNote] = sel.value; this.preview(); } };
    $('midiUseProfile').onclick = () => { this.map = { ...this.host.midi.map }; this.renderMapping(); this.preview(); };
    $('midiImportApply').onclick = () => {
      if (this.host.isBusy()) return;
      const result = this.preview(); if (!result || !result.imported) return;
      if (!this.host.loadPattern(result.pattern)) return;
      this.host.markDirty(); this.host.render();
      document.querySelector('[data-view=editor]').click(); this.host.toast('MIDI je uvezen. Sačuvaj ritam u biblioteku.');
    };
    for (const id of ['printBars', 'printRepeats', 'printSticking']) $(id).onchange = () => this.printPreview();
    $('printRefresh').onclick = () => this.printPreview();
    $('printGo').onclick = () => {
      this.printPreview();
      $('printOutput').innerHTML = $('printPreview').innerHTML;
      document.dispatchEvent(new Event('drummer:translate'));
      window.print();
    };
  }
  renderMapping() {
    $('midiMapping').replaceChildren();
    const notes = [...new Set(this.file.notes.map(n => n.note))].sort((a, b) => a - b);
    for (const note of notes) {
      const label = document.createElement('label'); label.textContent = `MIDI ${note}`;
      const select = document.createElement('select'); select.dataset.midiNote = note;
      select.append(new Option('Preskoči', ''), ...INSTRUMENTS.map(i => new Option(i.label, i.id)));
      select.value = this.map[note] || ''; label.append(select); $('midiMapping').append(label);
    }
  }
  preview() {
    if (!this.file) return null;
    let result;
    try {
      result = midiToPattern(this.file, { name: $('midiName').value, startQuarter: $('midiStart').value,
        bars: +$('midiBars').value, beats: +$('midiBeats').value, beatUnit: +$('midiUnit').value,
        channel: $('midiChannel').value, track: $('midiTrack').value, quantize: $('midiQuantize').value, map: this.map });
      $('midiSummary').textContent = `Udarci: ${result.imported} · preskočeno: ${result.ignored} · spojeno u isti korak: ${result.collisions} · ${result.pattern.bpm} BPM.`
        + (result.tempoChanges ? ' Deo menja tempo; uvezeni ritam koristi tempo na početku dela.' : '')
        + (result.clampedTempo ? ' Tempo je ograničen na 30–260 BPM.' : '')
        + (!result.imported ? ' Nema mapiranih udaraca u izabranom delu.' : '');
    } catch (error) { $('midiSummary').textContent = error.message; }
    $('midiImportApply').disabled = !result?.imported || this.host.isBusy();
    return result;
  }
  printPreview() {
    const pages = renderPrint($('printPreview'), this.host.getPattern(), {
      barsPerLine: +$('printBars').value, repeats: +$('printRepeats').value, sticking: $('printSticking').checked });
    $('printSummary').textContent = `Stranice: ${pages}. U dijalogu štampe izaberi Sačuvaj kao PDF, format A4 i isključi zaglavlja browsera.`;
  }
  playState() {
    for (const element of $('tool-import').querySelectorAll('input,select,button')) element.disabled = this.host.isBusy();
    $('midiImportApply').disabled = !this.file || this.host.isBusy();
    if (this.file) this.preview();
  }
}
