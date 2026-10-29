# Drummer

[Project and live demo](README.md)

A browser drum practice app designed for the Roland TD-17KVX, with Web MIDI input, notation, a visual drum kit, timing/dynamics scoring, an editor and practice tools. New browser profiles open in English. Choose **SR** at the top right for Serbian; use **EN** to switch back. The language is remembered; custom pattern names and note data are preserved.

## Run

Use Chrome, Edge or Brave. Connect the drum module by USB, start the local server from this folder, and open [Drummer](http://127.0.0.1:8123/):

```powershell
python -m http.server 8123 --bind 127.0.0.1
```

On macOS use `python3`, or open `pokreni.command`. Allow MIDI access when prompted. Keep the same address, port and browser profile to access your saved data.

Without a MIDI device, use the keyboard: F/J snare; V/B/N kick; D/K closed hi-hat; S open hi-hat; A hi-hat pedal; G/H/L toms; E/U crashes; I ride; O bell; C cross-stick. Shift accents, Alt adds ghost notes, Space starts/stops, and arrow keys adjust tempo. Shift with arrows changes tempo by 5 BPM.

## Playing and editing

The notation cursor and drum diagram follow the pattern. Your hits appear on the staff, with timing and dynamics results for each instrument. The transport includes count-in, looping, reference playback, live monitoring and recording to the grid. Settings include silent bars, scoring level, latency calibration and a tempo trainer.

Load a preset or create a pattern. In **Edit pattern**, choose 1–8 bars, 2–7 beats, /4 or /8, subdivision and sticking. Click a cell to cycle normal → accent → ghost → empty. Right-click erases. Shift-click adds an accent; Alt-click adds a ghost. Save patterns to the local library or exchange pattern JSON files.

Use **Undo / Redo** (Ctrl+Z / Ctrl+Shift+Z) to recover edits. Copy an inclusive bar selection and paste it at another bar; compatible meter, subdivision and swing are required. The rudiment/fill generator offers sticking, accents, orchestration, instruments and difficulty, with a preview before applying. **Capture rhythm** at the top records MIDI, keyboard or pad clicks after count-in; review quantization, listen and save the new pattern.

**Swing** ranges from 50% (straight) to 75%; about 67% gives a 2:1 ratio. It shifts eighth-note pairs in /4 and sixteenth-note pairs in /8. Triplets retain their fixed subdivision. Beat groups such as `3+3` for 6/8 or `2+2+3` for 7/8 control metronome accents. Groups must add up to the beat count. BPM always counts quarter notes: one 7/8 bar at 120 BPM lasts 1.75 seconds.

## Practice

- **Focus:** choose an inclusive A–B bar range and scored instruments. Other hits remain audible and recorded without extra-hit penalties. Hands/Feet shortcuts speed selection. A suggestion from the latest session identifies a weaker bar/instrument and reduces the tempo by 10 BPM. Enable Loop for repetition.
- **Journal:** sessions are saved on Stop or automatic completion. Compare accuracy, timing and dynamics with earlier comparable sessions, view daily progress and inspect individual instruments. Best BPM requires a completed pass with at least 90% accuracy for the same pattern, focus and scoring level.
- **Backing track:** choose a local audio file, set its original BPM and the first bar offset, or click its waveform. Start synchronizes the track after count-in; A–B selects its corresponding section. Playback speeds are 50%, 75%, 100% and 125%, within the 30–260 BPM range. Speed also changes pitch. Select the file again after reloading.
- **Programs:** add copies of the current pattern/focus, then set exercise duration, BPM, accuracy goal and rest. Reorder, save and run the list. Each exercise creates a journal session. Count-in, the final late-hit window and rests add to the stated exercise time.
- **Arrangements:** add the current pattern as an intro, verse, chorus or fill. Give sections their own meter, tempo and repeat count; reorder, duplicate, save or exchange arrangement JSON. Playback advances after the exact section bar count and records each section in the journal.
- **Replay:** listen to recorded hits at different speeds, pause/seek, inspect passes and compare against expected notes. JSON preserves original fractional timestamps, velocity and MIDI notes. MIDI export preserves original hits at 1 ms resolution on channel 10. Replay uses the selected drum sound and does not include backing audio or continuous pedal/aftertouch data.

## MIDI import and device profiles

**Patterns → MIDI import:** select a Standard MIDI file, track, channel, start position in quarter notes, 1–8 bars, time signature and quantization. Channel 10 is selected when present. Review the note map or copy the active device map. The preview counts imported, skipped and merged hits; import into the editor, then save.

Files must be type 0/1 with PPQ timing and at most 10 MB. Type 2 and SMPTE timing are unsupported. A section with tempo changes uses its starting tempo with a warning. Shorten or move sections that cross a time-signature change. Colliding hits retain the strongest dynamic level.

**Settings → Device profiles:** save a MIDI map, calibration, velocity curve and gain under a profile name. Optionally associate it with a connected MIDI device name; **Profile for connected device** selects a matching saved profile. Save the profile after changing its map or calibration. Soft curves make loud hits easier, hard curves expand quiet-hit control, and linear leaves the response unchanged. Scoring/live sound use the curve; recordings and MIDI exports retain raw velocity.

**MIDI routing by device and channel** adds rules for a device, channel and note. **Learn device and channel** captures the actual source port and channel. Exact device+channel wins, then device-only, then channel-only, then a global rule; remaining notes use the shared base map. Output device, channel and note can be set independently for each instrument. Profile v2 export includes routing; old v1 profiles remain importable with the shared base map.

## My drum kit configurator

Open **Drum kit → My drum kit**. Start with Compact, Standard or Expanded, then choose 0–3 rack toms, 0–2 floor toms, 1–2 snares, **1–2 bass drums**, 0–3 crashes and 0–1 ride. Hi-hat and its pedal remain enabled. Left/right-handed layouts arrange the parts automatically.

Click **Move parts** beside the 2D/3D switch and drag a drum or cymbal. The whole assembly moves with its stand and pedal along the floor; height and tilt stay fixed. Both views share the positions. While editing in 3D, dragging moves parts; the view buttons still rotate/zoom. Turn **Move parts** off to orbit normally. **Esc** cancels an active drag. Releasing the mouse remembers the position locally; use **Save profile** in My drum kit to update the named profile. **Reset layout** restores automatic placement without changing part counts or handedness. Switching hands mirrors custom positions too. Removing and readding a part keeps its offset; selecting a starting kit resets custom positions.

Both views, MIDI learning and editor rows follow the configuration. The standard 2D view retains the original model rendering; custom kits use an original SVG drawing built from the shared layout. Both work offline and 2D needs no WebGL. The 3D camera frames the kit automatically. New keyboard shortcuts: **Y** third rack tom, **M** second floor tom, **R/T** second snare/cross-stick, **Z** second bass drum, **Q** third crash. The second snare/bass use the existing synthetic sound families; extra toms have distinct pitches.

Choose **Learn** beside a part, then hit its pad to update the shared base map. Two bass drums have independent targets, colors, editor lanes and scoring. For devices or channels that send the same note, use the specific routing rules in Settings. Learning an existing note in the base map moves its shared assignment.

The current kit is remembered locally. **Save profile** stores parts, handedness, custom positions, MIDI mapping, calibration and velocity response. Old profiles load the standard layout. **New profile** starts a separate saved record. Export/import transfers a JSON profile; importing creates a new record without overwriting existing ones. The same profiles remain available in Settings.

Pattern notes for a disabled part are retained and shown in the editor. Start explains that the part must be enabled or the pattern edited; notes are never silently dropped or remapped. Kit/profile changes are blocked during practice, programs, replay and calibration. Automated MIDI tests use simulated inputs; a physical Roland has not yet been tested.

## Patterns, layout and the 3D kit

Click **☆** beside any built-in or saved pattern to add it to **Favorites**; click **★** to remove it. The **Favorites** button filters both lists and shows the total number of favorites. Favorites and the filter preference persist locally and work offline. Category/search further filter presets. Each list shows **20 patterns per page**, with **Previous / Next**, a page indicator and result range. Cards preview actual notation; longer rhythms label the first two bars. Changing filters resets to page one; short lists hide pagination.

The library contains **94 patterns**: 14 basics and 20 new arrangements each for **Latin**, **Rock**, **Jazz** and **3/8**. Filter by category or search either language. Cards show meter and difficulty; the selected pattern includes a practice tip. These are original exercises and drum-set adaptations, not song transcriptions. Musical references: [jazz](https://www.drumeo.com/beat/?p=6953) and [bossa nova](https://www.drumeo.com/beat/the-bossa-nova/).

The score fills the width. Below it, one menu opens seven sections — Drum kit, Patterns, Edit, Practice, Song, Results and Settings — and becomes a bottom bar on phones. Song groups the AI analysis, the arrangement and the backing track as three steps; Results groups the current score, the journal and replay. Drag the handle below the score to resize it, or focus the handle and use arrow keys. Select **Notation rows → 2 / 4 / 8** to distribute bars across rows (limited by the number of bars). **Notes only** expands notation while retaining transport controls; **Esc** returns to the editor. Playback automatically scrolls to the active row. View preferences are remembered.

Choose **Drum kit → 3D** for a detailed black-and-white line drawing with hidden rear edges. Drag to rotate, use the wheel or pinch to zoom, or use the rotation/zoom buttons and **Reset view**. With the canvas focused, left/right rotates, up/down or +/− zooms, and Home resets. White shells retain black drumhead centers that change color on hits; cymbals flash across their full surface. Playback, MIDI and keyboard hits use the same colors in 2D and 3D, without shrinking circles.

The original procedural model includes rims, tension rods, mounting hardware, cymbal bells, adjustable tripods and matching pedals. It needs no external model file. **Three.js 0.186.1** and OrbitControls are vendored locally under their [MIT license](js/vendor/THREE-LICENSE.txt) and included in the offline cache. Rendering occurs when flashes, camera movement, layout or pedal position change; a settled kit draws no frames. Unavailable WebGL or a lost graphics context falls back to 2D.

**The 2D drawing is rendered directly from our procedural 3D model**, using a fixed orthographic view; the previous illustration has been replaced. Black head centers and complete cymbal surfaces change color without shrinking. Visibility masks from the same scene keep colors behind occluding parts. The 2D view works without WebGL and offline. Regenerate the base image and masks in `assets/kit/` with `node qa/generate-kit-art.mjs` while the local server is running. See [artwork provenance](assets/kit/PROVENANCE.txt).

## MCP connector

**Settings → App and data → MCP connector** shows connection status, an enable switch and the last call. Drummer exposes **13 WebMCP tools** to the open Codex browser for live state, pattern search/loading, favorites, tempo, playback options, start/stop, A–B focus, views, language and results. For example: “Find a jazz pattern, add it to favorites and set 100 BPM.” Click inside the app before starting audio for the first time.

Keep the page open in a browser with WebMCP support. No separate MCP server, API key or Codex configuration change is required. Unsaved pattern edits cannot be discarded by the connector. There are no library-deletion or MIDI-mapping tools; results contain summaries without raw recordings. See [MCP.md](MCP.md) for the tool contract. Other browsers retain the ordinary app controls.

## Offline and printing

**Settings → App and data:** load once while the server is running and wait for the ready message. The same address then works offline with built-in sounds, patterns and local data. Use the install button or browser menu to install when supported. Reload local backing files after reopening. Custom sample kits need to have been loaded online first.

To update, start the server, check for updates, save pattern/program edits, stop practice and apply the new version. Saving failures prevent activation. Developers must change `VERSION` in `sw.js` whenever cached application files change.

**Patterns → Print / PDF:** select 1–4 bars per row, 1–8 repetitions and optional R/L sticking. The A4 preview includes title, tempo, meter, swing/groups and bar numbers, with three notation rows per page. Choose **Print / Save PDF**, then **Save as PDF**, A4, and disable browser headers.

## Sound and data

Built-in synthesized drums work immediately. Custom WAV kits live under `kits/` and are listed in `kits/index.json`. A kit has a `kit.json` with its name/license and `instruments` mapping IDs to samples:

```json
{"name":"My kit","license":"Your sample license","instruments":{"snare":[{"file":"snare.wav","lo":1,"hi":127}]}}
```

Supported IDs: `kick`, `snare`, `xstick`, `hh`, `hho`, `hhp`, `tom1`, `tom2`, `tom3`, `crash`, `crash2`, `ride`, `bell`. Samples sharing a velocity range rotate. The bundled kit list is empty; the synth is the fallback.

For an external instrument such as EZdrummer, route the MIDI output through a virtual MIDI port. On macOS, enable IAC Driver in Audio MIDI Setup and select it in both apps. Your module can also feed Drummer for scoring and an external instrument for sound.

Patterns, settings, profiles, journals, programs and arrangements are local to the browser. **Settings → App and data → Backup and restore** exports all these records, favorites and MIDI routing. Select a backup to preview additions, conflicts, replacements and removals. Choose merge or replace, decide how duplicate IDs are handled, and optionally restore settings/current drafts before applying. Backing audio and downloaded models are excluded. Raw journal events migrate to IndexedDB and load on demand; the journal is paginated. Storage failures show a persistent warning with export/retry. Live statistics use incremental counts, mean and variance.

`alati/midirec.swift` is a macOS CoreMIDI recorder; `alati/analiza.py` analyzes velocity, double triggers, crosstalk, pedal activity and timing. Compile the recorder with `swiftc -O alati/midirec.swift -o alati/midirec` on macOS.

Test commands and evidence are in [qa/README.md](qa/README.md) and [qa/IZVESTAJ.txt](qa/IZVESTAJ.txt). Automated browser tests simulate MIDI; physical TD-17 hardware, real acoustic latency and EZdrummer integration have not been tested here.

## Reading scores and reviewing your performance

The top **Import score** button reads MusicXML (`.musicxml`, `.xml`, `.mxl`) as an original score, with pitches and multiple parts preserved. Use the reading view zoom slider to fit more measures on screen. This is separate from the percussion MIDI import and does not convert a piano score into a drum exercise. See [supported score formats](docs/score-formats.md).

**Note size** scales the drum notation from 40% to 140%. **Hide drums · notes only** keeps the transport and score visible; automatic layout places each bar on its own row, with up to eight rows. Escape returns to the main workspace. The choice and scale are remembered.

After a normal Stop or completed exercise, the journal shows **Your performance in notation**. Pick a pass, bar and instrument. Expected notes are black; actual hits are red at their measured, calibration-adjusted time. Gray guides make early/late offsets visible, with ±ms labels and missed-note circles. The exact-times table retains original timestamps. A first early hit can have a negative JSON timestamp; replay preserves its lead-in, and MIDI export adds the same nonnegative lead-in offset to all hits.

## AI audio

In **Song → Song analysis**, choose a browser-supported audio file (including MP3), up to 100 MB and 10 minutes. Two separate actions are available:

1. **Isolate drums:** HT-Demucs produces a drums-only stem. Listen to drums or the original mix minus drums and export WAV.
2. **Transcribe notes:** ADTOF processes the original mix or the extracted drums. Review tempo, five group mappings and notation; export MIDI or use a whole-song reference with original/drumless accompaniment. Extraction is optional and does not always improve transcription.

ADTOF combines all toms, hi-hat articulations and cymbal types into groups. Its output is a suggestion to review, with default MIDI velocity rather than detected dynamics. The original audio remains local. AI results remain in memory until exported or applied; select the file again after reload.

The action button displays the optional download size: Demucs model **165,612,636 bytes**, ADTOF model **2,171,762 bytes**, shared ONNX WASM runtime **14,848,852 bytes**. First-use totals are about 180.5 MB or 17.0 MB respectively. SHA-256-verified assets are cached separately from the offline application and can be removed with **Delete downloaded AI models**. No model weights or WASM binary are bundled with the app. Processing runs in CPU/WASM workers, can take several minutes and substantial memory, and **Cancel** terminates the worker. Browser memory limits can prevent separation; this release does not promise WebGPU acceleration.

ADTOF's model is **CC BY-NC-SA 4.0**, for non-commercial use with attribution and share-alike conditions for adaptations. The selected Demucs distribution and ONNX Runtime are MIT. These terms are separate from the application license; see [third-party notices](THIRD_PARTY_NOTICES.md) and [privacy](PRIVACY.md).

## License and support

[MIT license](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md), [privacy](PRIVACY.md), [contributing](CONTRIBUTING.md) and [security reports](SECURITY.md).
