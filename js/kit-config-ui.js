import { KIT_LIMITS, KIT_PRESETS, normalizeKit, kitInstruments } from './kit-config.js';
import { t } from './i18n.js';

export class KitConfigurator {
  constructor(host) {
    this.host = host;
    const details = document.createElement('details'); details.id = 'kitConfigurator'; details.className = 'kit-configurator';
    details.innerHTML = `<summary>Moj bubanj</summary>
      <div class="kit-config-fields">
        <label>Početni set<select id="kitPreset"><option value="">Prilagođeni</option><option value="compact">Mali set</option><option value="standard">Standardni set</option><option value="expanded">Prošireni set</option></select></label>
        ${Object.entries({ racks: 'Viseći tomovi', floors: 'Floor tomovi', snares: 'Doboši', kicks: 'Bas bubnjevi', crashes: 'Crash činele', rides: 'Ride činele' }).map(([key, label]) => `<label>${label}<select id="kit-${key}">${Array.from({ length: KIT_LIMITS[key][1] - KIT_LIMITS[key][0] + 1 }, (_, i) => `<option>${i + KIT_LIMITS[key][0]}</option>`).join('')}</select></label>`).join('')}
        <label>Raspored<select id="kitHand"><option value="right">Desnoruki</option><option value="left">Ljevoruki</option></select></label>
      </div>
      <p class="muted">Delovi se raspoređuju automatski. Za svoj raspored uključi Pomjeri djelove ispod ovog panela; važi za 2D i 3D.</p>
      <div class="kit-config-fields">
        <label>Profil uređaja<select id="kitProfile"></select></label>
        <label>Naziv profila<input id="kitProfileName" type="text" maxlength="100"></label>
        <button id="kitProfileSave">Sačuvaj profil</button><button id="kitProfileNew">Novi profil</button>
        <button id="kitProfileExport">Izvezi profil</button><label class="btn">Uvezi profil<input id="kitProfileImport" type="file" accept=".json,application/json" hidden></label>
      </div>
      <p class="muted">Profil čuva sastav bubnja, raspored, MIDI mapu, kalibraciju i velocity krivu.</p>
      <h3>Poveži padove</h3>
      <p class="muted">Izaberi Nauči, pa udari pad. Za dva bas bubnja modul mora slati različite MIDI note. Učenje nove note može je premestiti sa drugog instrumenta.</p>
      <div id="kitLearnList" class="kit-learn-list"></div><p id="kitConfigStatus" role="status"></p>`;
    document.getElementById('view-kit').prepend(details); this.root = details;
    this.$ = id => details.querySelector('#' + id);
    for (const key of Object.keys(KIT_LIMITS)) this.$('kit-' + key).onchange = e => this.change({ ...host.settings.kitConfig, [key]: Number(e.target.value) });
    this.$('kitHand').onchange = e => this.change({ ...host.settings.kitConfig, leftHanded: e.target.value === 'left' });
    this.$('kitPreset').onchange = e => { if (KIT_PRESETS[e.target.value]) this.change(KIT_PRESETS[e.target.value]); };
    this.$('kitProfile').onchange = e => {
      const p = host.profiles.items.find(p => p.id === e.target.value);
      if (p) { host.profiles.apply(p); host.profiles.render(); } else host.profiles.newProfile();
      this.render();
    };
    this.$('kitProfileSave').onclick = () => { host.profiles.save(this.$('kitProfileName').value); this.render(); };
    this.$('kitProfileNew').onclick = () => { host.profiles.newProfile(); this.render(); };
    this.$('kitProfileExport').onclick = () => host.profiles.exportProfile(this.$('kitProfileName').value);
    this.$('kitProfileImport').onchange = async e => { const file = e.target.files[0]; if (file) await host.profiles.importProfile(file); e.target.value = ''; this.render(); };
    this.$('kitLearnList').onclick = e => {
      const b = e.target.closest('[data-kit-learn]'); if (!b || host.isBusy()) return;
      if (host.midi.learn?.instId === b.dataset.kitLearn) host.midi.cancelLearn();
      else host.midi.startLearn(b.dataset.kitLearn, () => { host.renderMap(); this.renderLearning(); this.$('kitConfigStatus').textContent = 'MIDI nota je povezana. Sačuvaj profil da zadržiš mapu uz ovaj set.'; });
      host.renderMap(); this.renderLearning();
    };
    this.render();
  }
  change(value) {
    if (this.host.isBusy()) return this.render();
    this.host.apply(normalizeKit(value)); this.render();
  }
  renderKit() {
    const c = normalizeKit(this.host.settings.kitConfig);
    for (const key of Object.keys(KIT_LIMITS)) this.$('kit-' + key).value = c[key];
    this.$('kitHand').value = c.leftHanded ? 'left' : 'right';
    this.$('kitPreset').value = Object.keys(KIT_PRESETS).find(k => JSON.stringify(normalizeKit(KIT_PRESETS[k])) === JSON.stringify(c)) || '';
  }
  render() {
    this.renderKit();
    const profiles = this.host.profiles;
    this.$('kitProfile').replaceChildren(new Option(t('Trenutna podešavanja'), ''), ...profiles.items.map(p => { const o = new Option(p.name, p.id); o.dataset.userText = ''; return o; }));
    this.$('kitProfile').value = profiles.id;
    const currentName = document.getElementById('profileName').value;
    this.$('kitProfileName').value = profiles.items.find(p => p.id === profiles.id)?.name || (['Moj uređaj', 'My device', ''].includes(currentName) ? t('Moj uređaj') : currentName);
    this.renderLearning(); this.playState();
  }
  renderLearning() {
    const list = this.$('kitLearnList'); list.replaceChildren();
    for (const i of kitInstruments(this.host.settings.kitConfig)) {
      const row = document.createElement('div'); row.className = 'kit-learn-row'; row.dataset.instrument = i.id;
      const label = document.createElement('span'); label.textContent = t(i.label); label.style.setProperty('--c', i.color);
      const note = document.createElement('small'); note.textContent = this.host.midi.notesFor(i.id).join(', ') || t('nema');
      const button = document.createElement('button'); button.dataset.kitLearn = i.id;
      button.textContent = t(this.host.midi.learn?.instId === i.id ? 'Udari pad…' : 'Nauči'); button.disabled = this.host.isBusy();
      button.setAttribute('aria-label', `${t('Nauči')}: ${t(i.label)}`);
      row.append(label, note, button); list.append(row);
    }
  }
  playState() { for (const e of this.root.querySelectorAll('input,select,button')) e.disabled = this.host.isBusy(); }
}
