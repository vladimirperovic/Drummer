# Drummer WebMCP

Drummer registers page-scoped tools with `document.modelContext.registerTool`, with a `navigator.modelContext` fallback. This is a **WebMCP connection to the open page**, not a standalone HTTP/stdio server. It operates on the same rhythm, playback and local data shown to the user. Implementation: [js/agent-tools.js](js/agent-tools.js), application adapter in [js/main.js](js/main.js). API reference: [OpenAI WebMCP guide](https://learn.chatgpt.com/docs/webmcp).

Open Drummer in the Codex browser and check **Settings / Podešavanja → App and data / Aplikacija i podaci → MCP connector / MCP konektor**. “Ready” confirms registration. The switch disables all calls, including reads, and persists across reloads. Unsupported browsers show guidance while all ordinary controls remain usable. Tool discovery refreshes after navigation; browser-generated suffixes are not stable identifiers.

| Tool | Input / result |
| --- | --- |
| `drummer_get_state` | Current pattern metadata, playback/busy/dirty flags, options, focus, view, language, MIDI connection, favorite count and `kitConfig` (part counts, handedness and custom floor-position offsets). |
| `drummer_list_patterns` | Optional `category`, `source`, bilingual `query`, `favoritesOnly`, `offset`, `limit` (1–100, default 20). Returns total and metadata with stable IDs and favorite flags. |
| `drummer_get_pattern` | Optional `id`; omitted means current pattern. Returns note data without loading it. |
| `drummer_load_pattern` | Required `id` from the catalog/library. Playback must be stopped and the current pattern saved. |
| `drummer_set_favorite` | Required `id`, `favorite` boolean. Persists locally without changing notes or playback. |
| `drummer_set_tempo` | Required integer `bpm`, 30–260. Normal playback supports live changes; backing playback, programs, replay, startup and calibration block them. |
| `drummer_set_options` | At least one boolean: `metro`, `countIn`, `loop`, `playPattern`, `liveSound`. Requires idle playback. |
| `drummer_start` | Optional `durationSeconds`, integer 1–3600. Uses the app Start operation and journal. Audio must first be activated by interacting with the page. Repeated calls while playing do not restart. |
| `drummer_stop` | Stops playback/pending start, replay and practice program; finalizes an active exercise in the journal. |
| `drummer_set_view` | At least one: `section` (kit/library/editor/practice/song/results/settings), legacy `view` (kit/editor/practice/tools) or `panel` (library/stats/settings), `kitView` (2d/3d), `notesOnly` boolean, `rows` (0/1/2/4/8). |
| `drummer_set_focus` | Required `enabled`, 1-based `from`/`to` bars, distinct `instruments` from state/pattern data. Range must fit current pattern. Requires idle playback. |
| `drummer_get_results` | Optional `limit`, 1–20, default 5. Current compact scoring, total session count and recent summaries; no raw hits/timeline/audio/profile data. |
| `drummer_set_language` | Required `language`: sr/en. Preserves note data and custom names. |

Read tools carry `readOnlyHint: true`. Calls return `{ok: true, ...data}` or `{ok: false, error: {code, message}}`. Inputs reject unknown properties, implicit coercion, invalid enums/ranges and unsupported instruments. Errors include `INVALID_ARGUMENT`, `INVALID_RANGE`, `NOT_FOUND`, `DISABLED`, `BUSY`, `UNSAVED_EDITS`, `AUDIO_LOCKED`, `START_FAILED`, `STORAGE_FAILED` and `VIEW_UNAVAILABLE`. A failed command never requests automatic approval to discard unsaved work. Stop remains available while an asynchronous write is pending; other writes are serialized.

No arbitrary script, file, credential, remote network, device-mapping or data-deletion tools are exposed. Start may play audio and send to the MIDI output already selected in the app. Favoriting has its own local storage key, `drummer.favorites.v1`; exported emergency backups include favorite IDs. Normal JSON rhythm imports create new IDs and do not restore favorites from a backup automatically.

Tests: `qa/agent.test.mjs` validates contracts and guards; `qa/library-browser.mjs` exercises registered tool callbacks against the real app in isolated profiles, including playback/journal, favorites, storage failure, disabled/unsupported APIs and offline usage. Actual discovery, reading, adding/removing a favorite and filtered search were also checked through Codex's WebMCP bridge on the open page. Simulated browser registration tests alone are not a claim of external-client interoperability.
