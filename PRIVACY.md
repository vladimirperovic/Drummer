# Privacy

Drummer does not require an account and contains no analytics or advertising SDK. Patterns, device profiles, MIDI routing, favorites, settings, programs and arrangements are stored in your browser on the current origin. Raw practice recordings use IndexedDB; browsers without it use a limited localStorage fallback. Clearing browser data removes them. Localhost and the GitHub Pages demo have separate storage. Full backup export/restore is available in Tools.

Audio backing files and MusicXML scores are selected from your device and processed locally. They are not uploaded by Drummer. Unsaved selected files must be chosen again after reloading. MIDI device names and events are used locally after browser permission; recordings contain note numbers, velocity and timing.

The optional **Song → Songs** library writes the original audio, two separated WAV tracks, MusicXML, MIDI and song metadata into a folder you explicitly choose on your laptop. Those files survive clearing browser data and can be backed up by copying the folder. IndexedDB stores only the folder handle; browser permission controls access and may need renewing after restart. Clearing site data forgets the handle, not the saved files. Each save creates a new folder rather than overwriting a previous song. Incomplete saves without a valid manifest are excluded from the library list. The app's JSON settings backup does not include this folder.

**Tools → AI audio** also processes selected audio locally in browser workers. Explicit AI actions download the selected model from Hugging Face and its CDN, plus ONNX Runtime WASM from jsDelivr. These hosts receive ordinary download request information such as your IP address; they do not receive your audio, separated stems or transcription. There is no remote inference endpoint. The button displays the download size before starting. Verified model/runtime files are stored separately in the browser Cache API and can be removed with **Delete downloaded AI models**. Browser storage eviction can require another download. Audio and intermediate AI results stay in memory unless you export or apply them.

An exported JSON or MIDI file can contain your pattern names and performance history. An issue or pull request on the public repository is public. Check attachments before sharing them.

GitHub operates the public demo hosting and may process access logs according to the [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). The app downloads its static files and optional local sound kits from the same host; offline caching stores these files on your device.

The optional WebMCP connector exposes app controls to a compatible client on the open page. Its public result summaries exclude raw performance recordings. It can be disabled in Tools → MCP connector. See [MCP.md](MCP.md).
