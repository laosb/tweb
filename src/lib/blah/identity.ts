import type {DeviceLinkApproval, DeviceLinkOpened, HostingPlanName} from '@blahdiem/diem';
import {diemClient, verifySignature} from '@lib/blah/runtime';
import bytesFromHex from '@helpers/bytes/bytesFromHex';
import {fetchProfile, profileDomain} from '@lib/blah/profile';
import {renewalDue, renewalPolicy, RenewalPolicy} from '@lib/blah/renewal';
import {ensureBlahConfig, getBlahConfig} from '@config/blah';
import {bindHomeStorage} from '@lib/blah/homeStorage';
import {dcDomain, fetchDCProfile, profileConfig, type SavedDC} from '@lib/blah/discovery';
import {decode, encode, exclusively, identityIDs, stored, storeEntries} from '@lib/blah/vault';
import {diem, IdentityInfo, IdentitySecret} from '@lib/blah/wasm';
import {custodyKey, openCustody, sealCustody} from '@lib/blah/custody';
import {HostedNames, hostedDomain, hostingAPI, planHostedName, portableHosting, publishHosted} from '@lib/blah/hosting';

export type IdentityKind = 'user' | 'channel';
export type IdentityMetadata = {kind: IdentityKind, chatId?: ChatId, title?: string, namespace?: string, home?: string};
/** A user identity's hosting from its verified profile, and the DC of the account slot viewing it. */
export type IdentityHosting = {dc: string, domain?: string, account?: string, epoch: string, current: boolean,
  slot: {dc: string, domain: string}};
export type IdentityView = Omit<IdentityInfo, 'proof'> & Partial<IdentityMetadata> & {domain: string, renewal: RenewalPolicy,
  publicationPending: boolean, holder: boolean, hosting?: IdentityHosting, hostedNames?: HostedNames, hostingAvailable?: boolean};
export type IdentityRequest = {
  action: 'suggestDomain' | 'list' | 'create' | 'restore' | 'inspect' | 'renew' | 'renewal' | 'publication' |
    'domains' | 'home' | 'hostingCapability' | 'hostingPlan' | 'hostingClaim' | 'hostingStatus' | 'retryPublication' |
    'generateWords' | 'words' | 'enterWords' | 'removeWords' | 'attempt' | 'discardEnrollment',
  id?: string,
  kind?: IdentityKind,
  attempt?: string,
  domain?: string,
  domains?: string[],
  hosted?: {domain: string, label: string, proofs?: Record<string, number[]>},
  phrase?: string,
  renewal?: RenewalPolicy
};
export type IdentityActions = (request: IdentityRequest) => Promise<IdentityResponse>;
export type IdentitySummary = {id: string, domain?: string} & Partial<IdentityMetadata>;
export type IdentityResponse = {domain?: string, ids?: string[], identities?: IdentitySummary[], identity?: IdentityView,
  publication?: {profile: number[], pending: boolean}, words?: string[], retired?: boolean,
  unfinished?: boolean, managed?: boolean, hostingAvailable?: boolean, hostingPlan?: HostingPlanName, available?: boolean};
const renewalTimers = new Map<string, ReturnType<typeof setTimeout>>();

export {requireHomeStorage} from '@lib/blah/homeStorage';

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
  return {...publicInfo, kind, holder: !!secret.seed, domain: secret.domain, renewal: renewalPolicy(secret.renewal), publicationPending: !!secret.publicationPending,
    hostedNames: await stored<HostedNames>('hosting:' + info.id),
    hostingAvailable: !!secret.identity && !!(await diemClient()).hosting,
    ...(kind === 'user' ? {hosting: await hosting(info, slot)} : {})};
}

type IdentityOperation<T> = (secret: IdentitySecret, info: IdentityInfo,
  save: (info: IdentityInfo, pending?: boolean, entries?: [string, unknown][]) => Promise<void>) => Promise<T>;

/** The slot's signer: the user identity this account slot is (or will be) bound to, hosted at its DC. */
export function withIdentity<T>(slot: number, action: IdentityOperation<T>, maintain = true): Promise<T> {
  return exclusively(() => useIdentity(slot, action, maintain, undefined, true));
}

export function withResourceIdentity<T>(slot: number, id: string, action: IdentityOperation<T>, maintain = true): Promise<T> {
  if(!id) throw new Error('Select a chat identity.');
  return exclusively(() => useIdentity(slot, action, maintain, id));
}

