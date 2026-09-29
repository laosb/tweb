import blah, {ensureBlahConfig, getBlahConfig} from '@config/blah';
import {bindHomeStorage} from '@lib/blah/homeStorage';
import {decode, encode, exclusively, identityIDs, passwordKey, seal, SealedIdentity, stored, unseal, validateBackup} from '@lib/blah/vault';
import {diem, IdentityInfo, IdentitySecret, SigningKey} from '@lib/blah/wasm';

export type IdentityView = Omit<IdentityInfo, 'proof'> & {domain: string, publisher: string};
export type IdentityRequest = {
  action: 'list' | 'create' | 'unlock' | 'lock' | 'inspect' | 'renew' | 'backup' | 'restore' | 'publisher' | 'addDevice' | 'removeDevice',
  id?: string,
  password?: string,
  domain?: string,
  backup?: string,
  publisher?: string,
  token?: string,
  device?: string
};
export type IdentityResponse = {ids?: string[], identity?: IdentityView, backup?: string};
type Unlocked = {id: string, key: CryptoKey, until: number, timer?: ReturnType<typeof setTimeout>};
const unlocked = new Map<number, Unlocked>();

export async function requireHomeStorage() {
  if(!blah?.discovery && !blah?.home) return;
  for(let slot = 1; slot <= 4; slot++) {
    await bindHomeStorage(getBlahConfig(slot)?.home, slot);
  }
}

async function signingKey(): Promise<SigningKey> {
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const secret = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  try {
    return {privateKey: encode(secret), publicKey: encode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))};
  } finally {
    secret.fill(0);
  }
}

function view(secret: IdentitySecret, info: IdentityInfo): IdentityView {
  const {proof: _, ...publicInfo} = info;
  return {...publicInfo, domain: secret.domain, publisher: secret.publisher || ''};
}

function session(slot: number) {
  const value = unlocked.get(slot);
  if(!value || value.until < Date.now()) {
    lock(slot);
    throw new Error('Unlock your browser identity to continue.');
  }
  value.until = Date.now() + 15 * 60_000;
  clearTimeout(value.timer);
  value.timer = setTimeout(() => lock(slot), 15 * 60_000);
  return value;
}

function lock(slot: number) {
  clearTimeout(unlocked.get(slot)?.timer);
  unlocked.delete(slot);
}

export async function withIdentity<T>(slot: number, action: (secret: IdentitySecret, info: IdentityInfo,
  save: (info: IdentityInfo) => Promise<void>) => Promise<T>): Promise<T> {
  return exclusively(async() => {
    const current = session(slot);
    const backup = await stored<SealedIdentity>('identity:' + current.id);
    const secret = await unseal<IdentitySecret>(backup, current.key);
    const info = await diem('inspect', secret, {}, slot);
    if(info.id !== current.id) throw new Error('Identity backup mismatch.');
    const binding = await stored<string>('slot:' + slot);
    if(binding && binding !== info.namespace) throw new Error('This account slot belongs to another identity. Use another account slot.');
    return action(secret, info, async(next) => {
      secret.profile = encode(new Uint8Array(next.profile));
      await stored('identity:' + current.id, await seal(current.id, secret, current.key, backup.salt));
    });
  });
}

export async function bindIdentity(slot: number) {
  return withIdentity(slot, async(secret, info) => {
    await stored('slot:' + slot, info.namespace);
    return secret.domain;
  });
}

export async function requireAccountBinding(slot: number, signedIn: boolean) {
  await requireHomeStorage();
  if(!blah?.discovery && !getBlahConfig(slot)?.home) return;
  if(signedIn && !await stored<string>('slot:' + slot)) {
    throw new Error('This cached authorization has no Diem identity binding. Use a fresh browser origin.');
  }
}

