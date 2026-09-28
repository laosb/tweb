// Vendor one immutable BlahDiem web release (or a local BlahDiem Web/dist build).
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const destination = fileURLToPath(new URL('../public/assets/blah/', import.meta.url));
const pin = process.argv.length === 2 ? JSON.parse(await readFile(destination + 'source.json', 'utf8')) : undefined;
const [option, value] = pin ? ['--release', pin.release] : process.argv.slice(2);
if(!value || !['--release', '--from-dir'].includes(option) ||
  (option === '--release' && !/^\d{8}-[a-f0-9]{4}$/.test(value))) {
  throw new Error('Use --release YYYYMMDD-sha4 or --from-dir /path/to/BlahDiem/Web/dist; no arguments restores the pinned release');
}
const base = option === '--release' ? `https://github.com/UInt8Co/BlahDiem/releases/download/${value}/` : undefined;
async function read(name) {
  if(!base) return readFile(resolve(value, name));
  const response = await fetch(base + name);
  if(!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const manifestBytes = await read('manifest.json');
const manifestSHA256 = createHash('sha256').update(manifestBytes).digest('hex');
if(pin && manifestSHA256 !== pin.manifestSHA256) throw new Error('Pinned release manifest changed');
const manifest = JSON.parse(manifestBytes);
if(manifest.format !== 1 || manifest.source?.repository !== 'https://github.com/UInt8Co/BlahDiem' ||
  (base && (manifest.source.dirty || !manifest.source.commit?.startsWith(value.slice(9))))) {
  throw new Error('Invalid BlahDiem release manifest');
}
const files = ['diem.js', 'diem.wasm', 'diem.d.ts', 'bridge-js.d.ts', 'LICENSE', 'THIRD_PARTY_LICENSES', 'README.md'];
const contents = await Promise.all(files.map(async(name) => {
  const bytes = await read(name);
  const expected = manifest.files[name];
  if(bytes.length !== expected?.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
    throw new Error(`Integrity check failed: ${name}`);
  }
  return bytes;
}));
await mkdir(destination, {recursive: true});
// Verify the entire set before changing the vendored pair.
for(let i = 0; i < files.length; i++) await writeFile(destination + files[i], contents[i]);
await writeFile(destination + 'manifest.json', manifestBytes);
await writeFile(destination + 'source.json', JSON.stringify({release: base ? value : null, manifestSHA256, source: manifest.source}, null, 2) + '\n');
console.log(`Vendored ${manifest.files['diem.wasm'].bytes} byte WASM from ${value}`);