// Caller holds the vault lock. Seeds exist in memory only for this operation.
async function useIdentity<T>(slot: number, action: IdentityOperation<T>, maintain = true, id?: string, signer = false): Promise<T> {
  const kind = id ? 'channel' : 'user';
  const secret = await openCustody(slot, id);
  try {
    let info = await diem('inspect', secret, {}, slot, kind);
    if(id && info.id !== id) throw new Error('Identity custody mismatch.');
    if(signer) {
      if(!info.namespace) throw new Error('This identity is hosted on another DC. Change its home DC in Blah Identity to sign in here.');
      const binding = await stored<string>('slot:' + slot);
      if(binding && binding !== info.namespace) throw new Error('This account slot belongs to another identity.');
    }
    const save = async(next: IdentityInfo, pending = true, entries: [string, unknown][] = []) => {
      secret.profile = encode(new Uint8Array(next.profile));
      secret.publicationPending = pending;
      secret.hosting = portableHosting(entries.find(([key]) => key === 'hosting:' + info.id)?.[1] as HostedNames ||
        await stored<HostedNames>('hosting:' + info.id), next.domains);
      await storeEntries([[custodyKey(slot, id), await sealCustody(secret, next.id)], ['domain:' + next.id, secret.domain], ...entries]);
    };
    if(maintain && secret.seed) {
      try {
        if(await retryHostedPublication(secret, info)) await save(info, false);
        if(renewalPolicy(secret.renewal).autoRenew && renewalDue(info)) {
          info = await latestPublishedProfile(slot, secret, info, kind);
          info = await diem('renew', secret, {}, slot, kind);
          await save(info);
        }
        if(secret.publicationPending && await publish(secret, info)) await save(info, false);
      } catch{
        // A failed publisher keeps signed bytes durable for the next attempt.
      }
    }
    scheduleRenewal(slot, id);
    return await action(secret, info, save);
  } finally {
    secret.seed?.fill(0);
    secret.identity = undefined;
  }
}

function scheduleRenewal(slot: number, id?: string) {
  const key = custodyKey(slot, id);
  if(renewalTimers.has(key)) return;
  renewalTimers.set(key, setTimeout(async() => {
    renewalTimers.delete(key);
    try { await exclusively(() => useIdentity(slot, async() => {}, true, id)); }
    catch{ /* Custody may have been removed by logout. */ }
  }, 60_000));
}

export async function startIdentityMaintenance(slot: number) {
  if(await stored(custodyKey(slot))) scheduleRenewal(slot);
  for(const id of await identityIDs()) {
    if((await stored<IdentityMetadata>('metadata:' + id))?.home === identityHome(slot)) scheduleRenewal(slot, id);
  }
}

export {requireAccountBinding} from '@lib/blah/accountStorage';

export async function bindIdentity(slot: number) {
  return withIdentity(slot, async(secret, info) => {
    await stored('slot:' + slot, info.namespace);
    return secret.domain;
  });
}

async function retryHostedPublication(secret: IdentitySecret, info: IdentityInfo) {
  if((await stored<HostedNames>('hosting:' + info.id))?.pending) return publish(secret, info);
  return false;
}

export async function publish(secret: IdentitySecret, info?: IdentityInfo) {
  if(info) return publishHosted(info.id, Array.from(decode(secret.profile)), info.domains);
}

async function listIdentities() {
  return Promise.all((await identityIDs()).map(async(id) => ({id, domain: await stored<string>('domain:' + id),
    ...await stored<IdentityMetadata>('metadata:' + id)})));
}

/** A saved attachment binds the chat to its local custody. */
export async function chatIdentityForId(slot: number, chatId: ChatId) {
  const identity = (await listIdentities()).find((entry) => entry.kind === 'channel' && entry.chatId === chatId &&
    (!entry.home || entry.home === identityHome(slot)));
  if(!identity) return;
  return identity;
}

function identityHome(slot: number) {
  const home = getBlahConfig(slot).home;
  return `${home.identity}:${home.generation}`;
}

