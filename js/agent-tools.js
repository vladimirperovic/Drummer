// WebMCP tools share the application's existing operations. No HTTP listener,
// credentials, general JavaScript execution or access outside this page.
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const choice = values => ({ type: 'string', enum: values });
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const bool = { type: 'boolean' };
export class ToolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new ToolError(code, message); };

export function validateArguments(schema, value, path = 'arguments') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_ARGUMENT', `${path} must be an object.`);
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail('INVALID_ARGUMENT', `${path}.${key} is required.`);
    if (schema.minProperties && Object.keys(value).length < schema.minProperties) fail('INVALID_ARGUMENT', 'Provide at least one setting.');
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) fail('INVALID_ARGUMENT', `Unknown argument: ${path}.${key}`);
      validateArguments(schema.properties[key], item, `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems || (schema.uniqueItems && new Set(value).size !== value.length)) fail('INVALID_ARGUMENT', `Invalid list: ${path}`);
    value.forEach((v, i) => validateArguments(schema.items, v, `${path}[${i}]`));
  } else {
    if (schema.type === 'integer' ? !Number.isInteger(value) : typeof value !== schema.type) fail('INVALID_ARGUMENT', `Invalid type: ${path}`);
    if (schema.enum && !schema.enum.includes(value)) fail('INVALID_ARGUMENT', `Unsupported value: ${path}`);
    if (typeof value === 'number' && (value < schema.minimum || value > schema.maximum)) fail('INVALID_ARGUMENT', `Out of range: ${path}`);
    if (typeof value === 'string' && (value.length < (schema.minLength || 0) || value.length > schema.maxLength)) fail('INVALID_ARGUMENT', `Invalid length: ${path}`);
  }
}

export function createDrummerTools(host) {
  let writing = false;
  const state = () => host.getState();
  const idle = () => {
    const s = state();
    if (s.playing || s.starting || s.programRunning || s.calibrating || s.replaying) fail('BUSY', 'Stop playback, replay, the practice program or calibration first.');
    return s;
  };
  const tool = (name, description, inputSchema, readOnly, run) => ({
    name: `drummer_${name}`, description, inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false, idempotentHint: name !== 'start' },
    async execute(args = {}) {
      let acquired = false;
      try {
        validateArguments(inputSchema, args);
        if (!host.isEnabled()) fail('DISABLED', 'Drummer site tools are disabled in Tools → MCP connector.');
        if (!readOnly && name !== 'stop') {
          const current = state();
          if (current.capturing || current.restoring || current.aiBusy) fail('BUSY', 'Finish rhythm capture or backup restore before changing Drummer.');
          if (writing) fail('BUSY', 'Another Drummer command is still running.');
          writing = acquired = true;
        }
        const result = structuredClone(await run(args));
        host.onCall?.(name, true);
        return { ok: true, ...result };
      } catch (error) {
        host.onCall?.(name, false);
        return { ok: false, error: { code: error.code || 'OPERATION_FAILED', message: error.message || 'Drummer command failed.' } };
      } finally { if (acquired) writing = false; }
    },
  });
  const options = object(Object.fromEntries(['metro', 'countIn', 'loop', 'playPattern', 'liveSound'].map(k => [k, bool]))); options.minProperties = 1;
  return [
    tool('get_state', 'Read the live Drummer pattern, BPM, playback/options, view, MIDI connection and unsaved-edit status.', object(), true, state),
    tool('list_patterns', 'Search built-in and saved Drummer patterns in Serbian or English. Returns stable IDs and metadata, not note data. Category all includes every meter.', object({
      category: choice(['all', 'basics', 'latin', 'rock', 'jazz', 'three-eight']), source: choice(['all', 'presets', 'saved']),
      query: { type: 'string', maxLength: 120 }, favoritesOnly: bool, offset: integer(0, 100000), limit: integer(1, 100),
    }), true, args => host.listPatterns({ category: 'all', source: 'all', query: '', favoritesOnly: false, offset: 0, limit: 20, ...args })),
    tool('set_favorite', 'Add or remove a built-in or saved pattern from Favorites by ID. Persists locally and does not load the pattern or interrupt playback.', object({ id: text(200), favorite: bool }, ['id', 'favorite']), false, args => {
      if (!host.getPattern(args.id)) fail('NOT_FOUND', 'Pattern ID was not found. Use drummer_list_patterns.');
      if (!host.setFavorite(args.id, args.favorite)) fail('STORAGE_FAILED', 'Favorites could not be saved. Check storage in the app.');
      return { id: args.id, favorite: args.favorite };
    }),
    tool('get_pattern', 'Read the current pattern or a pattern by ID, including all instrument steps, dynamics and sticking. Does not load or play it.', object({ id: text(200) }), true, args => {
      const pattern = host.getPattern(args.id); if (!pattern) fail('NOT_FOUND', 'Pattern ID was not found. Use drummer_list_patterns.');
      return { pattern };
    }),
    tool('load_pattern', 'Load a built-in or saved pattern by ID. Requires stopped playback and no unsaved pattern edits. Does not discard or save edits.', object({ id: text(200) }, ['id']), false, args => {
      const s = idle(); if (s.unsavedPattern) fail('UNSAVED_EDITS', 'Save the current pattern in the app before loading another one.');
      const p = host.getPattern(args.id); if (!p) fail('NOT_FOUND', 'Pattern ID was not found. Use drummer_list_patterns.');
      if (!host.loadPattern(p)) fail('OPERATION_FAILED', 'Pattern was not loaded.'); return state();
    }),
    tool('set_tempo', 'Set quarter-note BPM from 30 to 260 using Drummer tempo controls. Fails while a backing track or program controls the tempo.', object({ bpm: integer(30, 260) }, ['bpm']), false, args => {
      const s = state(); if (s.starting || s.calibrating || s.programRunning || s.replaying || (s.playing && s.backingEnabled)) fail('BUSY', 'Stop the backing track, program, replay or calibration before changing tempo.');
      host.setBpm(args.bpm); return state();
    }),
    tool('set_options', 'Set metronome, count-in, looping, reference-pattern playback or live monitoring. Requires stopped playback. Recording and device mapping are not changed.', options, false, args => {
      idle(); host.setOptions(args); return state();
    }),
    tool('start', 'Start the current rhythm and create a practice session; may play sound and send to the selected MIDI output. Optional durationSeconds stops automatically. Activate sound in the page first if the browser requires it. Repeated calls while playing do not restart.', object({ durationSeconds: integer(1, 3600) }), false, async args => {
      const s = state(); if (s.playing && !s.programRunning) return s;
      idle();
      if (!host.audioReady()) fail('AUDIO_LOCKED', 'Click once inside Drummer to enable browser audio, then retry.');
      if (!await host.start(args)) fail('START_FAILED', host.lastMessage() || 'Playback did not start.');
      return state();
    }),
    tool('stop', 'Stop playback, a pending start, replay and the practice program. A running exercise is finalized in the journal, as with the app Stop button.', object(), false, () => { host.stop(); return state(); }),
    tool('set_view', 'Change visible panels, 2D/3D drum view, notes-only mode or notation rows. Does not alter notes or stop playback.', { ...object({
      section: choice(['kit', 'library', 'editor', 'practice', 'song', 'results', 'settings']),
      view: choice(['kit', 'editor', 'practice', 'tools']), panel: choice(['library', 'stats', 'settings']),
      kitView: choice(['2d', '3d']), notesOnly: bool, rows: { type: 'integer', enum: [0, 1, 2, 4, 8] },
    }), minProperties: 1 }, false, async args => { await host.setView(args); return state(); }),
    tool('set_focus', 'Set an A–B bar range and scored instruments for the current pattern. Requires stopped playback. Other instruments remain audible. Bar numbering starts at 1.', object({
      enabled: bool, from: integer(1, 8), to: integer(1, 8), instruments: { type: 'array', minItems: 1, maxItems: host.instrumentIds.length, uniqueItems: true, items: choice(host.instrumentIds) },
    }, ['enabled', 'from', 'to', 'instruments']), false, args => {
      const s = idle(); if (args.from > args.to || args.to > s.pattern.bars) fail('INVALID_RANGE', 'A–B must fit within the current pattern and A must not exceed B.');
      host.setFocus(args); return state();
    }),
    tool('get_results', 'Read compact current scoring and recent practice-session summaries. No raw MIDI recordings, audio files or device profiles are returned.', object({ limit: integer(1, 20) }), true, args => host.getResults(args.limit || 5)),
    tool('set_language', 'Switch the interface between Serbian (sr) and English (en), preserving note data and custom pattern names.', object({ language: choice(['sr', 'en']) }, ['language']), false, args => { host.setLanguage(args.language); return state(); }),
  ];
}

export async function registerDrummerTools(tools, context) {
  if (typeof context?.registerTool !== 'function') return { status: 'unsupported', count: 0 };
  const registered = [];
  try {
    for (const tool of tools) { await context.registerTool(tool); registered.push(tool.name); }
    return { status: 'ready', count: registered.length };
  } catch {
    for (const name of registered) { try { await context.unregisterTool?.(name); } catch {} }
    return { status: 'error', count: 0 };
  }
}

export function setupAgentTools(host) {
  const enabled = document.getElementById('mcpEnabled'), status = document.getElementById('mcpStatus'), recent = document.getElementById('mcpLastCall');
  enabled.checked = host.settings.agentToolsEnabled !== false;
  let connection = { status: 'loading', count: 0 };
  function renderStatus() {
    status.textContent = !enabled.checked ? 'MCP upravljanje je isključeno.' : {
      loading: 'Pripremam MCP konektor…', ready: 'MCP konektor je spreman za ovu stranicu.',
      unsupported: 'Ovaj browser nema podršku za WebMCP. Otvori Drummer u Codex browseru.', error: 'MCP konektor nije mogao da se poveže. Osveži stranicu i pokušaj ponovo.',
    }[connection.status];
  }
  const tools = createDrummerTools({ ...host, isEnabled: () => enabled.checked, onCall(name, ok) {
    recent.textContent = `${ok ? '✓' : '×'} drummer_${name}`;
    recent.dataset.userText = ''; // Stable tool identifiers are not translated.
  } });
  enabled.onchange = () => { host.settings.agentToolsEnabled = enabled.checked; host.saveSettings(); renderStatus(); };
  document.getElementById('mcpToolCount').textContent = tools.length;
  const context = document.modelContext || navigator.modelContext;
  registerDrummerTools(tools, context).then(result => { connection = result; renderStatus(); });
  renderStatus();
  return { tools, get status() { return connection; } };
}
