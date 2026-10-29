# Importing a song as notation

Use **Import score** at the top of Drummer to open an original MusicXML score. For example, export a Turkish March score from your notation program as MusicXML, then choose that file. Drummer preserves the original pitches and parts in a scrollable reading view. Zoom changes how much fits on screen. Close the reading view to return to drum practice.

## Formats

| Format | Support |
| --- | --- |
| `.musicxml` | Uncompressed MusicXML `score-partwise` document |
| `.xml` | Legacy extension for the same MusicXML document |
| `.mxl` | ZIP-compressed MusicXML with `META-INF/container.xml` |
| `.mid`, `.midi` | Separate **Tools → MIDI import**, for mapping a percussion section to a drum pattern |
| `.mscz`, `.mscx`, Guitar Pro formats | Export MusicXML from the source application first |
| PDF, PNG, JPG | Printed/image notation: convert using a notation/OCR application first |
| MP3, WAV and other audio | Separate **Practice → Backing track**, for accompaniment |

MusicXML is the appropriate interchange format when the actual written score matters. MIDI contains performance events but does not preserve score layout. Audio and image files do not contain structured notes that this importer can read. [MuseScore export reference](https://handbook.musescore.org/file-management/file-export).

The MusicXML specification recommends `.musicxml` for plain documents and `.mxl` for compressed documents. Compressed files identify the root score through `META-INF/container.xml`. [MusicXML 4.0 compressed-file specification](https://www.w3.org/2021/06/musicxml40/tutorial/compressed-mxl-files/).

## Scope and limits

- This is an original-score **reading view**. It does not grade pitched instruments or automatically arrange piano music for drums. Existing drum practice, MIDI mapping and scoring remain separate.
- A **drum part** (percussion clef or `unpitched` notes) can additionally become a practice pattern: choose the part, 1–8 bars and the grid, review the instrument map (score instrument name, GM `midi-unpitched` number or staff position) and open it in the editor. Repeats are not expanded, tremolos become single strokes and the selected bars must share one meter.
- Supported root: `score-partwise`. Convert `score-timewise` using a notation program first.
- Maximum input 10 MiB, expanded archive 16 MiB, 32 parts, 2,000 part-measures and 20,000 notes. Archive entry count is limited to 128.
- Standard external MusicXML PUBLIC declarations are stripped without fetching a DTD. Internal/custom DTDs, entities and external image/resources are rejected. ZIP paths, lengths, compression and CRC are checked.
- UTF-8 and UTF-16 are accepted. Encodings, notation features or layouts that the bundled renderer does not support may need re-exporting from a notation program.
- The file is read on your device. Choose it again after reload; no score is uploaded or permanently added to the drum library.
- The viewer uses the locally bundled [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay) runtime. Once the offline app is prepared, the viewer works without a CDN or remote fonts.

Only share sheet music you have permission to distribute. The app does not bundle a commercial song collection.
