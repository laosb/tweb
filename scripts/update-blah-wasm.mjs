// Import release metadata and bindings; keep the WASM binary in an ignored local cache.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, join} from 'node:path';
import {ensureBlahWasm, hash, verify, releaseURL, download} from './blah-wasm.mjs';

const destination = fileURLToPath(new URL('../public/assets/blah/', import.meta.url));
const files = ['diem.js', 'diem.wasm', 'diem.d.ts', 'bridge-js.d.ts', 'LICENSE', 'THIRD_PARTY_LICENSES', 'README.md'];

async function update(option, value) {
  if(!value || !['--release', '--from-dir'].includes(option)) {
    throw new Error('Use --release YYYYMMDD-sha4 or --from-dir /path/to/BlahDiem/Web/dist; no arguments prepares the pinned WASM');
  }
  const base = option === '--release' ? releaseURL(value) : undefined;
  const read = name => base ? download(base + name) : readFile(resolve(value, name));
  const manifestBytes = await read('manifest.json');
  const manifestSHA256 = hash(manifestBytes);
  const manifest = JSON.parse(manifestBytes);
  if(manifest.format !== 1 || manifest.source?.repository !== 'https://github.com/UInt8Co/BlahDiem' ||
    (base && (manifest.source.dirty || !manifest.source.commit?.startsWith(value.slice(9))))) {
    throw new Error('Invalid BlahDiem release manifest');
  }
  const contents = await Promise.all(files.map(async(name) => {
    const bytes = await read(name);
    verify(name, bytes, manifest);
    return bytes;
  }));
  await mkdir(destination, {recursive: true});
  // Verify the entire set before changing the bindings or local binary.
  for(let i = 0; i < files.length; i++) await writeFile(join(destination, files[i]), contents[i]);
  await writeFile(join(destination, 'manifest.json'), manifestBytes);
  await writeFile(join(destination, 'source.json'), JSON.stringify({release: base ? value : null, manifestSHA256, source: manifest.source}, null, 2) + '\n');
  console.log(`Imported BlahDiem bindings and prepared ${manifest.files['diem.wasm'].bytes} byte WASM from ${value}`);
}

if(process.argv.length === 2) await ensureBlahWasm(destination);
else await update(...process.argv.slice(2));
