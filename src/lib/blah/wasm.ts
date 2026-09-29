import {getBlahConfig} from '@config/blah';
import {DAY, renewalPolicy, RenewalPolicy} from '@lib/blah/renewal';
import {decode} from '@lib/blah/vault';
import type {CryptoBackend, IdentityResult} from '@blahdiem/diem';

export type SigningKey = {privateKey: string, publicKey: string};
export type IdentitySecret = {
  domain: string,
  profile: string,
  identity: SigningKey,
  device: SigningKey,
  publisher?: string,
  token?: string,
  renewal?: RenewalPolicy,
  publicationPending?: boolean
};
export type IdentityInfo = IdentityResult;

let queue: Promise<unknown> = Promise.resolve();

/** Serialize use of the Swift bridge; never let one account borrow another's signer. */
export function diem(operation: string, secret: IdentitySecret, extra: Record<string, unknown> = {}, slot = 1): Promise<IdentityInfo> {
  const run = queue.then(async() => {
    const blah = getBlahConfig(slot);
    if(!blah?.home) throw new Error('A decentralized Blah home bootstrap is required.');
    if(typeof secret?.domain !== 'string' || secret.domain.length > 253 || !/^[a-z0-9.-]+$/.test(secret.domain) ||
      typeof secret.profile !== 'string' || secret.profile.length > 100_000 ||
      [secret.identity, secret.device].some((key) => typeof key?.privateKey !== 'string' || key.privateKey.length > 256 ||
        typeof key?.publicKey !== 'string' || decode(key.publicKey).length !== 32)) {
      throw new Error('Invalid identity key or profile data.');
    }
    const {diemClient, verifySignature} = await import('@lib/blah/runtime');
    const client = await diemClient();
    const keys: Record<string, CryptoKey> = {};
    for(const role of ['identity', 'device'] as const) {
      keys[role] = await crypto.subtle.importKey('pkcs8', decode(secret[role].privateKey), 'Ed25519', false, ['sign']);
      const probe = crypto.getRandomValues(new Uint8Array(32));
      const publicKey = await crypto.subtle.importKey('raw', decode(secret[role].publicKey), 'Ed25519', false, ['verify']);
      if(!await crypto.subtle.verify('Ed25519', publicKey, await crypto.subtle.sign('Ed25519', keys[role], probe), probe)) {
        throw new Error('Identity file contains mismatched keys.');
      }
    }
    const backend: CryptoBackend = {
      random: (length) => crypto.getRandomValues(new Uint8Array(length)),
      publicKey: (role) => decode(secret[role as 'identity' | 'device'].publicKey),
      sign: async(role, data) => new Uint8Array(await crypto.subtle.sign('Ed25519', keys[role], new Uint8Array(data))),
      verify: verifySignature
    };
    const policy = renewalPolicy(secret.renewal);
    return client.identityOperation({profileLifetime: policy.profileDays * DAY, deviceLifetime: policy.deviceDays * DAY, operation, kind: 'user', domain: secret.domain, profile: Array.from(decode(secret.profile)),
      now: Math.floor(Date.now() / 1000),
      dc: Array.from(Uint8Array.from(blah.home.identity.match(/../g), (hex) => parseInt(hex, 16))),
      dcDomain: blah.home.domain, generation: blah.home.generation,
      account: null, device: null, challenge: null, query: null, keyID: null, sessionID: null, expiresAt: null,
      challengeKind: null, approvedChallenge: null, domains: null, usernameDomains: null,
      ...extra}, backend);
  });
  queue = run.catch(() => {});
  return run;
}