function publicationURL(value: string) {
  const url = new URL(value);
  if(url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Use an HTTPS publication endpoint.');
  return url;
}

export async function publish(secret: IdentitySecret) {
  if(!secret.publisher) return; // Manual hosting uses the downloadable profile.
  const url = publicationURL(secret.publisher);
  const response = await fetch(url, {method: 'PUT', redirect: 'error', credentials: 'omit', cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
    headers: {'Content-Type': 'application/cbor', ...(secret.token ? {Authorization: 'Bearer ' + secret.token} : {})},
    body: decode(secret.profile)});
  if(!response.ok) throw new Error('Profile publication failed: HTTP ' + response.status);
}

export async function identityAction(slot: number, request: IdentityRequest): Promise<IdentityResponse> {
  await ensureBlahConfig(slot);
  if(!getBlahConfig(slot)?.home) throw new Error('This build needs a decentralized Blah bootstrap.');
  await bindHomeStorage(getBlahConfig(slot).home, slot);
  if(request.action === 'list') return {ids: await identityIDs()};
  if(request.action === 'lock') { lock(slot); return {}; }
  if(request.action === 'create' || request.action === 'restore' || request.action === 'unlock') {
    return exclusively(async() => {
      let backup: SealedIdentity;
      let secret: IdentitySecret;
      let key: CryptoKey;
      let info: IdentityInfo;
      if(request.action === 'create') {
        const domain = request.domain?.trim().toLowerCase();
        if(!domain || domain.length > 253 || !domain.includes('.') || !/^[a-z0-9.-]+$/.test(domain)) {
          throw new Error('Enter the domain that will serve your public profile.');
        }
        const salt = crypto.getRandomValues(new Uint8Array(16));
        key = await passwordKey(request.password || '', salt);
        secret = {domain, profile: '', identity: await signingKey(), device: await signingKey()};
        info = await diem('create', secret, {}, slot);
        secret.profile = encode(new Uint8Array(info.profile));
        backup = await seal(info.id, secret, key, encode(salt));
      } else {
        if(request.backup && request.backup.length > 600_000) throw new Error('Backup is too large.');
        backup = request.action === 'restore' ? JSON.parse(request.backup) : await stored('identity:' + request.id);
        validateBackup(backup);
        key = await passwordKey(request.password || '', decode(backup.salt));
        secret = await unseal<IdentitySecret>(backup, key);
        info = await diem('inspect', secret, {}, slot);
        if(info.id !== backup.id) throw new Error('Identity backup mismatch.');
        // Never roll an existing vault back to an older device generation/revision.
        if(request.action === 'restore' && await stored('identity:' + backup.id)) {
          throw new Error('This identity already exists here. Unlock its current copy instead.');
        }
      }
      const binding = await stored<string>('slot:' + slot);
      if(binding && binding !== info.namespace) {
        throw new Error('This account slot belongs to another identity. Use another account slot.');
      }
      await stored('identity:' + backup.id, backup);
      lock(slot);
      unlocked.set(slot, {id: backup.id, key, until: Date.now() + 15 * 60_000});
      session(slot);
      return {identity: view(secret, info)};
    });
  }
  return withIdentity(slot, async(secret, current, save) => {
    if(request.action === 'inspect') return {identity: view(secret, current)};
    if(request.action === 'backup') return {backup: JSON.stringify(await stored('identity:' + current.id), null, 2)};
    let info = current;
    if(request.action === 'publisher') {
      if(request.publisher) publicationURL(request.publisher);
      secret.publisher = request.publisher || '';
      secret.token = request.token || '';
    } else {
      if(request.action === 'addDevice' && (!request.device || request.device.length > 500)) {
        throw new Error('Enter an encoded Ed25519 device public key.');
      }
      if(request.action === 'removeDevice' && !/^[a-f0-9]{64}$/.test(request.device || '')) {
        throw new Error('Invalid device identifier.');
      }
      info = await diem(request.action, secret, request.device ? {
        device: request.action === 'removeDevice' ? Uint8Array.from(request.device.match(/../g), (h) => parseInt(h, 16)) : decode(request.device)
      } : {}, slot);
    }
    await save(info); // Durable first, so publication failures are retryable without losing keys/revisions.
    await publish(secret);
    return {identity: view(secret, info)};
  });
}

export async function numberIdentity(slot: number, account: string) {
  await withIdentity(slot, async(secret, info, save) => {
    if(info.account && info.account !== account) throw new Error('The DC returned a different identity account.');
    if(!info.account) await save(await diem('account', secret, {account}, slot));
    await publish(secret);
  });
}
