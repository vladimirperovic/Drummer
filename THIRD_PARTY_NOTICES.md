# Third-party notices

Drummer's original code is licensed under [MIT](LICENSE). Third-party code retains its upstream terms. The adapted ADT_STR preprocessing in `js/adt-str-dsp.js` retains CC BY-SA 4.0 attribution and share-alike terms; see its notice below.

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

- ONNX Runtime Web **1.31.1**, Microsoft: the local JavaScript bundle is 77,024 bytes, under [MIT](js/vendor/ORT-LICENSE.txt). The matching 14,848,852-byte WASM runtime downloads from jsDelivr only when an AI action is requested. The WebGPU bundle `js/vendor/ort-webgpu-1.31.1.min.mjs` (122,491 bytes, same release and license) and its 28,747,738-byte `ort-wasm-simd-threaded.asyncify.wasm` download only on a browser with a WebGPU adapter while the app measures GPU against CPU. See [upstream runtime and third-party notices](https://github.com/microsoft/onnxruntime).
- **HT-Demucs FT drums specialist**, Meta Platforms and StemSplit ONNX conversion: optional 165,612,636-byte fp16-weights model. [StemSplitio](https://huggingface.co/StemSplitio/htdemucs-ft-drums-onnx) labels the conversion MIT, but the original author specifies research use for pretrained weights, including [HTDemucs v4](https://github.com/facebookresearch/demucs/issues/508). This conflict is unresolved; the code's MIT license is not a confirmed commercial weights permission. Pinned revision: `55f929d333054c69ae0e829b15e8f8826a39d6eb`. Upstream [Demucs](js/vendor/DEMUCS-LICENSE.txt) and [converter](js/vendor/DEMUCS-ONNX-LICENSE.txt) notices are retained. Research: Rouard, Massa and Défossez, *Hybrid Transformers for Music Source Separation*, ICASSP 2023.
- **ADTOF Frame_RNN**, M. Zehren, M. Alunno and P. Bientinesi, converted to ONNX by the Silly MIDI Tools project: the optional 2,171,762-byte model is **CC BY-NC-SA 4.0**, not MIT. It is for non-commercial use, requires attribution, and adaptations retain the same license. [Model source](https://huggingface.co/thebluescreen/adtof-drums-onnx), [full license](js/vendor/ADTOF-LICENSE.txt), [attribution and conversion notice](js/vendor/ADTOF-NOTICE.txt). Pinned revision: `d0e809bb1c1b6fe8a4a00c576852117a0636ab5a`. Drummer uses the unchanged model with peak picking and user-selectable class mapping.
- **SCNet and SCNet-large**, Tong et al., ICASSP 2024: optional ONNX exports by audiojs, **12,900,277** and **45,082,486 bytes**. The author explicitly confirms MIT for the released weights and ONNX redistribution in [SCNet #35](https://github.com/starrytong/SCNet/issues/35). [SCNet model](https://huggingface.co/audiojs/scnet), revision `e71bcdb42bce1d62b7fae25ba90fcbcf90f73f46`; [SCNet-large](https://huggingface.co/audiojs/scnet-large), revision `95f22d9e68f6cab78aef358f1a0de248d4edf805`. [SCNet license](js/vendor/SCNET-LICENSE.txt). Normalization and overlap-add follow [audiojs/neural](https://github.com/audiojs/neural/tree/main/packages/neural-separate), MIT, copyright Dmitry Iv; [retained license](js/vendor/AUDIOJS-NEURAL-LICENSE.txt). Drummer supplies local STFT/iSTFT and retains only the drums output. INT8 storage does not imply INT8 inference or equally small resident memory.
- **ADT_STR tau 0.8**, Pierfrancesco Melucci, Paolo Merialdo and Taketo Akama: optional encoder/decoder exports by Coming Undone, **72,913,936 bytes** combined. [ONNX publisher](https://huggingface.co/swwallowws/coming-undone-browser-models), revision `89a917875e272bb492311624d7536b5e27604a64`, explicitly distributes these adaptations as **CC BY-SA 4.0**. The [upstream project](https://github.com/pier-maker92/ADT_STR) uses CC BY-SA 4.0, but its original Hugging Face weights repository has no separate weights license declaration. This is publisher-declared licensing, not a separate weights-specific permission obtained from the original authors. The browser preprocessing is adapted from [Coming Undone](https://github.com/swwallowws/coming-undone/tree/46d9aacc81371a0dd098f5dfb3435379c4de9158), ©2026 Bengisu Ozaydin, with both its MIT notice and the upstream CC BY-SA lineage retained in [ADT-STR-NOTICE.txt](js/vendor/ADT-STR-NOTICE.txt). `js/adt-str-dsp.js` retains CC BY-SA 4.0 terms. Drummer's session/decoding adapter runs the original verified INT8 graphs on WASM and preserves predicted articulations and velocity.

Model licenses are separate from the MIT application code. Models and the WASM binary are not included in the repository, Pages artifact or service-worker precache. Downloads are optional, SHA-256 checked, and cached locally; their descriptors retain exact URLs, revisions, sizes and hashes. No hosted inference or paid API is used.

## Artwork, sounds and examples

The drum artwork and masks are generated from the project's procedural model; see [assets/kit/PROVENANCE.txt](assets/kit/PROVENANCE.txt). Built-in drum sounds are synthesized in the app. The distribution includes no commercial WAV kit or song audio. Screenshots show synthetic practice sessions and project-created examples, not a user's recording.

Development-only tools such as Playwright retain their package licenses and are not included in the Pages artifact. Product names used for device compatibility do not imply affiliation or endorsement.