export async function identityAction(slot: number, request: IdentityRequest): Promise<IdentityResponse> {
  if(request.action === 'generateWords') {
    const seed = await (await diemClient()).seeds.generate();
    try { return {words: seed.words}; } finally { seed.entropy.fill(0); }
  }
  if(request.action === 'hostingCapability') return {hostingAvailable: !!(await diemClient()).hosting};
  if(request.action === 'hostingStatus') return {available: !!await stored(custodyKey(slot, request.kind === 'channel' ? request.id : undefined))};
  await ensureBlahConfig(slot);
  if(!getBlahConfig(slot)?.home) throw new Error('This build needs a decentralized Blah bootstrap.');
  await bindHomeStorage(getBlahConfig(slot).home, slot);
  if(request.action === 'discardEnrollment') {
    return exclusively(async() => {
      const enrollment = await stored<{id: string}>('enrollment:' + slot);
      if(!enrollment || enrollment.id !== request.id) throw new Error('This sign-in is already complete.');
      await storeEntries([[custodyKey(slot), null], ['slot:' + slot, null], ['enrollment:' + slot, null]]);
      return {};
    });
  }
  if(request.action === 'attempt') {
    return exclusively(async() => {
      const id = await stored<string>(chatAttemptKey(slot, request.attempt));
      if(!id) return {};
      return useIdentity(slot, async(secret, info) => ({identity: await view(secret, info, 'channel', slot)}), false, id);
    });
  }
  if(request.action === 'inspect' && !request.id && await stored('slot:' + slot) === 'managed-account') return {managed: true};
  if(request.action === 'suggestDomain') {
    try {
      const secret = await openCustody(slot);
      secret.seed?.fill(0);
      return {domain: secret.domain};
    } catch{ return {}; }
  }
  if(request.action === 'list') {
    const identities = request.kind === 'channel' ? await listIdentities() : [];
    return {ids: identities.map((entry) => entry.id), identities};
  }
  const kind = request.kind || (request.id && (await stored<IdentityMetadata>('metadata:' + request.id))?.kind) || 'user';
  const use = <T>(action: IdentityOperation<T>, maintain = true) => kind === 'channel' ?
    withResourceIdentity(slot, request.id, action, maintain) : exclusively(() => useIdentity(slot, action, maintain));
  if(request.action === 'hostingPlan') {
    return {hostingPlan: await planHostedName(request.hosted.domain, request.hosted.label, request.id || '0'.repeat(64))};
  }
  if(request.action === 'publication') {
    // Check public hosting outside the custody transaction.
    const {domains, profile} = await use(async(_secret, info) => ({domains: info.domains, profile: info.profile}), false);
    return {publication: {profile, pending: await publicationPending(domains, profile)}};
  }
  if(request.action === 'create' || request.action === 'restore') {
    const domain = profileDomain(request.domain);
    const profile = request.action === 'restore' && await fetchProfile(domain);
    if(request.action === 'restore' && !profile) throw new Error('No profile is published at this domain.');
    const runtime = await diemClient();
    const verified = profile && await runtime.verifyProfile(profile, Math.floor(Date.now() / 1000), {verify: verifySignature});
    const hostingDomain = verified ? profileDomain(verified.domains[0]) : domain;
    let restoredHosting: HostedNames;
    const parentDomain = hostingDomain.split('.').slice(1).join('.');
    if(profile && runtime.hosting) {
      try {
        const policy = await runtime.hosting.policy(hostingDomain);
        if(policy.domain === hostingDomain && policy.apex === true) restoredHosting = {domain: hostingDomain, held: ['@'], proofs: {}};
      } catch{ /* Try the parent when apex hosting is unavailable. */ }
      if(!restoredHosting && parentDomain.includes('.')) {
        try {
          const policy = await runtime.hosting.policy(parentDomain);
          if(policy.domain === parentDomain && policy.names) restoredHosting = {domain: parentDomain, held: [hostingDomain.split('.')[0]], proofs: {}};
        } catch{ /* Own-domain profiles use manual publication. */ }
      }
    }
    return exclusively(async() => {
      const client = runtime;
      const seed = await client.seeds.restore(request.phrase || '');
      let secret: IdentitySecret;
      try {
        if(verified && (verified.kind === 'channel' ? 'channel' : 'user') !== kind) throw new Error('The profile has a different identity kind.');
        const attemptKey = request.attempt && kind === 'channel' && chatAttemptKey(slot, request.attempt);
        const previous = attemptKey && await stored<string>(attemptKey);
        if(previous) return await useIdentity(slot, async(secret, info) => {
          const derived = await client.seeds.identity(seed);
          if(derived.id !== info.id || secret.domain !== domain) throw new Error('This chat setup already has different recovery words or a domain.');
          return {identity: await view(secret, info, kind, slot)};
        }, false, previous);
        if(kind === 'user' && await stored(custodyKey(slot))) throw new Error('This account slot already has an identity.');
        const identity = await client.seeds.identity(seed);
        if(kind === 'channel' && await stored(custodyKey(slot, identity.id))) throw new Error('This chat identity is already held in this browser.');
        if(verified && verified.id !== identity.id) throw new Error('The recovery words do not match this domain.');
        if(request.hosted) {
          await hostingAPI();
          if(domain !== hostedDomain(profileDomain(request.hosted.domain), request.hosted.label)) throw {type: 'BlahHostingInvalid'};
        }
        secret = {domain, profile: profile ? encode(profile) : '', seed, identity,
          device: await client.deviceKeys.generate(), renewal: renewalPolicy(request.renewal), publicationPending: true};
        const info = await diem(profile ? 'enroll' : 'create', secret, {}, slot, kind);
        secret.profile = encode(new Uint8Array(info.profile));
        const claim: HostedNames = request.hosted ? {domain: profileDomain(request.hosted.domain), held: [], proofs: {}, unclaimed: request.hosted.label} : restoredHosting;
        secret.hosting = portableHosting(claim, info.domains);
        await storeEntries([[custodyKey(slot, kind === 'channel' ? info.id : undefined), await sealCustody(secret, info.id)],
          ['domain:' + info.id, domain], ['metadata:' + info.id, {kind, namespace: info.namespace, home: identityHome(slot),
            ...(kind === 'channel' && info.account ? {chatId: Number(info.account)} : {})}],
          ...(kind === 'user' ? [['enrollment:' + slot, {id: info.id, kind: 'words'}] as [string, unknown]] : []),
          ...(attemptKey ? [[attemptKey, info.id] as [string, unknown]] : []),
          ...(claim ? [['hosting:' + info.id, claim] as [string, unknown]] : [])]);
        scheduleRenewal(slot, kind === 'channel' ? info.id : undefined);
        return await useIdentity(slot, async(secret, info, save) => {
          if(!request.hosted && await publish(secret, info)) await save(info, false);
          return {identity: await view(secret, info, kind, slot)};
        }, false, kind === 'channel' ? info.id : undefined);
      } finally { seed.fill(0); if(secret) secret.identity = undefined; }
    });
  }
  if(request.action === 'home') return changeHome(slot, request, kind);
  return use(async(secret, current, save) => {
    if(request.id && current.id !== request.id) throw new Error('Identity custody mismatch.');
    if(request.action === 'inspect') return {identity: await view(secret, current, kind, slot),
      unfinished: kind === 'user' && !!await stored('enrollment:' + slot)};
    if(request.action === 'words') {
      if(!secret.seed) throw new Error('Enter the recovery words on this device first.');
      return {words: await (await diemClient()).seeds.words(secret.seed)};
    }
    if(request.action === 'enterWords') {
      const seed = await (await diemClient()).seeds.restore(request.phrase || '');
      try {
        const derived = await (await diemClient()).seeds.identity(seed);
        if(derived.id !== current.id) throw new Error('The recovery words do not match this identity.');
        secret.seed?.fill(0);
        secret.seed = seed;
        secret.identity = derived;
        await save(current, !!secret.publicationPending);
        return {identity: await view(secret, current, kind, slot)};
      } finally { seed.fill(0); }
    }
    if(request.action === 'removeWords') {
      secret.seed?.fill(0);
      secret.seed = undefined;
      secret.identity = undefined;
      await save(current, !!secret.publicationPending);
      return {identity: await view(secret, current, kind, slot)};
    }
    if(!secret.seed) throw new Error('Enter the recovery words on this device first.');
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
      await hostingAPI();
      const domain = profileDomain(request.hosted.domain);
      const state = await stored<HostedNames>('hosting:' + current.id);
      if(state && state.domain !== domain) throw {type: 'BlahHostingDomainMismatch'};
      const name = profileDomain(hostedDomain(domain, request.hosted.label));
      const abandoned = state?.unclaimed && !state.held.includes(state.unclaimed) ? hostedDomain(domain, state.unclaimed) : undefined;
      const domains = current.domains.filter((name) => name !== abandoned);
      domains.push(name);
      const unique = [...new Set(domains)];
      if(unique.join() !== current.domains.join()) info = await diem('domains', secret, {domains: unique}, slot, kind);
      secret.domain = info.domains[0];
      entries = [['hosting:' + current.id, {domain, held: (state?.held || []).filter((label) => label !== request.hosted.label || !request.hosted.proofs?.[label]), unclaimed: request.hosted.label, proofs: {...state?.proofs, ...request.hosted.proofs}}]];
    } else if(request.action === 'renewal') {
      secret.renewal = renewalPolicy(request.renewal);
      await save(info, !!secret.publicationPending);
      return {identity: await view(secret, info, kind, slot)};
    } else if(request.action === 'domains') {
      info = await diem('domains', secret, {domains: request.domains}, slot, kind);
      secret.domain = info.domains[0];
    } else {
      info = await latestPublishedProfile(slot, secret, info, kind);
      info = await diem(request.action, secret, {}, slot, kind);
    }
    await save(info, true, entries); // Signed bytes and claim proofs are durable before PUT.
    if(await publish(secret, info)) await save(info, false);
    return {identity: await view(secret, info, kind, slot)};
  }, false);
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
    if(request.id && current.id !== request.id) throw new Error('Identity custody mismatch.');
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
  }, false));
}

