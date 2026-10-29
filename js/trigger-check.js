// Podešavanja → Provera trigera: snima sirove MIDI poruke sa bubnja i uživo pokazuje šta treba podesiti na modulu.
import { INST } from './patterns.js';
import { analyzeTriggers, padLabel, zoneName, toJsonLines, MAX_EVENTS } from './trigger-check-model.js';
import { t, getLanguage } from './i18n.js';
import { downloadBlob } from './storage.js';

const MAX_MS = 10 * 60 * 1000;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const words = (sr, en) => getLanguage() === 'en' ? en : sr;
const pad = id => id.startsWith('note-') ? words(`Nota ${id.slice(5)}`, `Note ${id.slice(5)}`) : t(padLabel(id));
const zone = z => z.inst ? [t(INST[z.inst].label), zoneName(z.note) && t(zoneName(z.note))].filter(Boolean).join(' ') : t('nije mapirana');
const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export function adviceText(tip) {
  switch (tip.kind) {
    case 'double': return words(`${pad(tip.pad)}: ${tip.count} dupla okidanja (drugi udarac posle ~${tip.ms} ms, tiši). Povećaj Retrig Cancel, pa po potrebi Mask Time.`,
      `${pad(tip.pad)}: ${tip.count} double triggers (second hit ~${tip.ms} ms later, softer). Raise Retrig Cancel, then Mask Time if needed.`);
    case 'crosstalk': return words(`Udarac u ${pad(tip.source)} okida ${pad(tip.pad)} (${tip.count}×). Povećaj Crosstalk Cancel na padu ${pad(tip.pad)}.`,
      `Hitting ${pad(tip.source)} triggers ${pad(tip.pad)} (${tip.count}×). Raise Crosstalk Cancel on ${pad(tip.pad)}.`);
    case 'hot': return words(`${zone(tip.zone)}: ${tip.percent}% udaraca na 127. Smanji Sensitivity ili izaberi krivu EXP1/EXP2.`,
      `${zone(tip.zone)}: ${tip.percent}% of hits at 127. Lower Sensitivity or choose the EXP1/EXP2 curve.`);
    case 'weak': return words(`${pad(tip.pad)}: najjači udarac je ${tip.max}. Ako si udarao punom snagom, povećaj Sensitivity.`,
      `${pad(tip.pad)}: the loudest hit is ${tip.max}. If you hit at full strength, raise Sensitivity.`);
    case 'faint': return words(`${pad(tip.pad)}: ${tip.count} vrlo tihih okidanja (jačina do 8). Ako nisi tako tiho svirao, povećaj Threshold.`,
      `${pad(tip.pad)}: ${tip.count} very soft triggers (velocity up to 8). If you did not play that softly, raise Threshold.`);
    case 'pedalRange': return words(`Hi-hat pedala šalje samo ${tip.min}–${tip.max}. Podesi hi-hat offset na modulu da pedala pokrije ceo opseg.`,
      `The hi-hat pedal only sends ${tip.min}–${tip.max}. Adjust the hi-hat offset on the module so the pedal covers the full range.`);
    case 'pedalMissing': return words('Nema poruka o položaju hi-hat pedale (CC4). Pomeri pedalu do kraja gore i dole tokom provere.',
      'No hi-hat pedal position messages (CC4). Move the pedal fully up and down during the check.');
    case 'unmapped': return words(`Nota ${tip.note} nije mapirana (${tip.count}×). Dodeli je instrumentu dugmetom Nauči u MIDI mapi.`,
      `Note ${tip.note} is not mapped (${tip.count}×). Assign it with Learn in the MIDI map.`);
    case 'clean': return words('Nema duplih okidanja ni crosstalka. Trigeri izgledaju dobro.', 'No double triggers or crosstalk. The triggers look good.');
    default: return '';
  }
}

