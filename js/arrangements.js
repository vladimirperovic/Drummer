import { normalize, resize, barMs } from './patterns.js';
import { bounded } from './practice.js';
import * as store from './storage.js';
import { t } from './i18n.js';
import { navigate, adoptPane } from './navigation.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function normalizeArrangement(value = {}) {
  return { id: typeof value.id === 'string' ? value.id : null,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 120) : 'Moja pesma',
    sections: (Array.isArray(value.sections) ? value.sections : []).filter(s => s?.pattern?.steps).slice(0, 128).map((section, index) => {
      const pattern = normalize(section.pattern);
      return { name: typeof section.name === 'string' && section.name.trim() ? section.name.trim().slice(0, 80) : `Deonica ${index + 1}`,
        pattern, repeats: Math.round(bounded(section.repeats, 1, 64, 1)), bpm: Math.round(bounded(section.bpm, 30, 260, pattern.bpm)) };
    }) };
}
export function compileArrangement(value) {
  const arrangement = normalizeArrangement(value);
  return arrangement.sections.map((section, index) => {
    const pattern = normalize({ ...section.pattern, bpm: section.bpm });
    const bars = pattern.bars * section.repeats;
    return { ...section, pattern, bars, durationBars: bars, durationSeconds: bars * barMs(pattern) / 1000, seconds: bars * barMs(pattern) / 1000, index, rest: 0, target: 0 };
  });
}

