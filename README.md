# Drummer

[**Try the live demo**](https://vladimirperovic.github.io/Drummer/) · [Guide](README.en.md) · [Report an issue](https://github.com/vladimirperovic/Drummer/issues)

Practice drums in your browser with readable notation, MIDI input and honest timing feedback. Drummer works with electronic drum kits such as the Roland TD-17, or with your keyboard and mouse. No account or application server is required.

![Drummer: notation, tempo controls and an interactive drum kit](assets/screenshots/drummer-desktop.png)

## What you can do

- Browse 94 practice patterns, 20 per page, with previews of their actual notes.
- Edit with undo/redo, copy selected bars, and generate rudiments or fills.
- Connect multiple MIDI kits with device/channel/note rules and independent output maps, saved in profiles.
- Adjust tempo with large ±1/±5 controls and read hit feedback beside the tempo.
- Resize the notes, choose up to eight rows, or hide the drum kit for a dedicated reading view.
- Import original MusicXML scores with **Import score**. Pitched scores keep their original notation.
- Review each practice session with expected black notes and your actual red hits, including exact early/late offsets.
- Use A–B focus, a tempo trainer, backing audio, practice programs and performance replay.
- Sequence whole-song arrangements with section lengths, tempo and meter changes.
- Capture a played rhythm with count-in, quantize it, listen and save it.
- Export and restore a full backup with a change preview and conflict choices.
- Customize a 2D/3D kit, play its pads with the mouse and arrange its parts.
- Install the offline app, print practice sheets, and export patterns or performances.

The first visit opens in English. Choose **SR** at the top right for Serbian; your choice is remembered.

## Quick start

Open the [demo](https://vladimirperovic.github.io/Drummer/) in Chrome, Edge or Brave, click **Start**, and play with the keyboard. Enable **Play pattern** to hear the reference rhythm. For an electronic kit, connect USB and grant the browser's MIDI permission.

| Control | Action |
| --- | --- |
| Space | Start / stop |
| F / J | Snare |
| V / B / N | Kick |
| D / K | Closed hi-hat |
| S / A | Open hi-hat / hi-hat pedal |
| G / H / L | Toms |
| E / U / I / O | Crashes / ride / bell |
| Shift / Alt + drum key | Accent / ghost note |
| ↑ / ↓; Shift + ↑ / ↓ | Tempo ±1 / ±5 BPM |

The full keyboard map adapts to the configured kit. **My sound** enables local monitoring; disable it when your drum module already makes sound.

## Import a song as sheet music

Use **Import score** for `.musicxml`, `.xml` or compressed `.mxl` files. For a piece such as Mozart's Turkish March, export MusicXML from a notation program and select that file. The reading view shows the original pitches, parts, clefs and measures, with a zoom slider and scrolling.

| File | Purpose in Drummer |
| --- | --- |
| `.musicxml`, `.xml`, `.mxl` | Original score reading view, including pitched music |
| `.mid`, `.midi` | Patterns → MIDI import: choose and map a percussion section into the rhythm editor |
| Pattern `.json` | Import/export editable Drummer rhythms |
| Audio, e.g. `.mp3`, `.wav` | Practice → Backing track: local audio accompaniment |

MusicXML viewing does not turn piano music into a drum exercise or assess pitched playing. PDF/images need conversion in a notation/OCR program first; native MuseScore/Guitar Pro files should be exported as MusicXML. Imported scores remain local and are selected again after reload. See [format notes](docs/score-formats.md).

![Original pitched MusicXML score in the reading view](assets/screenshots/musicxml-score.png)

## AI audio: drums and drum notes

Open **Song → Song analysis** and choose an MP3, FLAC or another browser-decodable audio file, up to 100 MB / 10 minutes. **Isolate drums** offers **Demucs FT** (default), **SCNet-large** and **SCNet-small**, with drums-only listening, a mix without drums, and WAV export. **Transcribe notes** offers **ADTOF** (default: five instrument groups) and experimental **ADT_STR** (26 articulation classes and predicted velocity). Review the tempo, instrument mapping and note suggestions, then export MIDI or apply a whole-song practice reference. Model choices are remembered in this browser; changing a dropdown does not download anything.

The action shows the selected model's remaining download. Model sizes are approximately **165.6 MB / 45.1 MB / 12.9 MB** for the three separators and **2.2 MB / 72.9 MB** for the transcribers, plus a shared runtime. SHA-256-verified files are cached and can be deleted in the AI panel. Audio is never uploaded. Processing can take several minutes and substantial memory, and can be cancelled. ADT_STR uses CPU/WASM and works best on isolated drums; ADTOF groups articulations and uses default velocity. Both need review. Compare separators using the same input: a larger model or a smaller download does not guarantee a better result.

SCNet weights have author-confirmed **MIT** terms. ADTOF is **CC BY-NC-SA 4.0, non-commercial use only**. ADT_STR's publisher declares **CC BY-SA 4.0**, but the original weights do not have a separate license declaration. Demucs weights have conflicting original research-use and converter MIT statements. These terms are separate from Drummer's MIT code license; see [model notices](THIRD_PARTY_NOTICES.md) and the [audit and comparison](docs/AUDIT-MODELS-2026-10-30.md).

After **Isolate drums**, the resulting drum stem automatically becomes the input to **Transcribe notes**. Run the second action to produce the notation candidate. You can explicitly select the original mix for comparison.

## Laptop song library and MusicXML

In Song mode, open **Songs → Choose folder** in desktop Chrome or Edge and choose a folder such as `Music/Drummer`. After separation and transcription, click **Save to library** in Analysis. Each save creates a new song folder containing the unchanged original file, `drums.wav`, `without-drums.wav`, `notes.musicxml`, `notes.mid` and `song.json` with exact hit times, tempo, meter and model choices. A failed save never replaces an earlier revision. Copy the whole library folder for backup or to move to another laptop; it is separate from the app's JSON settings backup.

Search the list and use **Practice** to load and start a song without running AI again. **Previous / Next** switches between songs in the filtered list; switching stops the current take. **Load** prepares a song without starting it. All three backing tracks remain available, with the drumless track selected initially. The browser remembers the folder, but may ask for access again after restart; use **Refresh list** or choose the folder again. The app and saved songs work offline after the app finishes offline installation.

**Export MusicXML** exports the entire transcription, including percussion instrument mappings, tempo, meter, rests, simultaneous hits, ghost-note heads and accents. It uses the selected straight/triplet grid and first downbeat, not the four-bar preview limit. Review tempo and mapping before exporting. Exact unquantized timing remains in MIDI and `song.json`; the score is a quantized AI suggestion, not a verified published transcription.

## Read your timing

After Stop, the journal opens your notation report. Black notes show the task; red notes below show when you actually played. A red note to the left is early, to the right is late. The report includes ±milliseconds, extra hits and missed notes, plus a pass/bar selector and exact original timestamps.

![Timing report comparing expected notes and actual hits](assets/screenshots/timing-report.png)

## Run locally

```sh
git clone https://github.com/vladimirperovic/Drummer.git
cd Drummer
python alati/server.py
```

Open [127.0.0.1:8123](http://127.0.0.1:8123/). On macOS/Linux use `python3` if needed; macOS also has `pokreni.command`. Opening `index.html` directly is not supported because the app uses ES modules and a service worker.

For Web MIDI, use a supported Chromium browser over HTTPS or localhost. Keyboard/mouse practice works without a MIDI device. 2D works without WebGL.

## Local data and offline use

Patterns, sessions and settings belong to the browser and origin. The public demo and localhost have separate data. **Settings → App and data → Backup and restore** exports patterns, full sessions, song performance reports, programs, profiles, favorites, arrangements and settings. Review merge/replace choices and conflicts before applying a restore. Audio files and downloaded AI models are not included. The journal stores recordings in IndexedDB and loads details on demand; storage failures still show export/retry actions.

Open Settings → App and data and wait until it is ready before going offline. AI needs its optional downloads before offline use. See [privacy](PRIVACY.md).

## Development and deployment

```sh
npm ci --prefix qa
npm --prefix qa test
python -m unittest discover -s qa -p "test_*.py" -v
```

Browser tests, implementation notes and contribution steps are in [CONTRIBUTING.md](CONTRIBUTING.md) and [qa/README.md](qa/README.md). `node alati/build-pages.mjs` prepares a static `dist/`; GitHub Actions publishes it to Pages on pushes to `main`.

Automated tests use simulated MIDI and isolated browsers. Physical drum hardware, audio-interface latency and all GPU/browser combinations have not been exhaustively tested. See [release notes](CHANGELOG.md).

See the [verification report](qa/RELEASE-2026-10-29.md) and [completed roadmap](docs/ROADMAP.md).

## License and credits

Drummer's original code and generated kit artwork are available under the [MIT license](LICENSE), copyright 2026 Vladimir Perovic. Third-party components and optional AI models retain their own licenses. See [third-party notices](THIRD_PARTY_NOTICES.md).

No commercial sample pack or copyrighted song recording is included. Roland and EZdrummer are product references; this project is not affiliated with their manufacturers.
