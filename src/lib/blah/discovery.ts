import type {BlahConfig} from '@config/blah';
import type {DCDiscoveryResult} from '@blahdiem/diem';
import {diemClient, verifySignature} from '@lib/blah/runtime';
import {decode, encode, exclusively, stored} from '@lib/blah/vault';
import {bindHomeStorage} from '@lib/blah/homeStorage';

export type SavedDC = {domain: string, profile: string, version: DCDiscoveryResult};
const storageKey = 'dc-profile';
const maximumProfileBytes = 100_000;

export function dcDomain(input: string) {
  const value = input.trim().toLowerCase();
  const domain = value.startsWith('https://') ? value.slice(8).replace(/\/$/, '') : value;
  if(domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) {
    throw new Error('Enter a DC domain, such as dc.example.org, without a port or path.');
  }
  return domain;
}

export function savedDC() { return stored<SavedDC>(storageKey); }

export async function fetchDCProfile(domain: string): Promise<Uint8Array> {
  const response = await fetch(`https://${dcDomain(domain)}/.well-known/blah/profile.cbor`, {
    credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: {Accept: 'application/cbor'}, signal: AbortSignal.timeout(15_000)
  });
  if(!response.ok) throw new Error('DC profile request failed: HTTP ' + response.status);
  if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/cbor') {
    await response.body?.cancel();
    throw new Error('The DC must serve its profile as application/cbor.');
  }
  if(Number(response.headers.get('content-length')) > maximumProfileBytes) {
    await response.body?.cancel();
    throw new Error('DC profile is too large.');
  }
  const reader = response.body?.getReader();
  if(!reader) throw new Error('The DC returned an empty profile.');
  const bytes = new Uint8Array(maximumProfileBytes);
  let size = 0;
  try {
    while(true) {
      const {done, value} = await reader.read();
      if(done) return bytes.slice(0, size);
      if(size + value.length > maximumProfileBytes) throw new Error('DC profile is too large.');
      bytes.set(value, size);
      size += value.length;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/** WebCrypto accepts SPKI. Wrap PKCS#1's RSA sequence without interpreting its key. */
export async function transportKey(pem: string): Promise<BlahConfig['dcs'][number]['rsaKey']> {
  const match = /^-----BEGIN (RSA PUBLIC KEY|PUBLIC KEY)-----\s+([A-Za-z0-9+/=\s]+)-----END \1-----\s*$/.exec(pem);
  if(!match) throw new Error('The DC profile has an invalid RSA public key.');
  let der = decode(match[2].replace(/\s/g, ''));
  if(match[1] === 'RSA PUBLIC KEY') {
    const record = (tag: number, data: number[]) => [tag, ...(data.length < 128 ? [data.length] :
      [0x82, data.length >> 8, data.length & 255]), ...data];
    der = new Uint8Array(record(0x30, [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
      ...record(0x03, [0, ...der])]));
  }
  const key = await crypto.subtle.importKey('spki', der, {name: 'RSA-OAEP', hash: 'SHA-256'}, true, ['encrypt']);
  if((key.algorithm as RsaKeyAlgorithm).modulusLength !== 2048) throw new Error('The DC needs a 2048-bit RSA transport key.');
  const jwk = await crypto.subtle.exportKey('jwk', key);
  const hex = (value: string) => Array.from(decode(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return {modulus: hex(jwk.n), exponent: hex(jwk.e)};
}

export async function profileConfig(domain: string, profile: Uint8Array) {
  const version = await (await diemClient()).verifyDCProfile(domain, profile, Math.floor(Date.now() / 1000), {verify: verifySignature});
  const endpoint = version.endpoints.find((endpoint) => endpoint.transport === 'webSocket' && endpoint.tls);
  if(!endpoint) throw new Error('This DC needs a TLS WebSocket endpoint in its public profile.');
  const host = endpoint.host.includes(':') ? `[${endpoint.host}]` : endpoint.host;
  const url = new URL(`wss://${host}:${endpoint.port}${endpoint.path}`);
  // URL parsers normalize dot segments; dialing a different signed path is not discovery.
  if(url.pathname + url.search !== endpoint.path || url.username || url.password || url.hash) {
    throw new Error('The DC WebSocket path cannot be represented exactly by this browser.');
  }
  const config: BlahConfig = {discovery: true, defaultDcId: 1, expiresAt: version.expiresAt, profileDigest: version.digest,
    home: {domain, identity: version.id, generation: version.namespaceGeneration},
    dcs: [{id: 1, url: url.href, rsaKey: await transportKey(version.transportPublicKey)}]};
  return {config, version};
}

export function checkDCUpdate(previous: SavedDC, domain: string, next: DCDiscoveryResult) {
  if(!previous) return;
  const before = previous.version;
  if(previous.domain !== domain || before.id !== next.id || before.namespaceGeneration !== next.namespaceGeneration) {
    throw new Error('This browser origin is bound to another DC identity or database. Use a separate origin.');
  }
  if(BigInt(next.generation) < BigInt(before.generation) ||
    (next.generation === before.generation && (BigInt(next.revision) < BigInt(before.revision) ||
      (next.revision === before.revision && next.digest !== before.digest)))) {
    throw new Error('The DC returned an older or conflicting profile.');
  }
}

export async function connectDC(input: string): Promise<BlahConfig> {
  const domain = dcDomain(input);
  const profile = await fetchDCProfile(domain);
  const {config, version} = await profileConfig(domain, profile);
  // Cache admission is independent of network success and runs before accepting transport pins.
  await bindHomeStorage(config.home);
  await exclusively(async() => {
    checkDCUpdate(await savedDC(), domain, version);
    await stored<SavedDC>(storageKey, {domain, profile: encode(profile), version});
  });
  return config;
}

export async function restoreDC(): Promise<BlahConfig> {
  const saved = await savedDC();
  if(!saved) throw new Error('Choose a DC domain before connecting.');
  const {config, version} = await profileConfig(dcDomain(saved.domain), decode(saved.profile));
  checkDCUpdate(saved, saved.domain, version);
  await bindHomeStorage(config.home);
  return config;
}
