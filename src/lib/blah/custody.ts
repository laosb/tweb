import {stored, storeEntries} from '@lib/blah/vault';
import type {IdentitySecret} from '@lib/blah/wasm';

type Custody = Omit<IdentitySecret, 'identity' | 'seed'> & {
  id: string,
  wrappingKey?: CryptoKey,
  encryptedSeed?: Uint8Array,
  iv?: Uint8Array
};
export const custodyKey = (slot: number, id?: string) => id ? 'custody:chat:' + id : 'custody:slot:' + slot;

/** CryptoKey objects are structured-cloned by IndexedDB; no private device bytes exist. */
export async function sealCustody(secret: IdentitySecret, id: string): Promise<Custody> {
  if(secret.device.privateKey.extractable || secret.device.privateKey.algorithm.name !== 'ECDSA' ||
    (secret.device.privateKey.algorithm as EcKeyAlgorithm).namedCurve !== 'P-256' || !secret.device.privateKey.usages.includes('sign')) throw new Error('Invalid device custody.');
  const {seed, identity: _, ...publicAndDevice} = secret;
  const record: Custody = {...publicAndDevice, id};
  if(seed) {
    const wrappingKey = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedSeed = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv,
      additionalData: new TextEncoder().encode(id)}, wrappingKey, new Uint8Array(seed)));
    Object.assign(record, {wrappingKey, iv, encryptedSeed});
  }
  return record;
}

export async function openCustody(slot: number, id?: string): Promise<IdentitySecret> {
  const record = await stored<Custody>(custodyKey(slot, id));
  if(!record) throw new Error('BLAH_IDENTITY_REQUIRED');
  const {wrappingKey, encryptedSeed, iv, id: identityId, ...secret} = record;
  const seed = encryptedSeed ? new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: new Uint8Array(iv),
    additionalData: new TextEncoder().encode(identityId)}, wrappingKey, new Uint8Array(encryptedSeed))) : undefined;
  return {...secret, seed};
}

export async function deleteSlotCustody(slot: number) {
  await storeEntries([[custodyKey(slot), null]]);
}
