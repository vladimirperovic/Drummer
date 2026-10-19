import { bounded } from './practice.js';
import { normalizeMidiMap } from './midi.js';
import * as store from './storage.js';
import { t } from './i18n.js';
import { normalizeKit } from './kit-config.js';

const $ = id => document.getElementById(id);
export function normalizeProfile(value) {
  return { id: typeof value?.id === 'string' ? value.id : null,
    name: typeof value?.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 100) : 'Moj uređaj',
    device: typeof value?.device === 'string' ? value.device.slice(0, 200) : '',
    calib: Math.round(bounded(value?.calib, -1000, 1000, 0)),
    curve: ['linear', 'soft', 'hard'].includes(value?.curve) ? value.curve : 'linear',
    gain: bounded(value?.gain, .5, 2, 1), kitConfig: normalizeKit(value?.kitConfig), map: normalizeMidiMap(value?.map) };
}
export function velocityFor(velocity, curve = 'linear', gain = 1) {
  const normalized = bounded(velocity, 1, 127, 92) / 127;
  const power = curve === 'soft' ? .65 : curve === 'hard' ? 1.5 : 1;
  return Math.round(bounded(127 * normalized ** power * bounded(gain, .5, 2, 1), 1, 127, 92));
}

export class DeviceProfiles {
  constructor(host) {
    this.host = host; this.items = store.loadProfiles().filter(v => v.id).map(normalizeProfile);
    this.id = host.settings.profileId || ''; this.inputs = [];
    this.bind(); this.render();
  }
  get current() { return normalizeProfile({ id: this.id, name: $('profileName').value, device: $('profileDevice').value,
    calib: this.host.settings.calib, curve: this.host.settings.velocityCurve, gain: this.host.settings.velocityGain, kitConfig: this.host.settings.kitConfig, map: this.host.midi.map }); }
  apply(profile, persist = true) {
    if (this.host.isBusy()) return false;
    profile = normalizeProfile(profile);
    this.host.stop(); this.host.midi.cancelLearn();
    this.host.applyKit?.(profile.kitConfig, false);
    this.id = profile.id;
    Object.assign(this.host.settings, { profileId: profile.id, calib: profile.calib, velocityCurve: profile.curve, velocityGain: profile.gain });
    this.host.midi.map = structuredClone(profile.map);
    $('calib').value = profile.calib;
    if (persist) { this.host.midi.save(); this.host.saveSettings(); }
    this.host.renderMap();
  }
  save(name = $('profileName').value) {
    if (this.host.isBusy()) return false;
    const profile = normalizeProfile({ ...this.current, name, id: this.id || store.newId() });
    const items = [profile, ...this.items.filter(p => p.id !== profile.id)];
    if (!store.saveProfiles(items)) return false;
    this.items = items; this.id = profile.id; this.host.settings.profileId = profile.id;
    this.host.saveSettings(); this.render(); this.host.toast('Profil je sačuvan.'); return true;
  }
  newProfile() {
    if (this.host.isBusy()) return;
    this.id = ''; this.host.settings.profileId = ''; this.host.saveSettings(); this.render();
    $('profileName').value = t('Moj uređaj'); this.host.toast('Novi profil koristi trenutnu mapu i kalibraciju.');
  }
  exportProfile(name = $('profileName').value) {
    store.download('drummer-kit-profile.json', { type: 'drummer-kit-profile', version: 1, profile: { ...this.current, name } });
  }
  async importProfile(file) {
    if (this.host.isBusy()) return false;
    try {
      if (file.size > 200000) throw new Error();
      const data = JSON.parse(await file.text());
      if (this.host.isBusy()) return false;
      if (data.type !== 'drummer-kit-profile' || data.version !== 1 || !data.profile || typeof data.profile.name !== 'string' || !data.profile.map || typeof data.profile.map !== 'object' || Array.isArray(data.profile.map) || !data.profile.kitConfig) throw new Error();
      const profile = normalizeProfile({ ...data.profile, id: store.newId() });
      const items = [...this.items, profile]; if (!store.saveProfiles(items)) return false;
      this.items = items; this.apply(profile); this.render(); this.host.toast('Profil je uvezen.'); return true;
    } catch { this.host.toast('Fajl nije ispravan profil bubnja.'); return false; }
  }
  bind() {
    $('profileSelect').onchange = e => { const p = this.items.find(p => p.id === e.target.value); if (p) { this.apply(p); this.render(); } };
    $('profileSave').onclick = () => this.save();
    $('profileNew').onclick = () => this.newProfile();
    $('profileDelete').onclick = () => {
      if (!this.id || !confirm('Obrisati izabrani profil uređaja?')) return;
      const items = this.items.filter(p => p.id !== this.id);
      if (!store.saveProfiles(items)) return;
      this.items = items; this.id = ''; this.host.settings.profileId = ''; this.host.saveSettings(); this.render();
    };
    $('profileCurve').onchange = e => { this.host.settings.velocityCurve = e.target.value; this.host.saveSettings(); };
    $('profileGain').onchange = e => { this.host.settings.velocityGain = bounded(e.target.value, .5, 2, 1); e.target.value = this.host.settings.velocityGain; this.host.saveSettings(); };
    $('profileMatch').onclick = () => {
      const p = this.items.find(p => p.device && this.inputs.some(i => i.name === p.device));
      if (!p) return this.host.toast('Nema sačuvanog profila za povezani uređaj.');
      this.apply(p); this.render(); this.host.toast(`Učitan profil: ${p.name}`);
    };
  }
  devices(inputs) { this.inputs = inputs || []; this.renderDevices(); }
  renderDevices() {
    const chosen = $('profileDevice').value || this.items.find(p => p.id === this.id)?.device || '';
    const names = [...new Set([chosen, ...this.inputs.map(i => i.name)].filter(Boolean))];
    $('profileDevice').replaceChildren(new Option('Tastatura / bilo koji uređaj', ''), ...names.map(name => new Option(name, name)));
    $('profileDevice').value = chosen;
  }
  render() {
    $('profileSelect').replaceChildren(new Option('Trenutna podešavanja', ''), ...this.items.map(p => {
      const option = new Option(p.name, p.id); option.dataset.userText = ''; return option;
    }));
    $('profileSelect').value = this.id;
    $('profileName').value = this.items.find(p => p.id === this.id)?.name || t('Moj uređaj');
    $('profileDevice').value = this.items.find(p => p.id === this.id)?.device || '';
    this.renderDevices();
    $('profileCurve').value = this.host.settings.velocityCurve || 'linear';
    $('profileGain').value = this.host.settings.velocityGain || 1;
    this.playState(); this.host.profileChanged?.();
  }
  playState() {
    for (const el of $('deviceProfiles').querySelectorAll('button,input,select')) el.disabled = this.host.isBusy();
    $('profileDelete').disabled ||= !this.id;
  }
}