export class TriggerCheck {
  constructor(host, parent) {
    this.host = host; this.hits = []; this.pedal = []; this.recording = false; this.startedAt = 0; this.lastHit = null; this.frame = 0;
    this.el = document.createElement('section'); this.el.id = 'triggerCheck'; this.el.className = 'trigger-check';
    this.el.innerHTML = `<h3>Provera trigera</h3>
      <p class="muted">Udaraj jedan pad za drugim: 8 tiho, 8 srednje i 8 jako, pa pauza od 2 sekunde. Za crosstalk udari jako jedan pad dok ostali miruju. Hi-hat pedalu pomeri do kraja gore i dole.</p>
      <div class="row trig-actions"><button type="button" class="primary" data-trig-start>● Počni proveru</button><button type="button" data-trig-stop hidden>■ Završi</button>
        <button type="button" data-trig-clear disabled>Obriši</button><button type="button" data-trig-export disabled title="JSON po redu, isti format kao alati/midirec">Izvezi za analiza.py</button></div>
      <p class="trig-status" data-trig-status role="status" aria-live="polite"></p>
      <ul class="trig-advice" data-trig-advice></ul>
      <div class="trig-scroll"><table class="trig-table" data-trig-zones></table></div>
      <div class="trig-more" data-trig-more></div>`;
    parent.append(this.el);
    this.q = selector => this.el.querySelector(selector);
    this.q('[data-trig-start]').onclick = () => this.start();
    this.q('[data-trig-stop]').onclick = () => this.stop();
    this.q('[data-trig-clear]').onclick = () => { if (!this.recording) { this.hits = []; this.pedal = []; this.lastHit = null; this.render(); } };
    this.q('[data-trig-export]').onclick = () => {
      if (!this.hits.length && !this.pedal.length) return;
      downloadBlob(`trigeri-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jsonl`, new Blob([toJsonLines(this.hits, this.pedal)], { type: 'application/x-ndjson' }));
    };
    document.addEventListener('drummer:language', () => this.render());
    this.render();
  }

  get busy() { return this.recording; }

  start() {
    if (this.recording || this.host.isBusy()) { this.host.toast('Zaustavi vežbu pre provere trigera.'); return; }
    this.hits = []; this.pedal = []; this.lastHit = null; this.recording = true; this.startedAt = performance.now();
    this.timer = setInterval(() => { if (performance.now() - this.startedAt > MAX_MS) this.stop(); else this.schedule(); }, 1000);
    this.host.onBusyChange?.(); this.render();
  }

  stop() {
    if (!this.recording) return;
    this.recording = false; clearInterval(this.timer);
    this.host.onBusyChange?.(); this.render();
  }

  // Sirova MIDI poruka sa ulaza: note-on i CC4 (položaj hi-hat pedale).
  message(data, time, metadata) {
    if (!this.recording) return;
    const [status, note, value] = data, type = status & 0xf0;
    if (type === 0x90 && value > 0) {
      this.lastHit = { t: time, note, vel: value, channel: (status & 15) + 1, inst: this.host.midi.resolve(note, metadata) || null };
      this.hits.push(this.lastHit);
    } else if (type === 0xb0 && note === 4) this.pedal.push({ t: time, value });
    else return;
    if (this.hits.length + this.pedal.length >= MAX_EVENTS) { this.stop(); this.host.toast('Provera je završena: dostignut je najveći broj poruka.'); return; }
    this.schedule();
  }

