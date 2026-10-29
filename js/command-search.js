// Ctrl+K search over every section, control and pattern. The index is read from
// the live (already translated) DOM when the dialog opens, so new panels are
// searchable without registering them here; KEYWORDS only adds synonyms.
import { EN, t, getLanguage } from './i18n.js';
import { searchText } from './preset-catalog.js';
import { navigate } from './navigation.js';

const KEYWORDS = {
  kit: 'drum kit bubanj 2d 3d pad', library: 'ritmovi patterns biblioteka library favoriti', editor: 'uredi edit grid mreza note',
  practice: 'vjezbanje vezbanje practice', song: 'pjesma pesma song mp3 audio', results: 'rezultat results ocena score', settings: 'podesavanja settings',
  import: 'midi mid uvoz import', print: 'pdf stampa print papir', focus: 'a-b ab petlja loop deo takt fokus', program: 'program rutina routine',
  trainer: 'trener ubrzaj tempo speed up tihi silent', ai: 'ai demucs adtof transkripcija transcription stem analiza',
  arrangement: 'aranzman arrangement deonice sections refren strofa', backing: 'podloga backing mp3 wav pjesma pesma brzina',
  stats: 'tacnost accuracy rezultat trenutno', journal: 'dnevnik journal istorija history napredak progress', replay: 'replay preslusaj slusaj listen',
  device: 'td-17 roland midi mapa map profil profile uredjaj', timing: 'strogost zvuk sound volume jacina tastatura keyboard', app: 'offline install pwa backup rezervna kopija mcp codex azuriranje',
  metro: 'metronom klik click', bpm: 'tempo bpm brzina speed', calib: 'latency kasnjenje kalibracija offset', kitConfigurator: 'set tomovi cinele raspored layout levoruki left',
  exerciseGenerator: 'rudiment fill generator paradiddle', midiRouting: 'kanal channel rutiranje routing', quiet: 'tihi taktovi silent gap',
  level: 'strogost strictness tolerancija', kitSelect: 'zvuk sound samples wav', captureRhythm: 'snimi record capture', importSong: 'musicxml partitura score xml',
};
const REVERSE = Object.fromEntries(Object.entries(EN).map(([sr, en]) => [en, sr]));
// Collapse ijekavian forms (vježbanje → vezbane) on both sides of the match.
const norm = value => searchText(value).replace(/ije/g, 'e').replace(/([^aeiou\s])je/g, '$1e');
const clean = el => {
  const copy = el.cloneNode(true);
  for (const control of copy.querySelectorAll('select,input,textarea,output,svg,small')) control.remove();
  return copy.textContent.replace(/\s+/g, ' ').replace(/[:…]+$/, '').trim();
};
const other = text => getLanguage() === 'en' ? REVERSE[text] || '' : t(text, 'en');
const paneOf = el => el.closest('[data-pane-panel]')?.dataset.panePanel;

