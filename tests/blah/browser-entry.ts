import blah, {setBlahConfig} from '@config/blah';
import rootScope from '@lib/rootScope';
import {requireAccountBinding, prepareAccountStorage} from '@lib/blah/accountStorage';
import type {ActiveAccountNumber} from '@lib/accounts/types';
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode';
DeferredIsUsingPasscode.resolveDeferred(false);
// Two independent homes in one realm exercise the shared-worker custody boundary.
setBlahConfig(1, blah);
setBlahConfig(2, {...blah, home: {domain: 'other.example.org', identity: 'cd'.repeat(32), generation: '2'}});
export {identityAction, bindIdentity, numberIdentity, withIdentity, withResourceIdentity} from '@lib/blah/identity';
// Observe the same logout event that makes the application reload, without navigating this fixture.
export function resetAccount(slot?: ActiveAccountNumber) {
  const logout = new Promise((resolve) => rootScope.addEventListener('logging_out', resolve, {once: true}));
  return Promise.race([logout, slot ? requireAccountBinding(slot) : prepareAccountStorage()]);
}
export {default as accounts} from '@lib/accounts/accountController';
export {diem} from '@lib/blah/wasm';
export {diemClient} from '@lib/blah/runtime';
export {verifyResourceProfile} from '@lib/blah/resourceProfiles';
export {stored, decode} from '@lib/blah/vault';

export {setBlahConfig};

/** Real signing/hosting bridge with an in-page host transport, no DNS/server dependency. */
export async function exerciseHostedClaim(kind: 'user' | 'channel' = 'user') {
  const {diemClient, verifySignature} = await import('@lib/blah/runtime');
  const {identityAction, numberIdentity, withIdentity, bindIdentity} = await import('@lib/blah/identity');
  const {stored} = await import('@lib/blah/vault');
  const client = await diemClient();
  if(!client.hosting) return {supported: false};
  const slot = kind === 'user' ? 3 : 4;
  setBlahConfig(slot, blah);
  const domain = 'id.example';
  const hosted = {domain, label: 'alice'};
  const publications: {profile: number[], via: string, proof: string}[] = [];
  let published: Uint8Array;
  let held: string[] = [];
  let loseResponse = true;
  const originalFetch = window.fetch;
  const json = (value: unknown) => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
  window.fetch = async(input, init) => {
    const url = new URL(String(input));
    if(url.hostname !== domain && !url.hostname.endsWith('.' + domain)) return originalFetch(input, init);
    if(url.pathname.endsWith('/hosting')) return json({domain, labelPattern: '^[a-z]+$', maxClaimsPerIdentity: 3,
      maxUpdatesPerIdentityPerHour: 100, claimGraceAfterExpiry: 1000,
      proofOfWork: {algorithm: 'sha256-leading-zero-bits-v1', baseBits: 8, bitsPerShorterCharacter: 0, referenceLength: 0}});
    if(url.pathname.includes('/hosting/names/')) {
      const label = url.pathname.split('/').pop();
      return json({label, status: held.includes(label) ? 'claimed' : 'available', requiredBits: 8});
    }
    if(init?.method === 'PUT') {
      const bytes = new Uint8Array(init.body as Uint8Array);
      const profile = await client.verifyProfile(bytes, Math.floor(Date.now() / 1000), {verify: verifySignature});
      const headers = new Headers(init.headers);
      publications.push({profile: Array.from(bytes), via: url.hostname, proof: headers.get('Diem-Hosting-Proof')});
      published = bytes;
      held = profile.domains.filter((name) => name.endsWith('.' + domain)).map((name) => name.slice(0, -domain.length - 1));
      if(loseResponse) { loseResponse = false; throw new TypeError('Unanswered PUT'); }
      const identity = btoa(String.fromCharCode(...profile.id.match(/../g).map((hex) => parseInt(hex, 16))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return new Response(`{"identity":"${identity}","revision":${profile.revision},"domains":${JSON.stringify(held.map((label) => label + '.' + domain))}}`,
        {headers: {'Content-Type': 'application/json'}});
    }
    return held.includes(url.hostname.slice(0, -domain.length - 1)) ?
      new Response(new Uint8Array(published), {headers: {'Content-Type': 'application/cbor'}}) : new Response(null, {status: 404});
  };
  try {
    const signer = kind === 'channel' && (await identityAction(slot, {action: 'create', domain: 'signer.example', password: 'x'})).identity;
    if(signer) await bindIdentity(slot);
    const {identity, paperKey} = await identityAction(slot, {action: 'create', kind, domain: 'alice.id.example', password: 'x', hosted});
    const {hostingPlan} = await identityAction(slot, {action: 'hostingPlan', id: identity.id, hosted});
    const nonce = await client.hosting.solve(hostingPlan.puzzle);
    let failure: string;
    try { await identityAction(slot, {action: 'hostingClaim', id: identity.id, hosted: {...hosted, proofs: {alice: nonce}}}); }
    catch(error) { failure = (error as {type: string}).type; }
    const pending = (await identityAction(slot, {action: 'inspect', id: identity.id})).identity.publicationPending;
    await identityAction(slot, {action: 'retryPublication', id: identity.id});
    const exactRetry = JSON.stringify(publications[0].profile) === JSON.stringify(publications[1].profile);
    await numberIdentity(slot, '42', kind === 'channel' ? identity.id : undefined);
    await identityAction(slot, {action: 'renew', id: identity.id});
    const publishedState = (await identityAction(slot, {action: 'inspect', id: identity.id})).identity;
    const check = await identityAction(slot, {action: 'publication', id: identity.id});
    const {backup} = await identityAction(slot, {action: 'backup', id: identity.id});
    const opened = await client.keyFiles.unlock(backup, 'x');
    const portable = opened.contents.hosting;
    opened.session.destroy();
    const isolated = !signer || (await withIdentity(slot, async(_secret, info) => info.id)) === signer.id;
    await identityAction(slot, {action: 'domains', id: identity.id, domains: ['own.example']});
    const state = await stored<import('@lib/blah/hosting').HostedNames>('hosting:' + identity.id);
    return {supported: true, backup, portable, isolated, words: paperKey?.phrase.split(' ').length, kind, failure, pending, exactRetry, hasProof: !!publications[0].proof,
      account: publishedState.account, published: !publishedState.publicationPending, checked: !check.publication.pending,
      released: state.held.length === 0, releaseVia: publications[publications.length - 1].via, releaseProof: publications[publications.length - 1].proof,
      updatesWithoutProof: publications.slice(2).every((entry) => !entry.proof), puts: publications.length};
  } finally {
    window.fetch = originalFetch;
    await identityAction(slot, {action: 'lock'});
  }
}
