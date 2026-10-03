import {readFile, writeFile, rename, rm, mkdir} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {join} from 'node:path';

export const assetFiles = ['diem.js', 'diem.wasm', 'diem.d.ts', 'bridge-js.d.ts', 'LICENSE', 'THIRD_PARTY_LICENSES', 'README.md'];
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

export function parseManifest(manifestBytes, release) {
  const manifest = JSON.parse(manifestBytes);
  if(manifest.format !== 1 || manifest.source?.repository !== 'https://github.com/UInt8Co/BlahDiem' ||
    (release && (manifest.source.dirty || !manifest.source.commit?.startsWith(release.slice(9))))) {
    throw new Error('Invalid BlahDiem release manifest');
  }
  return manifest;
}

/** Call only after verifying the complete bundle. Readers never see partially written files. */
export async function writeAssets(directory, entries) {
  await mkdir(directory, {recursive: true});
  for(const [name, bytes] of entries) {
    const destination = join(directory, name);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, destination);
    } finally {
      await rm(temporary, {force: true});
    }
  }
}

async function readCached(path) {
  try { return await readFile(path); } catch(error) { if(error.code !== 'ENOENT') throw error; }
}

/** Restore missing or stale release assets using only the checked-in pin as the trust anchor. */
export async function ensureBlahAssets(directory) {
  const pin = JSON.parse(await readFile(join(directory, 'source.json'), 'utf8'));
  const base = pin.release && releaseURL(pin.release);
  const fetchAsset = name => {
    if(!base) {
      throw new Error('BlahDiem assets are missing or invalid and this pin is an unpublished local build. ' +
        'Build the pinned BlahDiem source and run node scripts/update-blah-wasm.mjs --from-dir /path/to/BlahDiem/Web/dist, ' +
        'or select a compatible published release with --release YYYYMMDD-sha4.');
    }
    return download(base + name);
  };

  let manifestBytes = await readCached(join(directory, 'manifest.json'));
  const restoreManifest = !manifestBytes || hash(manifestBytes) !== pin.manifestSHA256;
  if(restoreManifest) manifestBytes = await fetchAsset('manifest.json');
  if(hash(manifestBytes) !== pin.manifestSHA256) throw new Error('Pinned release manifest changed');
  const manifest = parseManifest(manifestBytes, pin.release);

  const entries = (await Promise.all(assetFiles.map(async(name) => {
    const cached = await readCached(join(directory, name));
    if(cached) {
      try { verify(name, cached, manifest); return; } catch{} // A different pin or damaged cache needs a verified replacement.
    }
    const bytes = await fetchAsset(name);
    verify(name, bytes, manifest);
    return [name, bytes];
  }))).filter(Boolean);
  if(restoreManifest) entries.push(['manifest.json', manifestBytes]);
  if(entries.length) {
    await writeAssets(directory, entries);
    console.log(`Prepared ${entries.length} BlahDiem assets from ${pin.release}`);
  }
}
