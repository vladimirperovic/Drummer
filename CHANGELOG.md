# Changelog

## Unreleased

- Search (Ctrl+K or the magnifier in the menu) finds every section, setting, control and pattern in Serbian or English; header options toggle directly, other results open their tab and highlight the control.
- One navigation for everything below the score: Drum kit, Patterns, Edit, Practice, Song, Results and Settings, each with its own sub-tabs. On phones it becomes a bottom bar.
- Song groups AI analysis, the arrangement and the backing track as three connected steps, with a link to MusicXML scores. Results groups the current score, journal and replay; Settings groups device/MIDI, timing/sound and app/data (offline, backup, MCP).
- Tempo trainer and silent bars moved from Settings to Practice; the library gained "Record by playing" and "From a MIDI file" shortcuts.
- Compact phone header: transport on one row, tools and options in swipeable rows; notation options in one row.
- Fixes: header buttons no longer overlap the tempo controls at medium widths; messages appear at the bottom of the screen instead of off-screen inside the score; Space opens summary panels instead of starting playback; the hidden language label no longer widens the phone layout; stopping while recording in the editor stays in the editor.
- `drummer_set_view` accepts `section`; `get_state` reports the active section and pane.

## 2026-10-29

- Completed the five roadmap features: full backup preview/restore, undo/redo and selected-bar editing, rudiment/fill generation, musical-bar arrangements, and device/channel/note MIDI routing with independent outputs.
- Added played-rhythm capture, quantized preview, audition and saving.
- Added two optional local AI workflows: Demucs drum separation/WAV export and ADTOF drum transcription/MIDI and whole-song reference. Model downloads are explicit and cached; ADTOF retains its non-commercial CC BY-NC-SA 4.0 license.
- Moved raw journal recordings to IndexedDB with lazy details and pagination; added incremental long-session statistics and demand-driven 3D rendering.
- Library pages now show 20 patterns with actual notation previews and first-two-bar captions for longer rhythms.

- Public GitHub repository preparation, MIT license, bilingual guides, screenshots and a GitHub Pages demo workflow.
- English for new browser profiles, with a persistent Serbian language option.
- Larger ±1/±5 tempo controls and readable hit feedback beside the tempo.
- Note-size slider, up to eight notation rows and a visible notes-only switch.
- Local MusicXML score import and a reading view for original pitched scores.
- End-of-session notation reports with actual red hits, early/late offsets and pass/bar selection.
- Bounded 2D flash surfaces to prevent a failed mask from coloring the entire kit.
- Fixes for early first hits, draft state after reload, editor locking, repeated MIDI time signatures, future hi-hat choke and stale WAV kit loading.

## Previous releases

Configurable 2D/3D kits, 94 practice patterns, practice journal, A–B focus, backing audio, programs, replay/MIDI export, device profiles, WebMCP, favorites and offline use. See Git history and [qa/README.md](qa/README.md) for earlier verification records.
