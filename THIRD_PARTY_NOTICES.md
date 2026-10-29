# Third-party notices

Drummer's original code is licensed under [MIT](LICENSE). Third-party code retains its upstream terms.

## Three.js and OrbitControls

- Version: **0.186.1**.
- Source: [Three.js](https://github.com/mrdoob/three).
- License: MIT, included at [js/vendor/THREE-LICENSE.txt](js/vendor/THREE-LICENSE.txt).
- Files: `three.core.js`, `three.module.js`, `OrbitControls.js`.

## OpenSheetMusicDisplay

- Version: **2.2.1**, distributed as an unchanged browser bundle from the official npm package.
- Source: [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay).
- License: BSD-3-Clause, included at [js/vendor/OSMD-LICENSE.txt](js/vendor/OSMD-LICENSE.txt).
- Provenance: [OSMD-PROVENANCE.txt](js/vendor/OSMD-PROVENANCE.txt).
- Its bundle includes VexFlow, JSZip, loglevel and typescript-collections. Their license texts and the JSZip dependency notices are included in [opensheetmusicdisplay.min.js.LICENSE.txt](js/vendor/opensheetmusicdisplay.min.js.LICENSE.txt). JSZip is distributed here under its MIT option; Pako retains its MIT/Zlib notices.

## ONNX Runtime Web and optional AI models

- ONNX Runtime Web **1.31.1**, Microsoft: the local JavaScript bundle is 77,024 bytes, under [MIT](js/vendor/ORT-LICENSE.txt). The matching 14,848,852-byte WASM runtime downloads from jsDelivr only when an AI action is requested. See [upstream runtime and third-party notices](https://github.com/microsoft/onnxruntime).
- **HT-Demucs FT drums specialist**, Meta Platforms and StemSplit ONNX conversion: the optional 165,612,636-byte fp16-weights model is distributed as MIT by [StemSplitio](https://huggingface.co/StemSplitio/htdemucs-ft-drums-onnx). Pinned revision: `55f929d333054c69ae0e829b15e8f8826a39d6eb`. Upstream [Demucs](js/vendor/DEMUCS-LICENSE.txt) and [converter](js/vendor/DEMUCS-ONNX-LICENSE.txt) license notices are retained. Original research: Rouard, Massa and Défossez, *Hybrid Transformers for Music Source Separation*, ICASSP 2023. Drummer performs chunked overlap-add and uses the drums output only.
- **ADTOF Frame_RNN**, M. Zehren, M. Alunno and P. Bientinesi, converted to ONNX by the Silly MIDI Tools project: the optional 2,171,762-byte model is **CC BY-NC-SA 4.0**, not MIT. It is for non-commercial use, requires attribution, and adaptations retain the same license. [Model source](https://huggingface.co/thebluescreen/adtof-drums-onnx), [full license](js/vendor/ADTOF-LICENSE.txt), [attribution and conversion notice](js/vendor/ADTOF-NOTICE.txt). Pinned revision: `d0e809bb1c1b6fe8a4a00c576852117a0636ab5a`. Drummer uses the unchanged model with peak picking and user-selectable class mapping.

Model licenses are separate from the MIT application code. Models and the WASM binary are not included in the repository, Pages artifact or service-worker precache. Downloads are optional, SHA-256 checked, and cached locally; their descriptors retain exact URLs, revisions, sizes and hashes. No hosted inference or paid API is used.

## Artwork, sounds and examples

The drum artwork and masks are generated from the project's procedural model; see [assets/kit/PROVENANCE.txt](assets/kit/PROVENANCE.txt). Built-in drum sounds are synthesized in the app. The distribution includes no commercial WAV kit or song audio. Screenshots show synthetic practice sessions and project-created examples, not a user's recording.

Development-only tools such as Playwright retain their package licenses and are not included in the Pages artifact. Product names used for device compatibility do not imply affiliation or endorsement.
