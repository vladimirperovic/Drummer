# Changelog

## Unreleased — saved songs and whole-song MusicXML

- Turn **Play pattern** on by default for first-time visitors; the standard kit was already the first-load kit. Saved settings keep their choice.
- Export the complete AI drum transcription as MusicXML 4.0 with percussion mappings, meter, tempo, straight/triplet quantization, simultaneous notes, ghost heads and accents; preserve raw timing separately in MIDI and project metadata.
- Add a laptop folder library with unchanged originals, drums-only and drumless WAV files, MusicXML, MIDI and exact practice references. Remember the folder handle, search songs, load without re-analysis and switch active practice using Previous/Next.
- Save new revisions without overwriting existing songs, publish the manifest last, validate paths/metadata/audio duration and retain the previous reference if loading fails. Include the library modules in offline installation.
- Verify real browser filesystem streams and IndexedDB, reload/reconnect, denied permissions, interrupted writes, corrupted audio, mobile layout, English/Serbian and MusicXML rendering. Exported MusicXML passes the official W3C 4.0 schema.

## Unreleased — model choice and mobile controls

- Fix all seven remaining audit findings: global Song Stop across modes, studio/replay/restore guards, concurrent and cancelled Song Start, /8 count-in and grid timing, MusicXML cue/tie timing, and song-run backup/restore with legacy compatibility.

- Refine mobile transport, tempo, playback toggles, score controls and bottom navigation with quieter surfaces, readable compact labels and 44-pixel touch targets. Keep desktop and saved score-height preferences.
- Add remembered separator choices: Demucs FT (default), SCNet-large and SCNet-small. Add experimental ADT_STR transcription beside default ADTOF, with 26 articulation classes and preserved MIDI velocity. Switching choices never downloads models; model-specific license notices appear before download.
- After extraction, automatically select the new drum stem as the transcription input and invalidate any previous notation candidate. The user can still explicitly choose the original mix for comparison.
- Verify pinned model assets by SHA-256, retain SCNet MIT and ADT_STR licensing notices, and clarify the unresolved original Demucs weights terms.
- Fix incomplete AI MIDI instrument mapping and CPU/GPU fallback cleanup. Include `drum-next.css` in the Pages build so offline installation can complete.
- Add real inference tests, model-choice UI coverage, and a reproducible three-separator synthetic benchmark. See [audit and comparisons](docs/AUDIT-MODELS-2026-10-30.md).
- Add explicit-file MP3/FLAC comparison with identical input excerpts, comparable WAV loudness and separate runtime results; no quality score is inferred without reference audio.

## Unreleased

- Rimshot as its own articulation: TD-17 note 40, `X` key, editor row, sound and slashed notehead. Timing treats it as the snare pad; when a pattern writes rimshots, the stroke type is scored separately. Older maps and profiles move note 40 to rimshot once.
- Settings → Trigger check: live velocity per zone, double triggers, crosstalk, hi-hat pedal range and unmapped notes, with module trigger suggestions and export in the `midirec`/`analiza.py` format.
- MusicXML drum parts convert into editable practice patterns (part, bars, grid and instrument map), alongside the reading view.
- Two modes in the header: Notes (score, patterns, editor, practice) and Song (load and analyze → play along with original, drums-only or drumless audio → report). Arrangement and pattern backing moved to Practice.
- Song play-along compares hits with the recording's actual drum-hit times, shows a live blue (early) / purple (on time) / red (late) meter and timeline, and ends with a whole-song report: per-bar offset columns, a lane view of song hits versus yours, group statistics and the five most recent runs.
- Faster local AI: `alati/server.py` (and the offline service worker) make the page cross-origin isolated so ONNX Runtime uses several threads; each model's first run measures WebGPU against CPU and remembers the faster backend, falling back to CPU if the GPU fails mid-run. Separating a 3:35 song on an M1 dropped from about 600 s to 260–290 s.
- Song mode meter redesigned in the notebook style: a thin staff-like line with millisecond ticks and a notehead marker colored blue (early), purple (on time) or red (late).
- Cleaner top area: transport and last hit on one row, practice toggles as pills with the record, score and notes-only actions beside them, and the pattern title sharing a row with the notation options so the staff gets more height.
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
