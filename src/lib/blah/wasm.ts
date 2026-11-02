import {getBlahConfig} from '@config/blah';
import {DAY, renewalPolicy} from '@lib/blah/renewal';
import {decode} from '@lib/blah/vault';
import type {CryptoBackend, IdentityResult} from '@blahdiem/diem';

export type DeviceKey = {privateKey: CryptoKey, publicKey: Uint8Array};
export type IdentitySecret = {
  domain: string,
  profile: string,
  seed?: Uint8Array,
  identity?: {publicKey: Uint8Array, id: string, signer: CryptoKey},
  device: DeviceKey,
  renewal?: import('@lib/blah/renewal').RenewalPolicy,
  publicationPending?: boolean,
  hosting?: import('@lib/blah/hosting').PortableHosting
};
export type IdentityInfo = IdentityResult;

let queue: Promise<unknown> = Promise.resolve();

/** Serialize use of the Swift bridge; never let one account borrow another's signer. */
export function diem(operation: string, secret: IdentitySecret, extra: Record<string, unknown> = {}, slot = 1, kind: 'user' | 'channel' = 'user'): Promise<IdentityInfo> {
  const run = queue.then(async() => {
    const blah = getBlahConfig(slot);
    if(!blah?.home) throw new Error('A decentralized Blah home bootstrap is required.');
    if(!secret.device || typeof secret.domain !== 'string' || secret.domain.length > 253 ||
      !/^[a-z0-9.-]+$/.test(secret.domain) || typeof secret.profile !== 'string' || secret.profile.length > 100_000) {
      throw new Error('Invalid identity custody.');
    }
    const {diemClient, verifySignature} = await import('@lib/blah/runtime');
    const client = await diemClient();
    secret.identity ||= secret.seed && await client.seeds.identity(secret.seed);
    const backend: CryptoBackend = {
      random: (length) => crypto.getRandomValues(new Uint8Array(length)),
      publicKey: (role) => role === 'identity' ? secret.identity?.publicKey.slice(-32) || new Uint8Array() : secret.device.publicKey,
      sign: async(role, data) => new Uint8Array(await crypto.subtle.sign(role === 'identity' ? 'Ed25519' :
        {name: 'ECDSA', hash: 'SHA-256'}, role === 'identity' ? secret.identity.signer : secret.device.privateKey, new Uint8Array(data))),
      verify: verifySignature
    };
    const policy = renewalPolicy(secret.renewal);
    return client.identityOperation({profileLifetime: policy.profileDays * DAY, deviceLifetime: policy.deviceDays * DAY, operation, kind, domain: secret.domain, profile: Array.from(decode(secret.profile)),
      now: Math.floor(Date.now() / 1000),
      dc: Array.from(Uint8Array.from(blah.home.identity.match(/../g), (hex) => parseInt(hex, 16))),
      dcDomain: blah.home.domain, generation: blah.home.generation,
      account: null, device: null, challenge: null, query: null, keyID: null, sessionID: null, expiresAt: null,
      challengeKind: null, approvedChallenge: null, domains: null,
      ...extra}, backend);
  });
  queue = run.catch(() => {});
  return run;
}
