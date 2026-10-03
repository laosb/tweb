// Update the release pin and prepare the ignored BlahDiem asset cache.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {assetFiles, ensureBlahAssets, hash, verify, releaseURL, download, parseManifest, writeAssets} from './blah-wasm.mjs';

const destination = fileURLToPath(new URL('../public/assets/blah/', import.meta.url));

async function update(option, value) {
  if(!value || !['--release', '--from-dir'].includes(option)) {
    throw new Error('Use --release YYYYMMDD-sha4 or --from-dir /path/to/BlahDiem/Web/dist; no arguments prepares the pinned assets');
  }
  const base = option === '--release' ? releaseURL(value) : undefined;
  const read = name => base ? download(base + name) : readFile(resolve(value, name));
  const manifestBytes = await read('manifest.json');
  const manifestSHA256 = hash(manifestBytes);
  const manifest = parseManifest(manifestBytes, base ? value : null);
  const entries = await Promise.all(assetFiles.map(async(name) => {
    const bytes = await read(name);
    verify(name, bytes, manifest);
    return [name, bytes];
  }));
  entries.push(['manifest.json', manifestBytes]);
  entries.push(['source.json', JSON.stringify({release: base ? value : null, manifestSHA256, source: manifest.source}, null, 2) + '\n']);
  await writeAssets(destination, entries);
  console.log(`Prepared BlahDiem assets and updated the release pin from ${value}`);
}

if(process.argv.length === 2) await ensureBlahAssets(destination);
else await update(...process.argv.slice(2));
