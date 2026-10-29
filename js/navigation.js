// One navigation owns which section and sub-pane is visible. Panes are marked
// with data-pane-panel and grouped by their section; buttons only name a pane
// (data-pane) or a section (data-section). Older call sites used separate
// tool/studio tabs; their former names resolve to the pane that replaced them.
const LEGACY = { tools: 'import' };
const remembered = new Map();
let current = { section: '', pane: '' };
// Dva režima rada sa sopstvenim menijem: Note (ritmovi, editor, vežbanje, rezultati) i Pesma
// (analiza, sviranje, izveštaj). Bubanj i podešavanja važe za oba.
const MODE_OF = { library: 'notes', editor: 'notes', practice: 'notes', results: 'notes', song: 'song' };
const MODE_KEY = 'drummer.mode.v1';
let lastNotesSection = 'kit';
export const currentMode = () => document.body.dataset.mode === 'song' ? 'song' : 'notes';
export function setMode(mode) {
  mode = mode === 'song' ? 'song' : 'notes';
  const changed = document.body.dataset.mode !== mode;
  document.body.dataset.mode = mode;
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
  if (changed) document.dispatchEvent(new CustomEvent('drummer:mode', { detail: { mode } }));
}

const sectionOf = el => el?.closest('[data-section-panel]');
const paneEl = name => document.querySelector(`[data-pane-panel="${CSS.escape(name)}"]`);

export const currentView = () => ({ ...current });

// Modules that build their own panel hand it to the section that should own it.
export function adoptPane(element, pane, sectionId) {
  element.dataset.panePanel = pane;
  const section = document.getElementById(`section-${sectionId}`);
  if (section && !section.contains(element)) section.append(element);
  element.hidden = current.pane !== pane;
}

// Accepts a pane name, a section name (opens its last pane) or a legacy name.
export function navigate(target, { reveal = false } = {}) {
  let section, pane;
  if (paneEl(target)) { pane = target; section = sectionOf(paneEl(target))?.dataset.sectionPanel; }
  else if (document.getElementById(`section-${target}`)) {
    const root = document.getElementById(`section-${target}`);
    section = target;
    pane = remembered.get(section) || root.querySelector('.subtabs [data-pane]')?.dataset.pane || root.querySelector('[data-pane-panel]')?.dataset.panePanel;
  } else if (LEGACY[target]) return navigate(LEGACY[target], { reveal });
  if (!section || !pane) return false;
  const root = document.getElementById(`section-${section}`);
  for (const other of document.querySelectorAll('[data-section-panel]')) other.hidden = other !== root;
  // Exactly one pane is unhidden, so `hidden` keeps meaning "not on screen".
  for (const panel of document.querySelectorAll('[data-pane-panel]')) panel.hidden = panel.dataset.panePanel !== pane;
  // Meni ima sekcije (Note) i korake pesme kao pojedinačne panele (Pesma).
  for (const button of document.querySelectorAll('#appNav [data-section], #appNav [data-pane]')) {
    const active = button.dataset.pane ? button.dataset.pane === pane : button.dataset.section === section;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  for (const button of root.querySelectorAll('.subtabs [data-pane]')) {
    const active = button.dataset.pane === pane;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
  remembered.set(section, pane);
  if (MODE_OF[section]) setMode(MODE_OF[section]);
  if (MODE_OF[section] === 'notes' || section === 'kit') lastNotesSection = section;
  const changed = current.pane !== pane;
  current = { section, pane };
  document.body.dataset.section = section;
  // The phone navigation is fixed to the bottom edge, so a section can open
  // below the fold. Bring its top into view only when it is not already there.
  if (reveal) {
    const top = root.getBoundingClientRect().top, header = document.querySelector('.bar')?.getBoundingClientRect().bottom || 0;
    if (top < header || top > innerHeight - 160) root.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  document.dispatchEvent(new CustomEvent('drummer:pane', { detail: { section, pane, changed } }));
  return true;
}

export function setupNavigation(initial = 'kit') {
  for (const nav of document.querySelectorAll('.subtabs')) nav.setAttribute('role', 'tablist');
  for (const button of document.querySelectorAll('.subtabs [data-pane]')) button.setAttribute('role', 'tab');
  let saved = 'notes';
  try { saved = localStorage.getItem(MODE_KEY) || 'notes'; } catch {}
  setMode(saved);
  document.addEventListener('click', event => {
    const mode = event.target.closest('button[data-mode]');
    if (mode && !mode.disabled) {
      if (mode.dataset.mode === currentMode()) return;
      setMode(mode.dataset.mode);
      navigate(mode.dataset.mode === 'song' ? 'song' : lastNotesSection, { reveal: true });
      return;
    }
    const button = event.target.closest('button[data-section], button[data-pane]');
    if (!button || button.disabled) return;
    navigate(button.dataset.pane || button.dataset.section, { reveal: true });
  });
  navigate(initial);
}