  schedule() { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); }); }

  render() {
    const r = analyzeTriggers(this.hits, this.pedal), any = this.hits.length || this.pedal.length;
    this.q('[data-trig-start]').hidden = this.recording; this.q('[data-trig-stop]').hidden = !this.recording;
    this.q('[data-trig-clear]').disabled = this.recording || !any; this.q('[data-trig-export]').disabled = !any;
    const inputs = this.host.midi.access ? [...this.host.midi.access.inputs.values()].length : 0;
    const last = this.lastHit ? words(` · poslednja nota ${this.lastHit.note} (${this.lastHit.inst ? t(INST[this.lastHit.inst].label) : 'nije mapirana'}), jačina ${this.lastHit.vel}`,
      ` · last note ${this.lastHit.note} (${this.lastHit.inst ? t(INST[this.lastHit.inst].label) : 'not mapped'}), velocity ${this.lastHit.vel}`) : '';
    const status = this.q('[data-trig-status]');
    status.classList.toggle('live', this.recording);
    status.textContent = this.recording
      ? words(`Snimam: ${r.hits} udaraca · ${clock(performance.now() - this.startedAt)}${last}`, `Recording: ${r.hits} hits · ${clock(performance.now() - this.startedAt)}${last}`)
      : any ? words(`Provera: ${r.hits} udaraca za ${clock(r.durationMs)}.`, `Check: ${r.hits} hits in ${clock(r.durationMs)}.`)
      : inputs ? words('Spremno. Tastatura i miš se ne proveravaju, samo MIDI sa bubnja.', 'Ready. Only MIDI from the drums is checked, not the keyboard or mouse.')
      : words('Nema MIDI uređaja. Poveži bubanj USB kablom; tastatura i miš se ne proveravaju.', 'No MIDI device. Connect the drums by USB; the keyboard and mouse are not checked.');

    this.q('[data-trig-advice]').innerHTML = r.advice.map(tip => `<li class="${tip.level}">${esc(adviceText(tip))}</li>`).join('');
    const head = words('<tr><th>Pad</th><th>Nota</th><th>Zona</th><th>Udaraca</th><th>Jačine 1–127</th><th>min / sredina / max</th><th>na 127</th></tr>',
      '<tr><th>Pad</th><th>Note</th><th>Zone</th><th>Hits</th><th>Velocity 1–127</th><th>min / median / max</th><th>at 127</th></tr>');
    this.q('[data-trig-zones]').innerHTML = r.zones.length ? `<thead>${head}</thead><tbody>${r.zones.map(z => {
      const peak = Math.max(...z.hist), color = z.inst ? INST[z.inst].color : '#999';
      const bars = z.hist.map((n, i) => `<i style="height:${n ? Math.max(12, Math.round(100 * n / peak)) : 0}%;background:${color}" title="${i * 16 + 1}–${Math.min(127, i * 16 + 16)}: ${n}"></i>`).join('');
      const hot = z.count >= 6 && z.saturated > .15 ? ' class="hot"' : '';
      return `<tr><td>${esc(pad(z.pad))}</td><td>${z.note}</td><td>${esc(zone(z))}</td><td>${z.count}</td><td><span class="trig-hist" aria-hidden="true">${bars}</span></td><td>${z.min} / ${z.median} / ${z.max}</td><td${hot}>${Math.round(100 * z.saturated)}%</td></tr>`;
    }).join('')}</tbody>` : '';

    const doubles = r.doubles.map(d => `<li>${esc(pad(d.pad))}: ${d.count}× — ${d.examples.map(e => `${Math.round(e.dt)} ms ${e.first}→${e.second}`).join(', ')}</li>`).join('');
    const cross = r.crosstalk.map(c => `<li>${esc(pad(c.source))} → ${esc(pad(c.victim))}: ${c.count}× — ${c.examples.map(e => `${e.source}→${e.victim}`).join(', ')}</li>`).join('');
    const none = `<li class="muted">${words('nema', 'none')}</li>`;
    const hh = r.hihat ? words(`Pedala (CC4): ${r.hihat.messages ? `${r.hihat.min}–${r.hihat.max}, ${r.hihat.distinct} vrednosti, ${r.hihat.messages} poruka` : 'nema poruka'} · zatvoren ${r.hihat.closed}, otvoren ${r.hihat.open}, nogom ${r.hihat.chick}`,
      `Pedal (CC4): ${r.hihat.messages ? `${r.hihat.min}–${r.hihat.max}, ${r.hihat.distinct} values, ${r.hihat.messages} messages` : 'no messages'} · closed ${r.hihat.closed}, open ${r.hihat.open}, foot ${r.hihat.chick}`) : '';
    const segments = r.segments.map((s, i) => `<tr><td>${i + 1}</td><td>${(s.startMs / 1000).toFixed(1)} s</td><td>${esc(pad(s.pad))}</td><td>${s.count}${s.others ? ` <small>+${s.others}</small>` : ''}</td><td>${s.min} / ${s.median} / ${s.max}</td><td>${s.evenness == null ? '–' : `±${s.evenness}%`}</td></tr>`).join('');
    this.q('[data-trig-more]').innerHTML = any ? `<div class="trig-lists">
        <div><h4>${words('Dupli okidači', 'Double triggers')}</h4><ul>${doubles || none}</ul></div>
        <div><h4>Crosstalk</h4><ul>${cross || none}</ul></div>
        ${hh ? `<div><h4>Hi-hat</h4><p>${esc(hh)}</p></div>` : ''}</div>
      ${segments ? `<details><summary>${words('Serije udaraca (odvojene pauzom)', 'Hit series (separated by pauses)')}</summary><div class="trig-scroll"><table class="trig-table">
        <thead><tr><th>#</th><th>${words('Početak', 'Start')}</th><th>Pad</th><th>${words('Udaraca', 'Hits')}</th><th>${words('min / sredina / max', 'min / median / max')}</th><th>${words('Razmak', 'Spacing')}</th></tr></thead><tbody>${segments}</tbody></table></div></details>` : ''}` : '';
  }
}
