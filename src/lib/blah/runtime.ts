import type {DiemClient, CryptoBackend} from '@blahdiem/diem';

// Resolved from BLAH_DIEM_CDN_HOST by Vite for both pages and workers.
declare const __BLAH_DIEM_RUNTIME_URL__: string;
export const diemRuntimeURL = __BLAH_DIEM_RUNTIME_URL__;

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
