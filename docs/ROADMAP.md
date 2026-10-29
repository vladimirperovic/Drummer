# Completed roadmap — 2026-10-29

The five previously proposed features are implemented:

1. **Full backup restore:** preview merge/replace changes and duplicate-ID choices for patterns, sessions, programs, profiles, favorites and arrangements; optionally restore settings, drafts and MIDI routing.
2. **Undo/redo and selected-bar editing:** recover editor changes and copy/paste compatible bar ranges.
3. **Rudiment and fill generator:** preview variations from sticking, accents, orchestration and difficulty before applying.
4. **Whole-song arrangements:** sequence named sections with their own tempo, meter and bar repeat count.
5. **MIDI routing:** distinguish device/channel/note inputs, learn actual source ports, and configure independent outputs. Existing shared maps and profile imports remain supported.

The storage/performance priorities are also implemented: raw sessions use IndexedDB with paginated summaries and lazy event loading; settled 3D views request no frames; scoring maintains counts, mean and variance incrementally, and the active instrument set is cached. Storage errors retain explicit recovery/export paths.

Additional work includes played-rhythm capture, 20-pattern library pages with real notation previews, and optional local AI audio tools. Demucs extracts a drum stem; ADTOF proposes five-group drum notes for review, MIDI export and whole-song practice. Models download only after an explicit action and are not bundled. CPU/WASM separation can be slow or exceed browser memory; transcription is approximate. ADTOF is non-commercial CC BY-NC-SA 4.0, separate from the MIT app. See the [guide](../README.en.md) and [model notices](../THIRD_PARTY_NOTICES.md).

Further quality work can broaden physical MIDI hardware/browser coverage, evaluate GPU acceleration, and improve transcription detail. These are future possibilities, not current guarantees.