export async function numberIdentity(slot: number, account: string, id?: string) {
  const kind = id ? 'channel' : 'user';
  const operation: IdentityOperation<void> = async(secret, info, save) => {
    if(info.account && info.account !== account) throw new Error('The DC returned a different identity account.');
    if(info.account && !secret.publicationPending) return;
    if(!info.account) {
      await retryHostedPublication(secret, info);
      info = await diem('account', secret, {account}, slot, kind);
      await save(info);
    }
    let published = false;
    try { published = !!await publish(secret, info); } catch(error) {
      // A chat is already bound: return its final step with publication still pending.
      if(!id) throw error;
    }
    if(published) await save(info, false);
  };
  if(id) await withResourceIdentity(slot, id, operation, false);
  else await withIdentity(slot, operation);
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

/** Install opaque device custody before authorizing the new slot. */
export async function installLinkedIdentity(slot: number, opened: DeviceLinkOpened, alive: () => boolean) {
  return exclusively(async() => {
    const verified = await (await diemClient()).verifyProfile(opened.profile, Math.floor(Date.now() / 1000), {verify: verifySignature});
    const secret: IdentitySecret = {domain: opened.domain, profile: encode(opened.profile), device: opened.device,
      seed: opened.seed, renewal: renewalPolicy(), publicationPending: false};
    if(opened.seed && opened.metadata) {
      try {
        const metadata = JSON.parse(new TextDecoder().decode(opened.metadata));
        secret.renewal = renewalPolicy(metadata.renewal);
        secret.hosting = metadata.hosting && portableHosting(metadata.hosting, verified.domains);
      } catch{ /* Ignore metadata from other clients. */ }
    }
    const info = await diem('inspect', secret, {}, slot);
    if(!info.namespace || !info.account || !['user', 'dc'].includes(verified.kind)) throw {type: 'DEVICE_LINK_INVALID'};
    if(await stored(custodyKey(slot))) throw {type: 'BLAH_LINK_IDENTITY_EXISTS'};
    const binding = await stored<string>('slot:' + slot);
    if(binding && binding !== info.namespace) throw {type: 'DEVICE_LINK_INVALID'};
    const custody = await sealCustody(secret, info.id);
    if(!alive()) throw {type: 'BLAH_LINK_CANCELLED'};
    await storeEntries([[custodyKey(slot), custody], ['domain:' + info.id, secret.domain],
      ['metadata:' + info.id, {kind: 'user', namespace: info.namespace, home: identityHome(slot)}],
      ['slot:' + slot, info.namespace], ['enrollment:' + slot, {id: info.id, kind: 'qr'}], ...(secret.hosting ? [['hosting:' + info.id, secret.hosting] as [string, unknown]] : [])]);
    scheduleRenewal(slot);
  });
}

/** QR admission saves and publishes the certified revision before sending its grant. */
export function certifyLinkedDevice(slot: number, id: string, device: Uint8Array) {
  return withIdentity(slot, async(secret, info, save) => {
    if(info.id !== id || !secret.seed) throw {type: 'BLAH_LINK_APPROVAL_REQUIRED'};
    await retryHostedPublication(secret, info);
    info = await latestPublishedProfile(slot, secret, info);
    if(!info.devices.some((entry) => entry.key.length === device.length && entry.key.every((byte, index) => byte === device[index]))) {
      info = await diem('addDevice', secret, {device}, slot);
      await save(info);
    }
    const published = !!await publish(secret, info);
    if(published) await save(info, false);
    return {identity: await view(secret, info, 'user', slot), manualPublication: !published};
  }, false);
}

export async function linkedAccountIdentity(slot: number, id?: string) {
  return withIdentity(slot, async(secret, info) => {
    if(!secret.seed || (id && info.id !== id)) throw {type: 'BLAH_LINK_APPROVAL_REQUIRED'};
    return {id: info.id, domain: secret.domain};
  }, false);
}

export async function respondToLinkedDevice(_slot: number, input: DeviceLinkApproval) {
  return (await diemClient()).deviceLink.respond(input);
}

/** Publish removal first. Telegram reset RPCs validate the fetched signed device set. */
export async function removeSessionDevices(slot: number, devices: Uint8Array[], retired?: () => Promise<Uint8Array[]>) {
  return withIdentity(slot, async(secret, info, save) => {
    if(!secret.seed) throw new Error('Enter the recovery words on this device first.');
    await retryHostedPublication(secret, info);
    info = await latestPublishedProfile(slot, secret, info);
    if(retired) devices = await retired();
    const removed: string[] = [];
    for(const device of devices) {
      const id = Array.from(device, (byte) => byte.toString(16).padStart(2, '0')).join('');
      if(!info.devices.some((entry) => entry.id === id && !entry.current)) continue;
      removed.push(id);
      info = await diem('removeDevice', secret, {device}, slot);
      secret.profile = encode(new Uint8Array(info.profile));
    }
    if(!removed.length) return;
    if(retired) {
      const latest = new Set((await retired()).map((device) => Array.from(device, (byte) => byte.toString(16).padStart(2, '0')).join('')));
      if(removed.some((id) => !latest.has(id))) return;
    }
    await save(info);
    if(await publish(secret, info)) await save(info, false);
    else if(await publicationPending(info.domains, info.profile)) throw new Error('BLAH_PROFILE_NOT_PUBLISHED');
  }, false);
}

/** Holders reconcile other devices' signed revisions before editing their device set. */
async function latestPublishedProfile(slot: number, secret: IdentitySecret, info: IdentityInfo, kind: IdentityKind = 'user') {
  const bytes = await fetchProfile(secret.domain);
  if(!bytes) return info;
  const client = await diemClient();
  const published = await client.verifyProfile(bytes, Math.floor(Date.now() / 1000), {verify: verifySignature});
  const local = await client.verifyProfile(new Uint8Array(info.profile), Math.floor(Date.now() / 1000), {verify: verifySignature});
  if(published.id !== info.id) throw new Error('The published identity changed.');
  if(BigInt(published.generation) > BigInt(local.generation) ||
    (published.generation === local.generation && BigInt(published.revision) > BigInt(local.revision))) {
    secret.profile = encode(bytes);
    return diem('inspect', secret, {}, slot, kind);
  }
  return info;
}

export async function pruneSessionDevices(slot: number, snapshot: () => Promise<import('@lib/blah/sessions').SessionDevices>) {
  // Absence from sessions says nothing about a device still completing sign-in.
  await removeSessionDevices(slot, [], async() => (await snapshot()).retired.map((device) => new Uint8Array(device)));
}

function chatAttemptKey(slot: number, attempt: string) {
  if(!attempt) throw new Error('Select a chat setup attempt.');
  return `attempt:${getBlahConfig(slot).home.identity}:${attempt}`;
}

export function completeEnrollment(slot: number) {
  return exclusively(() => storeEntries([['enrollment:' + slot, null]]));
}

export async function hasLinkedEnrollment(slot: number) {
  return (await stored<{kind: string}>('enrollment:' + slot))?.kind === 'qr';
}
