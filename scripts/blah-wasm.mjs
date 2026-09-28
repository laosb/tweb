import {readFile, writeFile, rename, rm} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {join} from 'node:path';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function verify(name, bytes, manifest) {
  const expected = manifest.files[name];
  if(bytes.length !== expected?.bytes || hash(bytes) !== expected.sha256) {
    throw new Error(`Integrity check failed: ${name}`);
  }
}
export function releaseURL(release) {
  if(!/^\d{8}-[a-f0-9]{4}$/.test(release || '')) throw new Error('Invalid BlahDiem release tag');
  return `https://github.com/UInt8Co/BlahDiem/releases/download/${release}/`;
}
export async function download(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(60_000)});
  if(!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Verify the cached binary, or fetch exactly the version described by the checked-in pin. */
export async function ensureBlahWasm(directory) {
  const pin = JSON.parse(await readFile(join(directory, 'source.json'), 'utf8'));
  const manifestBytes = await readFile(join(directory, 'manifest.json'));
  if(hash(manifestBytes) !== pin.manifestSHA256) throw new Error('Pinned release manifest changed');
  const manifest = JSON.parse(manifestBytes);
  const wasm = join(directory, 'diem.wasm');
  let cached;
  try { cached = await readFile(wasm); } catch(error) { if(error.code !== 'ENOENT') throw error; }
  if(cached) {
    verify('diem.wasm', cached, manifest);
    return;
  }
  if(!pin.release) {
    throw new Error('BlahDiem WASM is missing and this pin is an unpublished local build. ' +
      'Build the pinned BlahDiem source and run node scripts/update-blah-wasm.mjs --from-dir /path/to/BlahDiem/Web/dist, ' +
      'or select a compatible published release with --release YYYYMMDD-sha4.');
  }
  const bytes = await download(releaseURL(pin.release) + 'diem.wasm');
  verify('diem.wasm', bytes, manifest);
  const temporary = `${wasm}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, wasm);
  } finally {
    await rm(temporary, {force: true});
  }
  console.log(`Prepared ${bytes.length} byte BlahDiem WASM from ${pin.release}`);
}
