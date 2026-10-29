# Five next features

These are proposals, not features already implemented in this release.

1. **Full backup restore.** Restore sessions, programs, profiles, favorites and patterns from one export, with a preview and conflict handling. This completes the existing export workflow. Medium scope.
2. **Undo/redo and selected-bar editing.** Recover accidental edits and copy/paste arbitrary bar selections. The current editor already supports copying bar 1 to the remaining bars. Small to medium scope.
3. **Rudiment and fill generator.** Generate practice variations from sticking, accents, instruments and difficulty instead of relying only on presets. Medium scope.
4. **Whole-song practice arrangements.** Sequence intro, verse, chorus and fill sections by musical bars, including tempo/meter changes. Current programs sequence timed exercises and rests. Larger scope.
5. **MIDI routing by device, channel and note.** Distinguish pads from multiple devices even when they send the same note, and configure output mappings independently. Medium scope.

## Optimization priorities

- **Journal storage:** move raw performance events to IndexedDB and paginate the journal/replay. In a fresh Chromium profile, one simulated 30-minute Basic rock session at 120 BPM serialized to about 4.13 MB; two produced about 8.25 MB and exceeded the localStorage quota. The existing warning and preservation of the prior saved session worked. This is a capacity limit, not a silent successful save.
- **Idle 3D rendering:** render when the camera, layout, pedal or flash changes. An idle visible kit generated 96 renders in two seconds, with 564 draw calls per frame in a software-rendered test. This measurement is specific to the test environment. Shared geometry/instancing may further reduce draw calls.
- **Long-session statistics:** maintain incremental counts/mean/variance rather than rebuilding them from the full result history on each statistics update. Cache the active instrument ID set when the kit configuration changes.

Prioritize full restore and storage capacity before adding more long-session data.
