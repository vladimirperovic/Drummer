# Release checks — 2026-10-29

The roadmap and local AI release was checked with Node 26, Python 3.12 and Playwright Chromium on Windows. GitHub Actions repeats the standard suite on Linux with Node 24.

- 283 JavaScript model tests and 7 Python tests passed.
- 185 standard browser scenarios passed, including corrected pagination/notation selectors and the completed English translation check. Coverage includes MIDI simulation, timing, storage recovery, editor history, capture, arrangement transitions, reports, mobile layout, MusicXML and offline reloads.
- Eight optional browser checks used the real ADTOF model and WASM worker. Four used the real Demucs model, including cancellation and verified offline-cache reuse. These tests use synthetic audio and explicitly supplied local model files; CI does not download models.
- A two-section song starts one continuous backing source. Mixed-meter arrangement tests check the exact shared audio clock and a hit 10 ms before a section boundary.
- The Pages build and service-worker asset inventory were checked. Model weights and WASM are absent from the published app package.

Model execution and synthetic separation checks establish that the browser pipeline works; they are not an accuracy benchmark for commercial songs. Physical Roland hardware and every browser/GPU combination were not tested. Current AI inference uses CPU/WASM, not WebGPU. Review generated notation before using it as the practice reference.

Run the standard checks with `npm --prefix qa test`, `npm --prefix qa run test:browser`, and `python -m unittest discover -s qa -p "test_*.py" -v`. Optional real-model instructions are in the headers of `qa/ai-transcription-browser.mjs` and `qa/drum-separator-browser.mjs`.
