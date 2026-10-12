import type {KeyFileSession} from '@blahdiem/diem';
import {diemClient, verifySignature} from '@lib/blah/runtime';
import bytesFromHex from '@helpers/bytes/bytesFromHex';
import {fetchProfile, profileDomain} from '@lib/blah/profile';
import {renewalDue, renewalPolicy, RenewalPolicy} from '@lib/blah/renewal';
import blah, {ensureBlahConfig, getBlahConfig} from '@config/blah';
import {bindHomeStorage} from '@lib/blah/homeStorage';
import {decode, encode, exclusively, identityIDs, SealedIdentity, stored, storeEntries} from '@lib/blah/vault';
import {diem, IdentityInfo, IdentitySecret, SigningKey} from '@lib/blah/wasm';

export type IdentityKind = 'user' | 'channel';
export type IdentityMetadata = {kind: IdentityKind, chatId?: ChatId, title?: string, namespace?: string};
export type IdentityView = Omit<IdentityInfo, 'proof'> & Partial<IdentityMetadata> & {domain: string, publisher: string, renewal: RenewalPolicy, publicationPending: boolean};
export type IdentityRequest = {
  action: 'suggestDomain' | 'list' | 'create' | 'unlock' | 'lock' | 'inspect' | 'renew' | 'backup' | 'restore' | 'paper' | 'publisher' | 'addDevice' | 'addPaperKey' | 'removeDevice' | 'renewal' | 'publication' | 'removeOtherDevices' | 'domains',
  id?: string,
  kind?: IdentityKind,
  attempt?: string,
  password?: string,
  domain?: string,
  domains?: string[],
  backup?: number[],
  publisher?: string,
  token?: string,
  device?: string,
  phrase?: string,
  renewal?: RenewalPolicy
};
export type IdentitySummary = {id: string, domain?: string} & Partial<IdentityMetadata>;
/** A new paper key's words, shown once, and the device it certifies. */
export type PaperKeyView = {phrase: string, device: string};
export type IdentityResponse = {domain?: string, ids?: string[], identities?: IdentitySummary[], identity?: IdentityView, backup?: number[], publication?: {profile: number[], pending: boolean}, paperKey?: PaperKeyView};
type Unlocked = {id: string, key: KeyFileSession, until: number, timer?: ReturnType<typeof setTimeout>, renewalTimer?: ReturnType<typeof setTimeout>};
const unlocked = new Map<number, Unlocked>();
const resources = new Map<number, Map<string, Unlocked>>();

function sessions(slot: number, id?: string) {
  if(!id) return {get: () => unlocked.get(slot), set: (value: Unlocked) => unlocked.set(slot, value), delete: () => unlocked.delete(slot)};
  let entries = resources.get(slot);
  if(!entries) resources.set(slot, entries = new Map());
  return {get: () => entries.get(id), set: (value: Unlocked) => entries.set(id, value), delete: () => entries.delete(id)};
}

export async function requireHomeStorage() {
  if(!blah?.discovery && !blah?.home) return;
  for(let slot = 1; slot <= 4; slot++) {
    await bindHomeStorage(getBlahConfig(slot)?.home, slot);
  }
}

async function signingKey(): Promise<SigningKey> {
  return (await diemClient()).generateSigningKey();
}

/** BlahDiem reports codes; a paper key's failures name what the person can check. */
async function paperFailure<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch(error) {
    const code = (error as Error).message;
    if(code === 'invalidEncoding') throw new Error('Check the paper key words.');
    if(code === 'deviceNotListed') throw new Error('This paper key is not a current device of the identity at that domain.');
    if(code === 'identityKeyRequired') throw new Error('Only a device that holds the identity key can add a paper key.');
    throw error;
  }
}

async function certifyPaperKey(secret: IdentitySecret, slot: number, kind: IdentityKind) {
  const paper = await paperFailure(async() => (await diemClient()).paperKeys.generate());
  const info = await paperFailure(() => diem('addDevice', secret, {device: paper.device}, slot, kind));
  const device = info.devices.find((entry) => entry.key.length === paper.device.length &&
    entry.key.every((byte, index) => byte === paper.device[index]));
  return {info, paperKey: {phrase: paper.phrase, device: device.id}};
}

function view(secret: IdentitySecret, info: IdentityInfo, kind: IdentityKind = 'user'): IdentityView {
  const {proof: _, ...publicInfo} = info;
  return {...publicInfo, kind, domain: secret.domain, publisher: secret.publisher || '', renewal: renewalPolicy(secret.renewal), publicationPending: !!secret.publicationPending};
}

