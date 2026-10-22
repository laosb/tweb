import type {HostingPlanName, KeyFileSession} from '@blahdiem/diem';
import {diemClient, verifySignature} from '@lib/blah/runtime';
import bytesFromHex from '@helpers/bytes/bytesFromHex';
import {fetchProfile, profileDomain} from '@lib/blah/profile';
import {renewalDue, renewalPolicy, RenewalPolicy} from '@lib/blah/renewal';
import blah, {ensureBlahConfig, getBlahConfig} from '@config/blah';
import {bindHomeStorage} from '@lib/blah/homeStorage';
import {dcDomain, fetchDCProfile, profileConfig, type SavedDC} from '@lib/blah/discovery';
import {decode, encode, exclusively, identityIDs, SealedIdentity, stored, storeEntries} from '@lib/blah/vault';
import {diem, IdentityInfo, IdentitySecret, SigningKey} from '@lib/blah/wasm';
import {HostedNames, hostingAPI, planHostedName, publishHosted} from '@lib/blah/hosting';

export type IdentityKind = 'user' | 'channel';
export type IdentityMetadata = {kind: IdentityKind, chatId?: ChatId, title?: string, namespace?: string, home?: string};
/** A user identity's hosting from its verified profile, and the DC of the account slot viewing it. */
export type IdentityHosting = {dc: string, domain?: string, account?: string, epoch: string, current: boolean,
  slot: {dc: string, domain: string}};
export type IdentityView = Omit<IdentityInfo, 'proof'> & Partial<IdentityMetadata> & {domain: string, publisher: string, renewal: RenewalPolicy,
  publicationPending: boolean, hosting?: IdentityHosting, hostedNames?: HostedNames, hostingAvailable?: boolean};
