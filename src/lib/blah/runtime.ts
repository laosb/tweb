import runtimeURL from '/assets/blah/diem.js?url';
import wasmURL from '/assets/blah/diem.wasm?url';
import type {DiemClient, CryptoBackend} from '@blahdiem/diem';

let ready: Promise<DiemClient>;
export function diemClient(): Promise<DiemClient> {
  return ready ??= (async() => {
    const path = new URL(runtimeURL, globalThis.location.href).href;
    const {createDiem} = await import(/* @vite-ignore */ path);
    return createDiem(new URL(wasmURL, globalThis.location.href));
  })().catch((error) => { ready = undefined; throw error; });
}

export const verifySignature: CryptoBackend['verify'] = async(key, data, signature) => crypto.subtle.verify('Ed25519',
  await crypto.subtle.importKey('raw', new Uint8Array(key), 'Ed25519', false, ['verify']),
  new Uint8Array(signature), new Uint8Array(data));