function session(slot: number, touch = true, id?: string) {
  const value = sessions(slot, id).get();
  if(!value || value.until < Date.now()) {
    lock(slot, id);
    throw new Error('Unlock your browser identity to continue.');
  }
  if(touch) {
    value.until = Date.now() + 15 * 60_000;
    clearTimeout(value.timer);
    value.timer = setTimeout(() => lock(slot, id), 15 * 60_000);
  }
  return value;
}

function lock(slot: number, id?: string) {
  const entries = sessions(slot, id);
  clearTimeout(entries.get()?.timer);
  clearTimeout(entries.get()?.renewalTimer);
  entries.get()?.key.destroy();
  entries.delete();
}

type IdentityOperation<T> = (secret: IdentitySecret, info: IdentityInfo,
  save: (info: IdentityInfo, pending?: boolean) => Promise<void>) => Promise<T>;

export function withIdentity<T>(slot: number, action: IdentityOperation<T>, touch = true, maintain = true): Promise<T> {
  return exclusively(() => useIdentity(slot, action, touch, maintain));
}

export function withResourceIdentity<T>(slot: number, id: string, action: IdentityOperation<T>, touch = true, maintain = true): Promise<T> {
  if(!id) throw new Error('Select a chat identity.');
  return exclusively(() => useIdentity(slot, action, touch, maintain, id));
}

// Caller holds the vault lock, including the initial unlock/renewal transaction.
async function useIdentity<T>(slot: number, action: IdentityOperation<T>, touch = true, maintain = true, id?: string): Promise<T> {
  const current = session(slot, touch, id);
  const kind = id ? 'channel' : 'user';
  const backup = await stored<SealedIdentity>('identity:' + current.id);
  const secret = await current.key.open(backup);
  let info = await diem('inspect', secret, {}, slot, kind);
  if(info.id !== current.id) throw new Error('Identity file mismatch.');
  const binding = await stored<string>('slot:' + slot);
  if(!id && binding && binding !== info.namespace) throw new Error('This account slot belongs to another identity. Use another account slot.');
  const save = async(next: IdentityInfo, pending = true) => {
    secret.profile = encode(new Uint8Array(next.profile));
    secret.publicationPending = pending;
    await storeEntries([['identity:' + current.id, await current.key.seal(secret)], ['domain:' + current.id, secret.domain]]);
  };
  if(maintain && renewalPolicy(secret.renewal).autoRenew) {
    if(renewalDue(info)) {
      info = await diem('renew', secret, {}, slot, kind);
      await save(info);
    }
    if(secret.publicationPending && secret.publisher) {
      try {
        await publish(secret);
        await save(info, false);
      } catch{
        // Keep the renewed profile and pending flag. Retry while unlocked;
        // manual publishing still reports errors and the dialog offers export.
      }
    }
  }
  return action(secret, info, save);
}

function scheduleRenewal(slot: number, id?: string) {
  const current = sessions(slot, id).get();
  if(!current) return;
  clearTimeout(current.renewalTimer);
  current.renewalTimer = setTimeout(async() => {
    try {
      await exclusively(() => useIdentity(slot, async() => {}, false, true, id));
    } catch{
      // Keep pending publication durable and retry while unlocked. Foreground
      // operations surface the error and allow manual export/publication.
    } finally {
      if(sessions(slot, id).get() === current) scheduleRenewal(slot, id);
    }
  }, 60_000);
}

export {requireAccountBinding} from '@lib/blah/accountStorage';

export async function bindIdentity(slot: number) {
  return withIdentity(slot, async(secret, info) => {
    await stored('slot:' + slot, info.namespace);
    return secret.domain;
  });
}

