// Publish only the app. Source history, QA captures and local tooling stay out
// of the Pages artifact. All browser URLs remain relative to /Drummer/.
import { cp, mkdir, rm, writeFile, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist');
if (dirname(output) !== resolve(root)) throw new Error('Invalid build output');
try { if ((await lstat(output)).isSymbolicLink()) throw new Error('Build output must not be a symbolic link'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const files = ['index.html', 'style.css', 'performance-report.css', 'score-import.css',
  'editor-tools.css', 'rhythm-capture.css', 'routing-next.css', 'studio-next.css', 'ai-tools.css',
  'manifest.webmanifest', 'sw.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md',
  'js', 'icons', 'assets/kit', 'assets/screenshots', 'kits'];
for (const path of files) await cp(resolve(root, path), resolve(output, path), { recursive: true });
await writeFile(resolve(output, '.nojekyll'), '');
console.log(`Drummer Pages artifact: ${output}`);
