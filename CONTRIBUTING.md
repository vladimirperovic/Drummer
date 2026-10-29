# Contributing to Drummer

Use an issue for a bug or a feature proposal, or open a pull request with a focused change. Describe the user-visible behavior and how you verified it.

## Development

Drummer is buildless HTML, CSS and browser ES modules. Python 3 serves the app; Node.js 24 and Python 3.12 are used in CI. No account, server database or application secrets are required.

```sh
python -m http.server 8123 --bind 127.0.0.1
npm ci --prefix qa
npm --prefix qa test
python -m unittest discover -s qa -p test_analysis.py -v
```

For browser checks, keep the HTTP server running, run `npx --prefix qa playwright install chromium`, then `npm --prefix qa run test:browser`. Tests use isolated browser profiles and simulated MIDI. See [QA instructions](qa/README.md).

## Project structure

- `js/main.js`: transport, MIDI/keyboard input and app integration.
- `js/notation.js`, `js/workspace-view.js`: drum notation and reading layout.
- `js/studio.js`, `js/practice.js`, `js/performance-report.js`: sessions and timing reports.
- `js/score-import.js`: local MusicXML reading view.
- `js/kit*.js`: kit configuration, 2D/3D rendering and pointer input.
- `js/i18n.js`: English/Serbian UI. English is the default; a chosen language persists.
- `js/vendor/`: local third-party runtimes and their licenses.
- `qa/`: model, integration and browser tests.

Keep user-entered titles intact when translating. Validate imported files before rendering. Never put user recordings or unlicensed samples in test fixtures or screenshots. Avoid network dependencies in app runtime.

After changing cached files, update `VERSION` and any new paths in `sw.js`. Check both `/` and a project subpath such as `/Drummer/`. New browser functionality should degrade gracefully without a MIDI device or WebGL.

## Demo deployment

`node alati/build-pages.mjs` creates an allowlisted `dist/` directory. The `Deploy demo` workflow publishes it to GitHub Pages from `main`. It excludes `.git`, QA outputs, tools and local dependencies. Repository Settings → Pages must use **GitHub Actions**.

Contributions are made under the project's [MIT license](LICENSE). Retain third-party license notices when updating vendored dependencies.