function publicationURL(value: string) {
  const url = new URL(value);
  if(url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Use an HTTPS publication endpoint.');
  return url;
}

export async function publish(secret: IdentitySecret) {
  if(!secret.publisher) return; // Manual hosting uses the exported profile.
  const url = publicationURL(secret.publisher);
  const response = await fetch(url, {method: 'PUT', redirect: 'error', credentials: 'omit', cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
    headers: {'Content-Type': 'application/cbor', ...(secret.token ? {Authorization: 'Bearer ' + secret.token} : {})},
    body: decode(secret.profile)});
  if(!response.ok) throw new Error('Profile publication failed: HTTP ' + response.status);
}

export async function identityAction(slot: number, request: IdentityRequest): Promise<IdentityResponse> {
  if(request.action === 'lock') {
    return exclusively(async() => {
      if(!request.id || unlocked.get(slot)?.id === request.id) lock(slot);
      if(request.id) lock(slot, request.id);
      else for(const id of resources.get(slot)?.keys() || []) lock(slot, id);
      return {};
    });
  }
  await ensureBlahConfig(slot);
  if(!getBlahConfig(slot)?.home) throw new Error('This build needs a decentralized Blah bootstrap.');
  await bindHomeStorage(getBlahConfig(slot).home, slot);
  if(request.action === 'suggestDomain') {
    const binding = await stored<string>('slot:' + slot);
    if(!binding) return {};
    for(const id of await identityIDs()) {
      const metadata = await stored<IdentityMetadata>('metadata:' + id);
      if(metadata?.kind === 'user' && metadata.namespace === binding) return {domain: await stored<string>('domain:' + id)};
    }
    return {};
  }
  if(request.action === 'list') {
    const ids = await identityIDs();
    const entries = await Promise.all(ids.map(async(id) => ({id, domain: await stored<string>('domain:' + id),
      ...await stored<IdentityMetadata>('metadata:' + id)})));
    const identities = entries.filter((entry) => (entry.kind || 'user') === (request.kind || 'user'));
    return {ids: identities.map((entry) => entry.id), identities};
  }
  let kind = request.kind || (request.id && (await stored<IdentityMetadata>('metadata:' + request.id))?.kind) || 'user';
  const use = <T>(action: IdentityOperation<T>, touch = true, maintain = true) => kind === 'channel' ?
    withResourceIdentity(slot, request.id, action, touch, maintain) : withIdentity(slot, action, touch, maintain);
  if(request.action === 'publication') {
    // Fetch outside the custody lock: a slow host must not delay locking keys.
    const {domains, profile} = await use(async(_secret, info) => ({domains: info.domains, profile: info.profile}), false, false);
    return {publication: {profile, pending: await publicationPending(domains, profile)}};
  }
  if(request.action === 'create' || request.action === 'restore' || request.action === 'paper' || request.action === 'unlock') {
    // Fetch outside the custody lock: a slow host must not delay locking keys.
    const paperDomain = request.action === 'paper' ? profileDomain(request.domain) : undefined;
    const hosted = paperDomain && await fetchProfile(paperDomain);
    if(paperDomain && !hosted) throw new Error('No profile is published at this domain.');
    return exclusively(async() => {
      const files = (await diemClient()).keyFiles;
      const attemptKey = request.attempt && kind === 'channel' && `attempt:${getBlahConfig(slot).home.identity}:${request.attempt}`;
      if(request.action === 'create' && attemptKey) {
        const id = await stored<string>(attemptKey);
        if(id) request = {...request, action: 'unlock', id};
      }
      let backup: SealedIdentity;
      let secret: IdentitySecret;
      let key: KeyFileSession | undefined;
      try {
        let info: IdentityInfo;
        let paperKey: PaperKeyView;
        if(request.action === 'create') {
          const domain = profileDomain(request.domain);
          key = await files.create(request.password || '');
          secret = {domain, profile: '', renewal: renewalPolicy(request.renewal), publicationPending: true, identity: await signingKey(), device: await signingKey()};
          info = await diem('create', secret, {}, slot, kind);
          if(kind === 'channel') {
            secret.profile = encode(new Uint8Array(info.profile));
            ({info, paperKey} = await certifyPaperKey(secret, slot, kind));
          }
          secret.profile = encode(new Uint8Array(info.profile));
          backup = await key.seal(secret);
        } else if(request.action === 'paper') {
          // A paper key is a listed device: keep it as device-only custody of the hosted profile.
          const paper = await paperFailure(async() => (await diemClient()).paperKeys.restore(request.phrase || ''));
          key = await files.create(request.password || '');
          secret = {domain: paperDomain, profile: encode(hosted), renewal: renewalPolicy(request.renewal), device: paper.key};
          info = await paperFailure(() => diem('inspect', secret, {}, slot));
          if(await stored('identity:' + info.id)) {
            throw new Error('This identity already exists here. Unlock its current copy instead.');
          }
          backup = await key.seal(secret);
        } else {
          if(request.backup && request.backup.length > 262_144) throw new Error('Identity file is too large.');
          backup = request.action === 'restore' ? new Uint8Array(request.backup) : await stored('identity:' + request.id);
          ({session: key, contents: secret} = await files.unlock(backup, request.password || ''));
          const profile = await (await diemClient()).verifyProfile(decode(secret.profile), Math.floor(Date.now() / 1000), {verify: verifySignature});
          // Only channels use resource custody; BlahDiem validates account files,
          // including DC operator profiles, through the existing user path.
          kind = profile.kind === 'channel' ? 'channel' : 'user';
          info = await diem('inspect', secret, {}, slot, kind);
          if(info.id !== files.inspect(backup).id) throw new Error('Identity file mismatch.');
          // Never roll an existing vault back to an older device generation/revision.
          if(request.action === 'restore' && await stored('identity:' + info.id)) {
            throw new Error('This identity already exists here. Unlock its current copy instead.');
          }
        }
        const binding = await stored<string>('slot:' + slot);
        if(kind === 'user' && binding && binding !== info.namespace) {
          throw new Error('This account slot belongs to another identity. Use another account slot.');
        }
        if(request.attempt && secret.domain !== profileDomain(request.domain)) {
          throw new Error('This attempt already has an identity. Use its original domain: ' + secret.domain);
        }
        // Kind comes from the verified profile on import, never from the file picker.
        const metadata = await stored<IdentityMetadata>('metadata:' + info.id);
        await storeEntries([['identity:' + info.id, backup], ['domain:' + info.id, info.domains[0]],
          ['metadata:' + info.id, {...metadata, kind, namespace: info.namespace, ...(kind === 'channel' && info.account ? {chatId: Number(info.account)} : {})}],
          ...(attemptKey ? [[attemptKey, info.id] as [string, unknown]] : [])]);
        const resourceId = kind === 'channel' ? info.id : undefined;
        lock(slot, resourceId);
        sessions(slot, resourceId).set({id: info.id, key, until: Date.now() + 15 * 60_000});
        session(slot, true, resourceId);
        scheduleRenewal(slot, resourceId);
        return await useIdentity(slot, async(secret, info) => ({identity: view(secret, info, kind), paperKey}), true, true, resourceId);
      } finally {
        if(key && unlocked.get(slot)?.key !== key && ![...(resources.get(slot)?.values() || [])].some((value) => value.key === key)) key.destroy();
      }
    });
  }
  return use(async(secret, current, save) => {
    if(request.id && current.id !== request.id) throw new Error('Unlock your browser identity to continue.');
    if(request.action === 'inspect') return {identity: view(secret, current, kind)};
    if(request.action === 'backup') return {backup: Array.from(await stored<SealedIdentity>('identity:' + current.id))};
    let info = current;
    if(request.action === 'addPaperKey') {
      const certified = await certifyPaperKey(secret, slot, kind);
      info = certified.info;
      await save(info);
      // The words exist only in this response; a publication failure must not lose them.
      let published = !!secret.publisher;
      try { await publish(secret); } catch{ published = false; }
      if(published) await save(info, false);
      return {identity: view(secret, info, kind), paperKey: certified.paperKey};
    } else if(request.action === 'renewal') {
      secret.renewal = renewalPolicy(request.renewal);
      await save(info, !!secret.publicationPending);
      return {identity: view(secret, info, kind)};
    } else if(request.action === 'removeOtherDevices') {
      for(const device of current.devices.filter((entry) => !entry.current)) {
        info = await diem('removeDevice', secret, {
          device: bytesFromHex(device.id)
        }, slot, kind);
        secret.profile = encode(new Uint8Array(info.profile));
      }
    } else if(request.action === 'domains') {
      if(kind !== 'user') throw new Error('Chat identity domains cannot be changed here.');
      info = await diem('domains', secret, {domains: request.domains}, slot, kind);
      secret.domain = info.domains[0];
    } else if(request.action === 'publisher') {
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
        device: request.action === 'removeDevice' ? bytesFromHex(request.device) : decode(request.device)
      } : {}, slot, kind);
    }
    await save(info); // Durable first, so publication failures are retryable without losing keys/revisions.
    await publish(secret);
    if(secret.publisher) await save(info, false);
    return {identity: view(secret, info, kind)};
  }, true, false);
}

export async function numberIdentity(slot: number, account: string) {
  await withIdentity(slot, async(secret, info, save) => {
    if(info.account && info.account !== account) throw new Error('The DC returned a different identity account.');
    if(!info.account) await save(await diem('account', secret, {account}, slot));
    await publish(secret);
    if(secret.publisher) {
      const numbered = await diem('inspect', secret, {}, slot);
      await save(numbered, false);
    }
  });
}

/** Shared exact-byte publication check, outside the key custody transaction. */
export async function publicationPending(domains: string[], profile: number[]) {
  let pending = false;
  for(const domain of domains) {
    const hosted = await fetchProfile(domain);
    pending ||= !hosted || hosted.length !== profile.length || hosted.some((byte, index) => byte !== profile[index]);
  }
  return pending;
}
