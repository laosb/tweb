import {cp, mkdir, readdir, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import keepAsset from '../keepAsset.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const publicDir = path.join(root, 'public');
const output = path.join(root, '.cloudflare/assets');

// Do not silently deploy the checked-in public/index.html when the build is missing.
if(!(await stat(path.join(dist, 'index.html'))).isFile()) {
  throw new Error('Build dist/index.html before preparing Cloudflare assets.');
}

await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});

// Match build.js's preservation rule, not its in-place public/ mutation:
// public/ contains both runtime static files and an old compiled application.
for(const entry of await readdir(publicDir, {withFileTypes: true})) {
  if(entry.isDirectory() || (entry.isFile() && keepAsset(entry.name))) {
    await cp(path.join(publicDir, entry.name), path.join(output, entry.name), {recursive: true});
  }
}

// Fresh build always wins. Maps are debugging artifacts, not runtime assets.
await cp(dist, output, {
  recursive: true,
  filter: (source) => !source.endsWith('.map')
});

// Match server.js's browser-cache policy, including worker scripts and manifests.
// Avoid cross-origin isolation/CSP rules here: media and calls use remote resources.
await writeFile(path.join(output, '_headers'), [
  '/*',
  '  Cache-Control: no-store',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  ''
].join('\n'));
console.log(`Cloudflare static assets prepared in ${output}`);