export type IdentityRequest = {
  action: 'suggestDomain' | 'list' | 'create' | 'unlock' | 'lock' | 'inspect' | 'renew' | 'backup' | 'restore' | 'paper' | 'publisher' | 'addDevice' | 'addPaperKey' | 'removeDevice' | 'renewal' | 'publication' | 'removeOtherDevices' | 'domains' | 'home' | 'hostingCapability' | 'hostingPlan' | 'hostingClaim' | 'hostingStatus' | 'retryPublication',
  id?: string,
  kind?: IdentityKind,
  attempt?: string,
  password?: string,
  domain?: string,
  domains?: string[],
  hosted?: {domain: string, label: string, proofs?: Record<string, number[]>},
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
/** `retired`: the slot's session belonged to the hosting a home change just ended. */
export type IdentityResponse = {domain?: string, ids?: string[], identities?: IdentitySummary[], identity?: IdentityView, backup?: number[], publication?: {profile: number[], pending: boolean}, paperKey?: PaperKeyView, retired?: boolean, hostingAvailable?: boolean, hostingPlan?: HostingPlanName, unlocked?: boolean};
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

async function profileKind(encoding: Uint8Array): Promise<IdentityKind> {
  const profile = await (await diemClient()).verifyProfile(encoding, Math.floor(Date.now() / 1000), {verify: verifySignature});
  // DC operator profiles, like user profiles, retain the account custody path.
  return profile.kind === 'channel' ? 'channel' : 'user';
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

/** Public DC domains this browser knows: account slots' DCs and home-change destinations. */
async function knownDCDomain(dc: string) {
  for(let slot = 1; slot <= 4; slot++) {
    const saved = await stored<SavedDC>('dc-profile:' + slot);
    if(saved?.version.id === dc) return saved.domain;
  }
  return stored<string>('dc-domain:' + dc);
}

async function hosting(info: IdentityInfo, slot: number): Promise<IdentityHosting> {
  const {home} = await (await diemClient()).verifyProfile(new Uint8Array(info.profile), Math.floor(Date.now() / 1000), {verify: verifySignature});
  if(!home) return;
  const current = getBlahConfig(slot).home;
  return {dc: home.dc, domain: home.dc === current.identity ? current.domain : await knownDCDomain(home.dc),
    account: home.account ?? undefined, epoch: home.epoch, current: home.dc === current.identity,
    slot: {dc: current.identity, domain: current.domain}};
}

async function view(secret: IdentitySecret, info: IdentityInfo, kind: IdentityKind, slot: number): Promise<IdentityView> {
  const {proof: _, ...publicInfo} = info;
  return {...publicInfo, kind, domain: secret.domain, publisher: secret.publisher || '', renewal: renewalPolicy(secret.renewal), publicationPending: !!secret.publicationPending,
    hostedNames: kind === 'user' ? await stored<HostedNames>('hosting:' + info.id) : undefined,
    hostingAvailable: kind === 'user' && !!secret.identity && !!(await diemClient()).hosting,
    ...(kind === 'user' ? {hosting: await hosting(info, slot)} : {})};
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
  save: (info: IdentityInfo, pending?: boolean, entries?: [string, unknown][]) => Promise<void>) => Promise<T>;

/** The slot's signer: the user identity this account slot is (or will be) bound to, hosted at its DC. */
export function withIdentity<T>(slot: number, action: IdentityOperation<T>, touch = true, maintain = true): Promise<T> {
  return exclusively(() => useIdentity(slot, action, touch, maintain, undefined, true));
}

export function withResourceIdentity<T>(slot: number, id: string, action: IdentityOperation<T>, touch = true, maintain = true): Promise<T> {
  if(!id) throw new Error('Select a chat identity.');
  return exclusively(() => useIdentity(slot, action, touch, maintain, id));
}

// Caller holds the vault lock, including the initial unlock/renewal transaction.
// Custody works on any user identity; only `signer` use is limited to the slot's own.
async function useIdentity<T>(slot: number, action: IdentityOperation<T>, touch = true, maintain = true, id?: string, signer = false): Promise<T> {
  const current = session(slot, touch, id);
  const kind = id ? 'channel' : 'user';
  const backup = await stored<SealedIdentity>('identity:' + current.id);
  const secret = await current.key.open(backup);
  let info = await diem('inspect', secret, {}, slot, kind);
  if(info.id !== current.id) throw new Error('Identity file mismatch.');
  if(signer) {
    if(!info.namespace) throw new Error('This identity is hosted on another DC. Change its home DC in identity details to sign in here.');
    const binding = await stored<string>('slot:' + slot);
    if(binding && binding !== info.namespace) throw new Error('This account slot belongs to another identity. Use another account slot.');
  }
  const save = async(next: IdentityInfo, pending = true, entries: [string, unknown][] = []) => {
    secret.profile = encode(new Uint8Array(next.profile));
    secret.publicationPending = pending;
    await storeEntries([['identity:' + current.id, await current.key.seal(secret)], ['domain:' + current.id, secret.domain], ...entries]);
  };
  if(maintain && secret.identity) {
    // Finish an unanswered hosted PUT before renewing its exact saved bytes.
    try {
      if(await retryHostedPublication(secret, info)) await save(info, false);
    } catch{
      // Keep the old bytes retryable, but allow inspection/unlock while the host is down.
      return action(secret, info, save);
    }
    if(renewalPolicy(secret.renewal).autoRenew && renewalDue(info)) {
      info = await diem('renew', secret, {}, slot, kind);
      await save(info);
    }
    if(secret.publicationPending && (secret.publisher || await stored('hosting:' + current.id))) {
      try {
        if(await publish(secret, info)) await save(info, false);
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

async function retryHostedPublication(secret: IdentitySecret, info: IdentityInfo) {
  if((await stored<HostedNames>('hosting:' + info.id))?.pending) return publish(secret, info);
  return false;
}

export async function publish(secret: IdentitySecret, info?: IdentityInfo) {
  if(info && await publishHosted(info.id, Array.from(decode(secret.profile)), info.domains)) return true;
  if(!secret.publisher) return; // Manual hosting uses the exported profile.
  const url = publicationURL(secret.publisher);
  const response = await fetch(url, {method: 'PUT', redirect: 'error', credentials: 'omit', cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
    headers: {'Content-Type': 'application/cbor', ...(secret.token ? {Authorization: 'Bearer ' + secret.token} : {})},
    body: decode(secret.profile)});
  if(!response.ok) throw new Error('Profile publication failed: HTTP ' + response.status);
  return true;
}

async function listIdentities() {
  return Promise.all((await identityIDs()).map(async(id) => ({id, domain: await stored<string>('domain:' + id),
    ...await stored<IdentityMetadata>('metadata:' + id)})));
}

/** A saved attachment is a binding even while its private key is locked. */
export async function chatIdentityForId(slot: number, chatId: ChatId) {
  const identity = (await listIdentities()).find((entry) => entry.kind === 'channel' && entry.chatId === chatId &&
    (!entry.home || entry.home === identityHome(slot)));
  if(!identity) return;
  const current = sessions(slot, identity.id).get();
  return {...identity, locked: !current || current.until <= Date.now()};
}

function identityHome(slot: number) {
  const home = getBlahConfig(slot).home;
  return `${home.identity}:${home.generation}`;
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
  if(request.action === 'hostingCapability') return {hostingAvailable: !!(await diemClient()).hosting};
  if(request.action === 'hostingStatus') {
    const current = unlocked.get(slot);
    return {unlocked: !!current && current.id === request.id && current.until > Date.now()};
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
    const entries = await listIdentities();
    const identities = entries.filter((entry) => (entry.kind || 'user') === (request.kind || 'user'));
    return {ids: identities.map((entry) => entry.id), identities};
  }
  let kind = request.kind || (request.id && (await stored<IdentityMetadata>('metadata:' + request.id))?.kind) || 'user';
  const use = <T>(action: IdentityOperation<T>, touch = true, maintain = true) => kind === 'channel' ?
    withResourceIdentity(slot, request.id, action, touch, maintain) : exclusively(() => useIdentity(slot, action, touch, maintain));
  if(request.action === 'hostingPlan') {
    if(kind !== 'user') throw {type: 'BlahHostingUnavailable'};
    if(request.id && session(slot, false).id !== request.id) throw {type: 'BlahHostingCancelled'};
    return {hostingPlan: await planHostedName(request.hosted.domain, request.hosted.label, request.id || '0'.repeat(64))};
  }
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
          if(request.hosted) {
            if(kind !== 'user') throw {type: 'BlahHostingUnavailable'};
            await hostingAPI();
            if(domain !== request.hosted.label + '.' + profileDomain(request.hosted.domain)) throw {type: 'BlahHostingInvalid'};
          }
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
          kind = await profileKind(hosted);
          const paper = await paperFailure(async() => (await diemClient()).paperKeys.restore(request.phrase || ''));
          key = await files.create(request.password || '');
          secret = {domain: paperDomain, profile: encode(hosted), renewal: renewalPolicy(request.renewal), device: paper.key};
          info = await paperFailure(() => diem('inspect', secret, {}, slot, kind));
          if(await stored('identity:' + info.id)) {
            throw new Error('This identity already exists here. Unlock its current copy instead.');
          }
          backup = await key.seal(secret);
        } else {
          if(request.backup && request.backup.length > 262_144) throw new Error('Identity file is too large.');
          backup = request.action === 'restore' ? new Uint8Array(request.backup) : await stored('identity:' + request.id);
          ({session: key, contents: secret} = await files.unlock(backup, request.password || ''));
          kind = await profileKind(decode(secret.profile));
          info = await diem('inspect', secret, {}, slot, kind);
          if(info.id !== files.inspect(backup).id) throw new Error('Identity file mismatch.');
          // Never roll an existing vault back to an older device generation/revision.
          if(request.action === 'restore' && await stored('identity:' + info.id)) {
            throw new Error('This identity already exists here. Unlock its current copy instead.');
          }
        }
        if(request.attempt && secret.domain !== profileDomain(request.domain)) {
          throw new Error('This attempt already has an identity. Use its original domain: ' + secret.domain);
        }
        // Kind comes from the verified profile on import, never from the file picker.
        const metadata = await stored<IdentityMetadata>('metadata:' + info.id);
        await storeEntries([['identity:' + info.id, backup], ['domain:' + info.id, info.domains[0]],
          ['metadata:' + info.id, {...metadata, kind, namespace: info.namespace, home: identityHome(slot), ...(kind === 'channel' && info.account ? {chatId: Number(info.account)} : {})}],
          ...(attemptKey ? [[attemptKey, info.id] as [string, unknown]] : []),
          ...(request.action === 'create' && request.hosted ? [['hosting:' + info.id, {domain: profileDomain(request.hosted.domain), held: [], proofs: {}, unclaimed: request.hosted.label}] as [string, unknown]] : [])]);
        const resourceId = kind === 'channel' ? info.id : undefined;
        lock(slot, resourceId);
        sessions(slot, resourceId).set({id: info.id, key, until: Date.now() + 15 * 60_000});
        session(slot, true, resourceId);
        scheduleRenewal(slot, resourceId);
        return await useIdentity(slot, async(secret, info) => ({identity: await view(secret, info, kind, slot), paperKey}), true, !request.hosted, resourceId);
      } finally {
        if(key && unlocked.get(slot)?.key !== key && ![...(resources.get(slot)?.values() || [])].some((value) => value.key === key)) key.destroy();
      }
    });
  }
  if(request.action === 'home') return changeHome(slot, request, kind);
  return use(async(secret, current, save) => {
    if(request.id && current.id !== request.id) throw new Error('Unlock your browser identity to continue.');
    if(request.action === 'inspect') return {identity: await view(secret, current, kind, slot)};
    if(request.action === 'backup') return {backup: Array.from(await stored<SealedIdentity>('identity:' + current.id))};
    if(!secret.identity && ['renew', 'addDevice', 'removeDevice', 'removeOtherDevices', 'domains', 'hostingClaim'].includes(request.action)) {
      throw new Error('Only a device that holds the identity key can add devices or renew the identity.');
    }
    let info = current;
    // Resolve ambiguous PUTs before signing another hosted revision.
    if(request.action !== 'retryPublication' && await retryHostedPublication(secret, info)) {
      await save(info, false);
    }
    let entries: [string, unknown][] = [];
    if(request.action === 'retryPublication') {
      if(await publish(secret, info)) await save(info, false);
      return {identity: await view(secret, info, kind, slot)};
    } else if(request.action === 'hostingClaim') {
      if(kind !== 'user') throw {type: 'BlahHostingUnavailable'};
      await hostingAPI();
      const domain = profileDomain(request.hosted.domain);
      const state = await stored<HostedNames>('hosting:' + current.id);
      if(state && state.domain !== domain) throw {type: 'BlahHostingDomainMismatch'};
      const name = profileDomain(request.hosted.label + '.' + domain);
      const abandoned = state?.unclaimed && !state.held.includes(state.unclaimed) ? state.unclaimed + '.' + domain : undefined;
      const domains = current.domains.filter((name) => name !== abandoned);
      domains.push(name);
      const unique = [...new Set(domains)];
      if(unique.join() !== current.domains.join()) info = await diem('domains', secret, {domains: unique}, slot, kind);
      secret.domain = info.domains[0];
      entries = [['hosting:' + current.id, {domain, held: (state?.held || []).filter((label) => label !== request.hosted.label || !request.hosted.proofs?.[label]), unclaimed: request.hosted.label, proofs: {...state?.proofs, ...request.hosted.proofs}}]];
    } else if(request.action === 'addPaperKey') {
      const certified = await certifyPaperKey(secret, slot, kind);
      info = certified.info;
      await save(info);
      // The words exist only in this response; a publication failure must not lose them.
      let published = false;
      try { published = !!await publish(secret, info); } catch{ published = false; }
      if(published) await save(info, false);
      return {identity: await view(secret, info, kind, slot), paperKey: certified.paperKey};
    } else if(request.action === 'renewal') {
      secret.renewal = renewalPolicy(request.renewal);
      await save(info, !!secret.publicationPending);
      return {identity: await view(secret, info, kind, slot)};
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
    await save(info, true, entries); // Signed bytes and claim proofs are durable before PUT.
    if(await publish(secret, info)) await save(info, false);
    return {identity: await view(secret, info, kind, slot)};
  }, true, false);
}

/**
 * Moves a user identity to another DC: a newer home epoch with no account, which the
 * destination allocates at signup. Whichever DC receives that profile ends the old account.
 */
async function changeHome(slot: number, request: IdentityRequest, kind: IdentityKind): Promise<IdentityResponse> {
  if(kind !== 'user') throw new Error('Only a user identity can change its home DC.');
  // Fetch and verify the destination outside the custody lock, as DC discovery does.
  const domain = dcDomain(request.domain || '');
  const {home} = (await profileConfig(domain, await fetchDCProfile(domain))).config;
  return exclusively(() => useIdentity(slot, async(secret, current, save) => {
    if(request.id && current.id !== request.id) throw new Error('Unlock your browser identity to continue.');
    await retryHostedPublication(secret, current);
    let info: IdentityInfo;
    try {
      info = await diem('home', secret, {dc: bytesFromHex(home.identity), dcDomain: domain, generation: home.generation}, slot);
    } catch(error) {
      if((error as Error).message === 'wrongHome') throw new Error('This identity is already hosted on ' + domain + '.');
      throw error;
    }
    const retired = !!current.namespace && await stored<string>('slot:' + slot) === current.namespace;
    await stored('dc-domain:' + home.identity, domain);
    await save(info); // Durable first, so a publication failure keeps the new hosting.
    const metadata = await stored<IdentityMetadata>('metadata:' + current.id);
    await stored('metadata:' + current.id, {...metadata, namespace: info.namespace});
    if(await publish(secret, info)) await save(info, false);
    return {identity: await view(secret, info, kind, slot), retired};
  }, true, false));
}

export async function numberIdentity(slot: number, account: string) {
  await withIdentity(slot, async(secret, info, save) => {
    if(info.account && info.account !== account) throw new Error('The DC returned a different identity account.');
    if(!info.account) {
      await retryHostedPublication(secret, info);
      info = await diem('account', secret, {account}, slot);
      await save(info);
    }
    if(await publish(secret, info)) {
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