export class ArrangementEditor {
  constructor(studio) {
    this.studio = studio; this.items = store.loadArrangements().map(normalizeArrangement).filter(a => a.id);
    const draft = store.loadArrangementDraft(); this.draft = normalizeArrangement(draft || { name: t('Moja pesma') }); this.dirty = !!draft;
    const panel = document.createElement('section'); panel.id = 'studio-arrangement'; panel.className = 'studio-panel'; panel.hidden = true;
    panel.innerHTML = `<h3>Aranžman cele pesme</h3><p>Dodaj uvod, strofu, refren i prelaz. Svaka deonica čuva svoj ritam, meru, tempo i tačan broj ponavljanja.</p><div class="row"><select id="arrangementSelect" aria-label="Sačuvani aranžmani"></select><button id="arrangementNew">Novi aranžman</button><button id="arrangementSave">Sačuvaj aranžman</button><button id="arrangementDelete">Obriši aranžman</button></div><label>Naziv pesme <input id="arrangementName" type="text" maxlength="120" data-user-text></label><div class="row"><button id="arrangementAdd">Dodaj trenutni ritam kao deonicu</button><button id="arrangementExport">Izvezi aranžman</button><label class="button">Uvezi aranžman<input id="arrangementImport" type="file" accept=".json,application/json" hidden></label></div><ol id="arrangementSections" class="program-list"></ol><p id="arrangementSummary" aria-live="polite"></p><div class="row"><button id="arrangementStart">▶ Pokreni aranžman</button><button id="arrangementStop">■ Zaustavi aranžman</button></div><p id="arrangementStatus" role="status"></p>`;
    adoptPane(panel, 'arrangement', 'practice'); this.panel = panel;
    const $ = id => panel.querySelector('#' + id); this.$ = $;
    const abandon = () => !this.dirty || confirm(t('Odbaciti nesačuvane izmene aranžmana?'));
    $('arrangementNew').onclick = () => { if (abandon()) { this.draft = normalizeArrangement({ name: t('Moja pesma') }); this.dirty = false; this.render(); } };
    $('arrangementSelect').onchange = event => {
      const item = this.items.find(a => a.id === event.target.value);
      if (item && abandon()) { this.draft = structuredClone(item); this.dirty = false; } this.render();
    };
    $('arrangementName').oninput = event => { this.draft.name = event.target.value; this.dirty = true; store.saveArrangementDraft(this.draft); };
    $('arrangementAdd').onclick = () => {
      if (this.busy) return;
      if (this.draft.sections.length >= 128) return studio.host.toast('Aranžman može imati najviše 128 deonica.');
      const pattern = structuredClone(studio.host.getPattern());
      this.draft.sections.push({ name: pattern.name, pattern, repeats: 1, bpm: pattern.bpm }); this.dirty = true; this.render();
    };
    $('arrangementSections').onchange = event => {
      const field = event.target.dataset.field, index = Number(event.target.dataset.index), section = this.draft.sections[index];
      if (!field || !section || this.busy) return;
      if (field === 'name') section.name = event.target.value;
      else if (field === 'beats' || field === 'beatUnit') section.pattern = resize(section.pattern, { [field]: Number(event.target.value) });
      else section[field] = Number(event.target.value);
      this.draft = normalizeArrangement(this.draft); this.dirty = true; this.render();
    };
    $('arrangementSections').onclick = event => {
      const button = event.target.closest('[data-action]'); if (!button || this.busy) return;
      const index = Number(button.dataset.index), sections = this.draft.sections, action = button.dataset.action;
      if (action === 'edit') { if (this.studio.host.loadPattern(sections[index].pattern)) navigate('editor'); return; }
      if (action === 'replace') sections[index].pattern = structuredClone(this.studio.host.getPattern());
      if (action === 'remove') sections.splice(index, 1);
      if (action === 'copy' && sections.length < 128) sections.splice(index + 1, 0, structuredClone(sections[index]));
      if (action === 'up' || action === 'down') { const to = index + (action === 'up' ? -1 : 1); if (to >= 0 && to < sections.length) [sections[index], sections[to]] = [sections[to], sections[index]]; }
      this.dirty = true; this.render();
    };
    $('arrangementSave').onclick = () => {
      if (this.busy || !this.draft.sections.length) return studio.host.toast('Dodaj bar jednu deonicu u aranžman.');
      const item = normalizeArrangement({ ...this.draft, id: this.draft.id || store.newId() });
      const items = [item, ...this.items.filter(a => a.id !== item.id)]; if (!store.saveArrangements(items)) return;
      this.items = items; this.draft = structuredClone(item); this.dirty = false; this.render(); studio.host.toast('Aranžman je sačuvan.');
    };
    $('arrangementDelete').onclick = () => {
      if (this.busy || !this.draft.id || !confirm(t('Obrisati izabrani aranžman?'))) return;
      const items = this.items.filter(a => a.id !== this.draft.id); if (!store.saveArrangements(items)) return;
      this.items = items; this.draft = normalizeArrangement({ name: t('Moja pesma') }); this.dirty = false; this.render();
    };
    $('arrangementExport').onclick = () => store.download('drummer-aranzman.json', { type: 'drummer-arrangement', version: 1, arrangement: this.draft });
    $('arrangementImport').onchange = async event => {
      const file = event.target.files[0]; event.target.value = ''; if (!file || this.busy) return;
      try {
        if (file.size > 5 * 1024 * 1024) throw new Error();
        const data = JSON.parse(await file.text());
        if (this.busy) return;
        if (data.type !== 'drummer-arrangement' || data.version !== 1 || !Array.isArray(data.arrangement?.sections) || !data.arrangement.sections.length || data.arrangement.sections.some(s => !s?.pattern?.steps)) throw new Error();
        const item = normalizeArrangement({ ...data.arrangement, id: store.newId() }), items = [item, ...this.items];
        if (!store.saveArrangements(items)) return;
        this.items = items; this.draft = structuredClone(item); this.dirty = false; this.render(); studio.host.toast('Aranžman je uvezen.');
      } catch { studio.host.toast('Fajl nije ispravan aranžman.'); }
    };
    $('arrangementStart').onclick = () => studio.startArrangement();
    $('arrangementStop').onclick = () => { studio.host.stop(); studio.cancelProgram(); };
    this.render();
  }
  get busy() { return this.studio.host.isPlaying() || !!this.studio.run || this.studio.backupRestore?.running || this.studio.replay.playing || this.studio.replay.starting; }
  render() {
    store.saveArrangementDraft(this.dirty ? this.draft : null);
    const $ = this.$;
    $('arrangementName').value = this.draft.name;
    $('arrangementSelect').innerHTML = '<option value="">Izaberi aranžman…</option>' + this.items.map(a => `<option value="${esc(a.id)}" data-user-text>${esc(a.name)}</option>`).join('');
    $('arrangementSelect').value = this.draft.id || '';
    $('arrangementSections').innerHTML = this.draft.sections.map((s, i) => `<li class="program-entry"><header><strong>${i + 1}.</strong><input type="text" maxlength="80" data-user-text data-field="name" data-index="${i}" value="${esc(s.name)}" aria-label="Naziv deonice"><div class="row"><button data-action="up" data-index="${i}" aria-label="Gore">↑</button><button data-action="down" data-index="${i}" aria-label="Dole">↓</button><button data-action="edit" data-index="${i}">Uredi note</button><button data-action="replace" data-index="${i}">Preuzmi trenutni ritam</button><button data-action="copy" data-index="${i}">Kopiraj</button><button data-action="remove" data-index="${i}">Ukloni</button></div></header><p data-user-text>${esc(s.pattern.name)}</p><div class="form-row"><label>Ponavljanja <input type="number" min="1" max="64" data-field="repeats" data-index="${i}" value="${s.repeats}"></label><label>BPM <input type="number" min="30" max="260" data-field="bpm" data-index="${i}" value="${s.bpm}"></label><label>Doba u taktu <input type="number" min="2" max="7" data-field="beats" data-index="${i}" value="${s.pattern.beats}"></label><label>Jedinica mere <select data-field="beatUnit" data-index="${i}"><option value="4" ${s.pattern.beatUnit === 4 ? 'selected' : ''}>/4</option><option value="8" ${s.pattern.beatUnit === 8 ? 'selected' : ''}>/8</option></select></label><span>${s.pattern.bars * s.repeats} ${t('taktova ukupno')}</span></div></li>`).join('');
    const entries = compileArrangement(this.draft), seconds = entries.reduce((sum, entry) => sum + entry.seconds, 0), bars = entries.reduce((sum, e) => sum + e.bars, 0);
    $('arrangementSummary').textContent = `${entries.length} ${t('deonica')} · ${bars} ${t('taktova ukupno')} · ${(seconds / 60).toFixed(1)} min`;
    this.playState(); document.dispatchEvent(new Event('drummer:translate'));
  }
  playState() {
    for (const element of this.panel.querySelectorAll('button,input,select')) element.disabled = this.busy;
    this.$('arrangementStop').disabled = this.studio.run?.kind !== 'arrangement';
  }
  status(message) { this.$('arrangementStatus').textContent = message; }
}
