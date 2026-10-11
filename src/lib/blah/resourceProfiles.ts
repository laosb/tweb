import type {PeerResourceProfile, ResourceIdentity, VerifiedPeerResourceProfile} from '@lib/blah/resourceProfileTypes';
import {getBlahConfig} from '@config/blah';
import rootScope from '@lib/rootScope';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {diemClient, verifySignature} from '@lib/blah/runtime';

/** Bind signed facts to the requested resource in this slot's home namespace. */
export async function verifyResourceProfile(
  slot: number,
  kind: 'user' | 'channel' | 'stickerSet',
  id: string,
  encoding: Uint8Array
): Promise<ResourceIdentity | undefined> {
  const home = getBlahConfig(slot)?.home?.identity;
  if(!home) return;
  try {
    const profile = await (await diemClient()).verifyProfile(encoding, Math.floor(Date.now() / 1000), {verify: verifySignature});
    if(kind === 'user' ? profile.kind !== 'user' && profile.kind !== 'bot' : profile.kind !== kind) return;
    if(!profile.home || (profile.home.dc === home && profile.home.account !== id)) return;
    // Foreign home account numbers belong to another namespace. The DC maps the peer ID.
    return {identityId: profile.id, domains: profile.domains, lapsed: profile.lapsed, kind: profile.kind};
  } catch{
    // Invalid bytes, failed crypto or a runtime without verifyProfile are unknown, not absent.
    return undefined;
  }
}

const lifetime = 5 * 60_000;
type Load = (slot: number, peers: PeerId[]) => Promise<(PeerResourceProfile | undefined)[]>;

/** Tab-local cache, partitioned by the account of each lookup. */
export function createResourceProfileLookup(load: Load) {
  let account: number;
  let cache = new Map<PeerId, {until: number, value: Promise<VerifiedPeerResourceProfile>}>();
  let pending = new Map<PeerId, {resolve: (value: VerifiedPeerResourceProfile) => void, reject: (error: unknown) => void}>();

  return (slot: number, peers: PeerId[]) => {
    if(account !== slot) {
      account = slot;
      cache = new Map();
      pending = new Map();
    }
    const currentCache = cache;
    const batch = pending;
    const flush = async() => {
      if(pending === batch) pending = new Map();
      const ids = [...batch.keys()];
      for(let offset = 0; offset < ids.length; offset += 100) {
        const chunk = ids.slice(offset, offset + 100);
        try {
          const results = await load(slot, chunk);
          await Promise.all(chunk.map(async(peer, index) => {
            const result = results[index];
            let value: VerifiedPeerResourceProfile;
            if(result?.status === 'present') {
              const identity = await verifyResourceProfile(slot, peer > 0 ? 'user' : 'channel', String(Math.abs(peer)), result.profile.profile);
              if(identity) value = {status: 'present', identity};
            } else value = result;
            const entry = currentCache.get(peer);
            if(entry) entry.until = Date.now() + lifetime;
            batch.get(peer).resolve(value);
          }));
        } catch(error) {
          chunk.forEach((peer) => {
            currentCache.delete(peer);
            batch.get(peer).reject(error);
          });
        }
      }
    };
    return Promise.all(peers.map((peer) => {
      const existing = currentCache.get(peer);
      if(existing && existing.until > Date.now()) return existing.value;
      if(!batch.size) queueMicrotask(flush);
      const value = new Promise<VerifiedPeerResourceProfile>((resolve, reject) => batch.set(peer, {resolve, reject}));
      currentCache.set(peer, {until: Infinity, value});
      return value;
    }));
  };
}

// Keep transport access behind the account's manager proxy. No publisher requests.
export const getPeerResourceProfiles = createResourceProfileLookup(async(slot, peers) => {
  const managers = bindManagersToSession(rootScope.managers);
  if(getCurrentAccount() !== slot) throw new Error('Blah account changed.');
  return managers.appProfileManager.getBlahResourceProfiles(peers);
});
