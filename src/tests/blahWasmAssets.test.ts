import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureBlahWasm} from '../../scripts/blah-wasm.mjs';

const binary = Buffer.from('test WASM asset');
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let directory: string;

beforeEach(async() => {
  directory = await mkdtemp(join(tmpdir(), 'blah-wasm-assets-'));
  const manifest = JSON.stringify({files: {'diem.wasm': {bytes: binary.length, sha256: hash(binary)}}});
  await writeFile(join(directory, 'manifest.json'), manifest);
  await writeFile(join(directory, 'source.json'), JSON.stringify({release: '20260928-abcd', manifestSHA256: hash(manifest)}));
});
afterEach(async() => {
  vi.unstubAllGlobals();
  await rm(directory, {recursive: true, force: true});
});

it('reuses a verified binary without a network request', async() => {
  await writeFile(join(directory, 'diem.wasm'), binary);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await ensureBlahWasm(directory);
  expect(fetch).not.toHaveBeenCalled();
});

it('restores a missing binary from the exact pinned release', async() => {
  const fetch = vi.fn().mockResolvedValue({ok: true, arrayBuffer: async() => binary});
  vi.stubGlobal('fetch', fetch);
  await ensureBlahWasm(directory);
  expect(fetch).toHaveBeenCalledWith(
    'https://github.com/UInt8Co/BlahDiem/releases/download/20260928-abcd/diem.wasm', expect.any(Object));
  expect(await readFile(join(directory, 'diem.wasm'))).toEqual(binary);
});

it('rejects a corrupt download without leaving a binary behind', async() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, arrayBuffer: async() => Buffer.from('corrupt')}));
  await expect(ensureBlahWasm(directory)).rejects.toThrow('Integrity check failed');
  await expect(readFile(join(directory, 'diem.wasm'))).rejects.toMatchObject({code: 'ENOENT'});
});

it('rejects tampered cached binaries and manifests before making requests', async() => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await writeFile(join(directory, 'diem.wasm'), 'corrupt');
  await expect(ensureBlahWasm(directory)).rejects.toThrow('Integrity check failed');
  await writeFile(join(directory, 'manifest.json'), '{}');
  await expect(ensureBlahWasm(directory)).rejects.toThrow('Pinned release manifest changed');
  expect(fetch).not.toHaveBeenCalled();
});

it('requires an explicit local import when an unpublished binary is missing', async() => {
  const path = join(directory, 'source.json');
  const pin = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({...pin, release: null}));
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(ensureBlahWasm(directory)).rejects.toThrow('unpublished local build');
  expect(fetch).not.toHaveBeenCalled();
});
