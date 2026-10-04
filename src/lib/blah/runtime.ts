import type {DiemClient, CryptoBackend} from '@blahdiem/diem';

export const diemRuntimeURL = 'https://bd-cdn.blahim.com/bd-web/20261004-9c0a/diem.js';

let ready: Promise<DiemClient>;
export function diemClient(): Promise<DiemClient> {
  return ready ??= (async() => {
    const {createDiem}: typeof import('@blahdiem/diem') = await import(/* @vite-ignore */ diemRuntimeURL);
    return createDiem();
  })().catch((error) => { ready = undefined; throw error; });
}

export const verifySignature: CryptoBackend['verify'] = async(key, data, signature) => crypto.subtle.verify('Ed25519',
  await crypto.subtle.importKey('raw', new Uint8Array(key), 'Ed25519', false, ['verify']),
  new Uint8Array(signature), new Uint8Array(data));
