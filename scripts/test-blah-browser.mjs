// A local fixture server, never an authorized Telegram preview or a deployed publisher.
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {blahDiemRuntimeURL} from './blah-config.mjs';
import {localDiemRuntime, routeDiemRuntime} from '../tests/blah/localRuntime.mjs';

const diemRuntimeURL = blahDiemRuntimeURL(process.env.BLAH_DIEM_CDN_HOST);
const localRuntime = await localDiemRuntime(diemRuntimeURL);
const home = {domain: 'dc.example.org', identity: 'ab'.repeat(32), generation: '1'};
const directory = await mkdtemp(join(tmpdir(), 'blah-browser-test-'));
await build({entryPoints: ['tests/blah/browser-entry.ts'], bundle: true, format: 'iife', globalName: 'fixture',
  target: 'es2022', outfile: join(directory, 'fixture.js'),
  define: {'import.meta.env': '{}', __BLAH_CONFIG__: JSON.stringify({discovery: true, home, defaultDcId: 1, dcs: [], expiresAt: '9999999999'}),
    __BLAH_DIEM_RUNTIME_URL__: JSON.stringify(diemRuntimeURL), __BLAH_WIDGET__: 'false', 'import.meta.env.BASE_URL': '"/"'}});
const server = createServer(async(req, res) => {
  try {
    const path = req.url === '/fixture.js' ? join(directory, 'fixture.js') :
      req.url === '/cbor.mjs' ? 'tests/blah/cbor.mjs' : undefined;
    res.setHeader('Content-Type', path ? 'text/javascript' : 'text/html');
    res.end(path ? await readFile(path) : '<!doctype html><title>Blah identity fixture</title><script src="/fixture.js"></script>');
  } catch(error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.BLAH_BROWSER_EXECUTABLE, args: ['--no-sandbox']});
  const page = await browser.newPage();
  await routeDiemRuntime(page.context(), localRuntime);
  const runtimeRequests = new Set();
  page.on('request', (request) => {
    if(new URL(request.url()).origin === new URL(diemRuntimeURL).origin) runtimeRequests.add(request.url());
    assert(!new URL(request.url()).pathname.startsWith('/assets/blah/diem'), 'BlahDiem must load from the CDN');
  });
  page.on('pageerror', (error) => console.error(error));
  await page.goto(origin);
  const created = await page.evaluate(async() => {
    const {words} = await fixture.identityAction(1, {action: 'generateWords'});
    const {identity} = await fixture.identityAction(1, {action: 'create', domain: 'alice.example.org', phrase: words.join(' ')});
    const secret = await fixture.openCustody(1);
    const facts = {deviceAlgorithm: secret.device.privateKey.algorithm.name, extractable: secret.device.privateKey.extractable};
    secret.seed.fill(0);
    return {identity, words, facts};
  });
  assert.equal(created.words.length, 24);
  assert.equal(created.identity.devices.length, 1);
  assert.deepEqual(created.facts, {deviceAlgorithm: 'ECDSA', extractable: false});
  // Renew with a later clock so the exact validity change is observable.
  const renewed = await page.evaluate(async() => fixture.withIdentity(1, async(secret, info, save) => {
    const next = await fixture.diem('renew', secret, {now: Math.floor(Date.now() / 1000) + 60});
    await save(next);
    return next;
  }, false));
  assert(Number(renewed.expiresAt) > Number(created.identity.expiresAt));
  assert(renewed.devices.every((device) => Number(device.expiresAt) > Number(created.identity.devices[0].expiresAt)));
  const hostedProfile = Buffer.from(renewed.profile);
  await page.route('https://alice.example.org/.well-known/blah/profile.cbor', (route) => route.fulfill({
    contentType: 'application/cbor', body: hostedProfile}));
  await page.route('**/.well-known/diem/hosting', (route) => route.fulfill({
    status: new URL(route.request().url()).hostname === 'alice.example.org' ? 200 : 404,
    contentType: 'application/json', body: JSON.stringify({domain: 'alice.example.org', apex: true})}));
  await page.route('https://alice.example.org/.well-known/diem/hosting/names/@', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({label: '@', status: 'available', requiredBits: 4})}));
  const apexPublications = [];
  await page.route('https://alice.example.org/.well-known/diem/profile.cbor', async(route) => {
    const request = route.request();
    assert.equal(request.method(), 'PUT');
    assert.equal(request.headers()['content-type'], 'application/cbor');
    const bytes = [...request.postDataBuffer()];
    apexPublications.push(bytes);
    if(apexPublications.length === 1) {
      assert.equal(request.headers()['diem-hosting-proof'], undefined);
      await route.fulfill({status: 403, contentType: 'application/problem+json', body: JSON.stringify({
        type: 'urn:diem:profile-hosting:proof-required', title: 'Proof required', detail: 'Claim verification required', status: 403,
        labels: [{label: '@', reason: 'proof-required', requiredBits: 4}]})});
      return;
    }
    if(apexPublications.length === 2) {
      const header = request.headers()['diem-hosting-proof'];
      assert.match(header, /^@=[A-Za-z0-9_-]+$/);
      const nonce = Buffer.from(header.slice(2), 'base64url');
      const digest = createHash('sha256').update('diem-profile-hosting-pow-v1\0alice.example.org\0@\0')
        .update(Buffer.from(created.identity.id, 'hex')).update(nonce).digest();
      assert.equal(digest[0] >>> 4, 0, 'apex nonce must solve the domain/label/identity-bound puzzle');
    }
    const facts = await page.evaluate(async(bytes) => (await fixture.diemClient()).verifyProfile(
      bytes, Math.floor(Date.now() / 1000), {verify: fixture.verifySignature}), bytes);
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({
      identity: Buffer.from(facts.id, 'hex').toString('base64url'), revision: Number(facts.revision), domains: facts.domains})});
  });
  // A new slot shares the same home but always creates a different device.
  const recovered = await page.evaluate(async({words, home, id}) => {
    fixture.setBlahConfig(3, {discovery: true, home, defaultDcId: 1, dcs: [], expiresAt: '9999999999'});
    try {
      await fixture.identityAction(3, {action: 'restore', domain: 'alice.example.org', phrase: words.join(' ')});
      throw new Error('Expected apex proof refusal');
    } catch(error) { if(error.type !== 'BlahHostingProofFailed') throw new Error('Unexpected apex refusal: ' + JSON.stringify(error)); }
    // The same persisted proofs the chooser supplies, solved by the real runtime.
    const key = 'hosting:' + id;
    const state = await fixture.stored(key);
    if(state.held.includes('@') || state.pending) throw new Error('Apex refusal was not reconciled');
    const {hostingPlan: plan} = await fixture.identityAction(3, {action: 'hostingPlan', id,
      hosted: {domain: state.domain, label: '@'}});
    if(plan.label !== '@' || plan.status !== 'needsProof') throw new Error('Expected apex proof plan');
    const nonce = await (await fixture.diemClient()).hosting.solve(plan.puzzle);
    await fixture.withIdentity(3, async(secret, info, save) => {
      await fixture.stored(key, {...state, proofs: {...state.proofs, '@': nonce}});
      if(!await fixture.publish(secret, info)) throw new Error('Apex retry was not published');
      await save(info, false);
    }, false);
    return fixture.identityAction(3, {action: 'inspect'});
  }, {words: created.words, home, id: created.identity.id});
  assert.equal(recovered.identity.id, created.identity.id);
  assert.equal(recovered.identity.devices.length, 2);
  assert.notEqual(recovered.identity.devices.find((device) => device.current).id, created.identity.devices[0].id);
  assert.equal(recovered.identity.hostedNames.domain, 'alice.example.org');
  assert.deepEqual(recovered.identity.hostedNames.held, ['@']);
  assert.equal(recovered.identity.publicationPending, false);
  assert.deepEqual(apexPublications, [recovered.identity.profile, recovered.identity.profile]);
  console.log('PASS apex-first restoration, proof-required reconciliation, real-runtime @ proof and exact-byte PUT retry with @= header.');
  const upgraded = await page.evaluate(async(words) => {
    await fixture.identityAction(1, {action: 'removeWords'});
    const nonHolder = await fixture.identityAction(1, {action: 'inspect'});
    await fixture.identityAction(1, {action: 'enterWords', phrase: words.join(' ')});
    const shown = await fixture.identityAction(1, {action: 'words'});
    return {nonHolder: nonHolder.identity.holder, words: shown.words};
  }, created.words);
  assert.equal(upgraded.nonHolder, false);
  assert.deepEqual(upgraded.words, created.words);
  const channel = await page.evaluate(async() => {
    const {words} = await fixture.identityAction(1, {action: 'generateWords'});
    const result = await fixture.identityAction(1, {action: 'create', kind: 'channel', domain: 'news.example.org', phrase: words.join(' '), attempt: 'chat'});
    const shown = await fixture.identityAction(1, {action: 'words', id: result.identity.id});
    return {identity: result.identity, words, shown: shown.words, users: await fixture.identityAction(1, {action: 'list'})};
  });
  assert.deepEqual(channel.words, channel.shown);
  assert.equal(channel.identity.kind, 'channel');
  assert.deepEqual(channel.users.ids, []);
  await page.evaluate(() => fixture.numberIdentity(1, '42'));
  for(const transfer of [false, true]) {
    const linked = await page.evaluate(async({transfer, home}) => {
      fixture.setBlahConfig(4, {discovery: true, home, defaultDcId: 1, dcs: [], expiresAt: '9999999999'});
      const client = await fixture.diemClient();
      const begun = await client.deviceLink.begin('Browser fixture');
      try {
        const inspected = await client.deviceLink.inspect(begun.parameter, begun.request);
        const {identity} = await fixture.certifyLinkedDevice(1, (await fixture.identityAction(1, {action: 'inspect'})).identity.id, inspected.device);
        const response = await fixture.withIdentity(1, (secret) => client.deviceLink.respond({code: begun.parameter,
          request: begun.request, profile: identity.profile, domain: identity.domain, seed: transfer ? secret.seed : undefined}), false);
        const opened = await client.deviceLink.open(begun.session, response, Uint8Array.from(home.identity.match(/../g), (byte) => parseInt(byte, 16)));
        try { await fixture.installLinkedIdentity(4, opened, () => true); }
        finally { opened.seed?.fill(0); }
        const result = await fixture.identityAction(4, {action: 'inspect'});
        const secret = await fixture.openCustody(4);
        const extractable = secret.device.privateKey.extractable;
        secret.seed?.fill(0);
        // Each grant belongs to a separate slot lifetime.
        if(!transfer) await fixture.storeEntries([[fixture.custodyKey(4), null], ['slot:4', null], ['enrollment:4', null]]);
        return {holder: result.identity.holder, id: result.identity.id, extractable};
      } finally { begun.session.destroy(); }
    }, {transfer, home});
    assert.equal(linked.holder, transfer);
    assert.equal(linked.id, created.identity.id);
    assert.equal(linked.extractable, false);
  }
  const pendingDevice = await page.evaluate(async() => {
    const {identity} = await fixture.identityAction(4, {action: 'inspect'});
    try {
      await fixture.deviceLinkAction(4, {invokeApi: async() => { throw new Error('Offline after installation'); }},
        {action: 'begin', attempt: 'failed-proof', label: 'Browser', exceptIds: []});
      throw new Error('Expected proof failure');
    } catch(error) { if(error.message !== 'Offline after installation') throw error; }
    return identity.devices.find((device) => device.current).id;
  });
  await page.reload();
  const resumedDevice = await page.evaluate(async(home) => {
    fixture.setBlahConfig(4, {discovery: true, home, defaultDcId: 1, dcs: [], expiresAt: '9999999999'});
    let exports = 0;
    const result = await fixture.deviceLinkAction(4, {invokeApi: async(method, _params, options) => {
      if(method !== 'auth.exportLoginToken' || options.blahDeviceLink) throw new Error('QR restarted');
      exports++;
      return {_: 'auth.loginTokenSuccess', authorization: {_: 'auth.authorization', user: {id: 42}}};
    }}, {action: 'begin', attempt: 'reloaded-proof', label: 'Browser', exceptIds: []});
    if(result.loginToken._ !== 'auth.loginTokenSuccess' || exports !== 1) throw new Error('QR did not resume');
    return (await fixture.identityAction(4, {action: 'inspect'})).identity.devices.find((device) => device.current).id;
  }, home);
  assert.equal(resumedDevice, pendingDevice);
  assert.equal((await page.evaluate(() => fixture.identityAction(1, {action: 'inspect'}))).identity.id, created.identity.id);
  console.log('PASS non-extractable P-256 custody, recovery-word enrollment with a fresh device, holder downgrade/upgrade, chat isolation, renewal, cross-origin QR with/without seed transfer and installed-custody proof continuation after failure/reload.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, {recursive: true, force: true});
}
