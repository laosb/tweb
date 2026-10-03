import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assetFiles, ensureBlahAssets} from '../../scripts/blah-wasm.mjs';

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const release = '20260928-abcd';
const assets = Object.fromEntries(assetFiles.map((name) => [name, Buffer.from('fixture: ' + name)]));
const manifest = JSON.stringify({format: 1, source: {
  repository: 'https://github.com/UInt8Co/BlahDiem', commit: 'abcd'.repeat(10), dirty: false
}, files: Object.fromEntries(Object.entries(assets).map(([name, bytes]) => [name, {bytes: bytes.length, sha256: hash(bytes)}]))});
let directory: string;
let fetchAsset: ReturnType<typeof vi.fn<(url: string) => Promise<{ok: boolean, arrayBuffer: () => Promise<Buffer>}>>>;

async function cacheBundle() {
  for(const [name, bytes] of Object.entries({...assets, 'manifest.json': manifest})) {
    await writeFile(join(directory, name), bytes);
  }
}

beforeEach(async() => {
  directory = await mkdtemp(join(tmpdir(), 'blah-release-assets-'));
  await writeFile(join(directory, 'source.json'), JSON.stringify({release, manifestSHA256: hash(manifest)}));
  fetchAsset = vi.fn(async(url: string) => {
    const name = url.split('/').pop();
    return {ok: true, arrayBuffer: async() => name === 'manifest.json' ? Buffer.from(manifest) : assets[name]};
  });
  vi.stubGlobal('fetch', fetchAsset);
});
afterEach(async() => {
  vi.unstubAllGlobals();
  await rm(directory, {recursive: true, force: true});
});

it('restores the complete bundle from only the checked-in pin on a fresh checkout', async() => {
  await ensureBlahAssets(directory);
  for(const name of [...assetFiles, 'manifest.json']) {
    expect(fetchAsset).toHaveBeenCalledWith(
      `https://github.com/UInt8Co/BlahDiem/releases/download/${release}/${name}`, expect.any(Object));
    expect(await readFile(join(directory, name))).toEqual(name === 'manifest.json' ? Buffer.from(manifest) : assets[name]);
  }
  expect(fetchAsset).toHaveBeenCalledTimes(assetFiles.length + 1);
});

it('reuses a verified bundle without a network request', async() => {
  await cacheBundle();
  await ensureBlahAssets(directory);
  expect(fetchAsset).not.toHaveBeenCalled();
});

it('restores only missing JavaScript and declarations from a partial cache', async() => {
  await cacheBundle();
  for(const name of ['diem.js', 'bridge-js.d.ts']) await rm(join(directory, name));
  await ensureBlahAssets(directory);
  expect(fetchAsset).toHaveBeenCalledTimes(2);
  expect(await readFile(join(directory, 'diem.js'))).toEqual(assets['diem.js']);
  expect(await readFile(join(directory, 'bridge-js.d.ts'))).toEqual(assets['bridge-js.d.ts']);
});

it('verifies the entire download before publishing any assets', async() => {
  const download = fetchAsset.getMockImplementation();
  fetchAsset.mockImplementation((url: string) => url.endsWith('/diem.js') ?
    Promise.resolve({ok: true, arrayBuffer: async() => Buffer.from('corrupt')}) : download(url));
  await expect(ensureBlahAssets(directory)).rejects.toThrow('Integrity check failed: diem.js');
  expect(await readdir(directory)).toEqual(['source.json']);
});

it('rejects a changed release manifest before requesting assets', async() => {
  fetchAsset.mockResolvedValue({ok: true, arrayBuffer: async() => Buffer.from('{}')});
  await expect(ensureBlahAssets(directory)).rejects.toThrow('Pinned release manifest changed');
  expect(fetchAsset).toHaveBeenCalledTimes(1);
  expect(await readdir(directory)).toEqual(['source.json']);
});

it('repairs a damaged cache and replaces assets left over from a different pin', async() => {
  await cacheBundle();
  await writeFile(join(directory, 'manifest.json'), '{}');
  await writeFile(join(directory, 'diem.wasm'), 'stale binary');
  await ensureBlahAssets(directory);
  expect(fetchAsset).toHaveBeenCalledTimes(2);
  expect(await readFile(join(directory, 'manifest.json'), 'utf8')).toBe(manifest);
  expect(await readFile(join(directory, 'diem.wasm'))).toEqual(assets['diem.wasm']);
});

it('uses a complete unpublished bundle offline and requires explicit import when incomplete', async() => {
  await writeFile(join(directory, 'source.json'), JSON.stringify({release: null, manifestSHA256: hash(manifest)}));
  await cacheBundle();
  await ensureBlahAssets(directory);
  await rm(join(directory, 'diem.js'));
  await expect(ensureBlahAssets(directory)).rejects.toThrow('unpublished local build');
  expect(fetchAsset).not.toHaveBeenCalled();
});
