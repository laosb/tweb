import {webcrypto} from 'node:crypto';
import {afterEach, beforeEach, vi} from 'vitest';

const state = vi.hoisted(() => ({store: new Map<string, any>(), published: undefined as Uint8Array,
  serial: 0, transaction: vi.fn(), operation: vi.fn(), publish: vi.fn()}));
vi.mock('@config/blah', () => ({default: {home: {}}, ensureBlahConfig: async() => {},
  getBlahConfig: () => ({home: {identity: 'ab'.repeat(32), generation: '1', domain: 'dc.example.org'}})}));
vi.mock('@lib/blah/homeStorage', () => ({bindHomeStorage: vi.fn(), requireHomeStorage: vi.fn(), clearAccountCaches: vi.fn()}));
vi.mock('@lib/blah/accountStorage', () => ({requireAccountBinding: vi.fn()}));
vi.mock('@lib/blah/discovery', () => ({dcDomain: (value: string) => value}));
vi.mock('@lib/blah/profile', () => ({profileDomain: (value: string) => value.trim().toLowerCase(), fetchProfile: async() => state.published}));
vi.mock('@lib/blah/vault', async(importOriginal) => ({...await importOriginal<object>(),
  exclusively: (action: () => Promise<unknown>) => navigator.locks.request('blah-identity-vault', action),
  serializeAccountStorage: (action: () => Promise<unknown>) => navigator.locks.request('blah-account-storage', action),
  assertAccountEpoch: async() => {},
  stored: async(key: string, value?: unknown) => {
    if(value !== undefined) state.store.set(key, value);
    return state.store.get(key);
  }, storeEntries: state.transaction,
  identityIDs: async() => [...state.store.keys()].filter(key => key.startsWith('custody:chat:')).map(key => key.slice(13))
}));
vi.mock('@lib/blah/wasm', () => ({diem: state.operation}));
vi.mock('@lib/blah/runtime', () => ({verifySignature: vi.fn(), diemClient: async() => ({
  seeds: {
    generate: () => ({words: Array(24).fill('abandon'), entropy: new Uint8Array(32).fill(++state.serial)}),
    restore: (phrase: string) => {
      const words = phrase.trim().split(/\s+/);
      if(words.length !== 24 || words.includes('invalid')) throw new Error('invalidEncoding');
      return new Uint8Array(32).fill(words[0] === 'ability' ? 2 : 1);
    },
    words: (seed: Uint8Array) => Array(24).fill(seed[0] === 2 ? 'ability' : 'abandon'),
    identity: async(seed: Uint8Array) => ({id: seed[0].toString(16).padStart(2, '0').repeat(32), publicKey: seed.slice(), signer: {extractable: false}})
  },
  deviceKeys: {generate: async() => {
    const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign', 'verify']);
    return {privateKey: pair.privateKey, publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))};
  }},
  verifyProfile: async(bytes: Uint8Array) => {
    const info = JSON.parse(new TextDecoder().decode(bytes));
    return {...info, home: {dc: 'ab'.repeat(32), epoch: '1', account: info.account || null}, generation: '1', revision: String(info.revision)};
  }, deviceLink: {respond: async() => new Uint8Array([99])},
  hosting: {publish: state.publish}
})}));
import {identityAction, withIdentity} from '@lib/blah/identity';
import type {IdentitySecret} from '@lib/blah/wasm';
import {decode, encode} from '@lib/blah/vault';

export {state};
export const phrase = Array(24).fill('abandon').join(' ');
export const otherPhrase = Array(24).fill('ability').join(' ');
export {identityAction, withIdentity};
export const create = (slot = 1, kind: 'user' | 'channel' = 'user') => identityAction(slot,
  {action: 'create', kind, domain: kind === 'user' ? 'alice.example.org' : 'news.example.org', phrase});
export async function deviceID(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function operate(operation: string, secret: IdentitySecret, extra: any = {}, _slot = 1, kind = 'user') {
  let info = secret.profile ? JSON.parse(new TextDecoder().decode(decode(secret.profile))) :
    {id: secret.seed[0].toString(16).padStart(2, '0').repeat(32), domains: [secret.domain], namespace: 'alice-at-home',
      account: '', notBefore: Date.now() / 1000, expiresAt: Date.now() / 1000 + 180 * 86400, devices: [], revision: 0, kind};
  const currentID = await deviceID(secret.device.publicKey);
  if(['create', 'enroll', 'addDevice'].includes(operation)) {
    const key = extra.device || secret.device.publicKey;
    info.devices.push({id: await deviceID(new Uint8Array(key)), key: Array.from(key),
      notBefore: info.notBefore, expiresAt: info.expiresAt});
  }
  if(operation === 'removeDevice') {
    const id = Array.from(extra.device as Uint8Array, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if(id === currentID) throw new Error('identityMismatch');
    info.devices = info.devices.filter((device: any) => device.id !== id);
  }
  if(operation === 'account') info.account = extra.account;
  if(operation === 'domains') info.domains = extra.domains;
  if(operation !== 'inspect') info.revision++;
  info = {...info, devices: info.devices.map((device: any) => ({...device, current: device.id === currentID}))};
  return {...info, profile: Array.from(new TextEncoder().encode(JSON.stringify(info))), proof: []};
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', {configurable: true, value: {request: (name: string, action: () => Promise<unknown>) => {
    const result = (queues.get(name) || Promise.resolve()).then(action);
    queues.set(name, result.catch(() => {}));
    return result;
  }}});
  vi.useFakeTimers();
  state.store.clear(); state.published = undefined; state.serial = 0;
  state.transaction.mockReset().mockImplementation(async(entries: [string, unknown][]) => {
    for(const [key, value] of entries) {
      if(value === null) state.store.delete(key); else state.store.set(key, structuredClone(value));
    }
  });
  state.operation.mockReset().mockImplementation(operate);
  state.publish.mockReset().mockImplementation(async(_domain: string, bytes: number[]) => {
    state.published = new Uint8Array(bytes);
    return {identity: '01'.repeat(32), revision: '1', domains: ['alice.example.org']};
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