export function createCommandSearch(host) {
  const dialog = document.createElement('dialog'); dialog.id = 'commandSearch'; dialog.className = 'command-search';
  dialog.innerHTML = `<input id="commandSearchInput" type="search" autocomplete="off" spellcheck="false" placeholder="Traži funkciju, podešavanje ili ritam…" aria-label="Pretraga funkcija i ritmova" aria-controls="commandSearchResults">
    <ul id="commandSearchResults" role="listbox" aria-label="Rezultati pretrage"></ul><p class="muted command-search-hint">↑↓ izbor · Enter otvori · Esc zatvori</p>`;
  document.body.append(dialog);
  const input = dialog.querySelector('input'), list = dialog.querySelector('ul');
  let items = [], shown = [], active = 0;

  function build() {
    const out = [], seen = new Set();
    const add = item => { const key = item.group + item.label; if (item.label && !seen.has(key)) { seen.add(key); out.push(item); } };
    const sectionName = id => document.querySelector(`#appNav [data-section="${id}"] span`)?.textContent || id;
    for (const button of document.querySelectorAll('#appNav [data-section]')) {
      const id = button.dataset.section, label = button.textContent.trim();
      add({ group: 'Sekcije', label, keys: `${other(label)} ${KEYWORDS[id] || ''}`, run: () => navigate(id, { reveal: true }) });
    }
    for (const button of document.querySelectorAll('.subtabs [data-pane]')) {
      const pane = button.dataset.pane, label = clean(button), section = button.closest('[data-section-panel]').dataset.sectionPanel;
      add({ group: 'Sekcije', label: `${sectionName(section)} › ${label}`, keys: `${other(label)} ${KEYWORDS[pane] || ''}`, run: () => navigate(pane, { reveal: true }) });
    }
    // Header controls act directly; everything else opens its pane and focuses the control.
    for (const el of document.querySelectorAll('.bar button[id], .bar label.tog')) {
      if (el.hidden || el.id === 'appUpdate') continue;
      const box = el.querySelector('input[type=checkbox]'), label = clean(el), id = box?.id || el.id;
      add({ group: 'Radnje', label, state: box ? (box.checked ? 'uključeno' : 'isključeno') : '', keys: `${other(label)} ${KEYWORDS[id] || ''}`,
        run: () => { (box || el).click(); if (box) host.toast(`${label}: ${box.checked ? t('uključeno') : t('isključeno')}`); } });
    }
    for (const el of document.querySelectorAll('#sections [data-pane-panel] :is(h2, h3, summary, legend, label, button[id])')) {
      const pane = paneOf(el), label = clean(el);
      if (!pane || el.closest('.subtabs, .list, .pagination') || label.length < 3 || label.length > 70) continue;
      const target = el.matches('label') ? el.querySelector('input,select,textarea') || el : el;
      const holder = el.closest('details[id]')?.id || el.closest('[id]')?.id || '';
      const where = sectionName(el.closest('[data-section-panel]').dataset.sectionPanel);
      add({ group: 'Podešavanja i kontrole', label, context: where, keys: `${other(label)} ${KEYWORDS[target.id] || ''} ${KEYWORDS[holder] || ''} ${KEYWORDS[pane] || ''}`,
        run: () => reveal(pane, target, el) });
    }
    for (const p of host.patterns()) add({ group: 'Ritmovi', label: p.preset ? t(p.name) : p.name, context: `${p.beats}/${p.beatUnit || 4}`, user: !p.preset,
      keys: `${p.name} ${p.nameEn || ''} ${p.category || ''} ${p.beats}/${p.beatUnit || 4} ${p.preset ? '' : 'moji mine'}`, run: () => host.loadPattern(p) });
    for (const item of out) { item.n = norm(item.label); item.k = norm(`${item.keys} ${item.context || ''}`); }
    return out;
  }

  function reveal(pane, target, heading) {
    navigate(pane);
    for (let d = heading.closest('details'); d; d = d.parentElement.closest('details')) d.open = true;
    const el = target.offsetParent ? target : heading;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (el.matches('input,select,textarea,button,summary')) el.focus({ preventScroll: true });
    el.classList.remove('search-hit'); void el.offsetWidth; el.classList.add('search-hit');
    setTimeout(() => el.classList.remove('search-hit'), 1600);
  }

  function score(item, terms, whole) {
    let total = item.n.startsWith(whole) ? 6 : 0;
    for (const term of terms) {
      const at = item.n.indexOf(term);
      if (at === 0 || (at > 0 && /\W/.test(item.n[at - 1]))) total += 3;
      else if (at > 0) total += 2;
      else if (item.k.includes(term)) total += 1;
      else return 0;
    }
    return total + (item.group === 'Sekcije' ? .5 : 0);
  }

  function render() {
    const whole = norm(input.value.trim()), terms = whole.split(/\s+/).filter(Boolean);
    const groups = new Map();
    const ranked = terms.length
      ? items.map(item => [item, score(item, terms, whole)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([item]) => item)
      : items.filter(item => item.group === 'Sekcije' && !item.label.includes('›'));
    for (const item of ranked) {
      const group = groups.get(item.group) || []; if (group.length < (terms.length ? 6 : 8)) group.push(item); groups.set(item.group, group);
    }
    shown = ['Sekcije', 'Radnje', 'Podešavanja i kontrole', 'Ritmovi'].flatMap(name => groups.get(name) || []);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.replaceChildren(); let last = '';
    if (!shown.length) list.innerHTML = '<li class="command-empty muted">Nema rezultata</li>';
    shown.forEach((item, index) => {
      if (item.group !== last) { last = item.group; const h = document.createElement('li'); h.className = 'command-group'; h.textContent = item.group; h.setAttribute('role', 'presentation'); list.append(h); }
      const li = document.createElement('li'); li.id = `commandItem${index}`; li.setAttribute('role', 'option'); li.className = 'command-item';
      li.setAttribute('aria-selected', String(index === active));
      const label = document.createElement('span'); label.textContent = item.label; if (item.user || item.group !== 'Ritmovi') label.dataset.userText = '';
      li.append(label);
      if (item.state || item.context) { const meta = document.createElement('small'); meta.textContent = item.state ? t(item.state) : item.context; meta.dataset.userText = ''; li.append(meta); }
      li.onpointerdown = event => event.preventDefault();
      li.onclick = () => choose(index);
      list.append(li);
    });
    input.setAttribute('aria-activedescendant', shown.length ? `commandItem${active}` : '');
    list.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }

  function choose(index) {
    const item = shown[index]; if (!item) return;
    close(); item.run();
  }
  function open() {
    if (dialog.open) return input.select();
    items = build(); input.value = ''; active = 0; render();
    dialog.showModal(); input.focus();
  }
  function close() { if (dialog.open) dialog.close(); }

  input.oninput = () => { active = 0; render(); };
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); if (!shown.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; render();
    } else if (event.key === 'Enter') { event.preventDefault(); choose(active); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); close(); }
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyK') { event.preventDefault(); event.stopImmediatePropagation(); open(); }
  }, true);
  return { open, close, get isOpen() { return dialog.open; } };
}
