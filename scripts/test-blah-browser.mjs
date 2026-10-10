// A local fixture server, never an authorized Telegram preview or a deployed publisher.
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {blahDiemRuntimeURL} from './blah-config.mjs';

const diemRuntimeURL = blahDiemRuntimeURL(process.env.BLAH_DIEM_CDN_HOST);
const home = {domain: 'dc.example.org', identity: 'ab'.repeat(32), generation: '1'};
const directory = await mkdtemp(join(tmpdir(), 'blah-browser-test-'));
await build({entryPoints: ['tests/blah/browser-entry.ts'], bundle: true, format: 'iife', globalName: 'fixture',
  target: 'es2022', outfile: join(directory, 'fixture.js'),
  define: {'import.meta.env': '{}', __BLAH_CONFIG__: JSON.stringify({discovery: true, home, defaultDcId: 1, dcs: [], expiresAt: '9999999999'}),
    __BLAH_DIEM_RUNTIME_URL__: JSON.stringify(diemRuntimeURL), 'import.meta.env.BASE_URL': '"/"'}});
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
// Intercept only the fixture origin; real CDN requests exercise its *.blahim.com CORS policy.
const browserOrigin = 'https://blah-browser-test.blahim.com';
const serveLocal = async(route) => {
  const response = await route.fetch({url: route.request().url().replace(browserOrigin, origin)});
  await route.fulfill({response});
};
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.BLAH_BROWSER_EXECUTABLE, args: ['--no-sandbox']});
  const page = await browser.newPage();
  await page.route(`${browserOrigin}/**`, serveLocal);
  const runtimeRequests = new Set();
  page.on('request', (request) => {
    if(new URL(request.url()).origin === new URL(diemRuntimeURL).origin) runtimeRequests.add(request.url());
    assert(!new URL(request.url()).pathname.startsWith('/assets/blah/diem'), 'BlahDiem must load from the CDN');
  });
  page.on('pageerror', (error) => console.error(error));
  await page.goto(browserOrigin);
  const created = await page.evaluate(async() => {
    const response = await fixture.identityAction(1, {action: 'create', domain: 'alice.example.org', password: 'x'});
    const backup = (await fixture.identityAction(1, {action: 'backup'})).backup;
    await fixture.bindIdentity(1);
    return {identity: response.identity, backup};
  });
  assert.equal(created.identity.id.length, 64);
  assert.deepEqual([...runtimeRequests].sort(), [diemRuntimeURL, new URL('./diem.wasm', diemRuntimeURL).href].sort());
  assert.equal(created.identity.devices.length, 1);
  assert.equal(created.identity.expiresAt - created.identity.notBefore, 180 * 86400);
  assert.equal(created.identity.devices[0].expiresAt - created.identity.devices[0].notBefore, 180 * 86400);
  assert(Array.isArray(created.backup) && (created.backup[0] >> 5) === 5);
  assert(!Buffer.from(created.backup).includes('privateKey'));
  let hostedProfile = Buffer.from(created.identity.profile);
  let profileStatus = 200;
  await page.route('https://alice.example.org/.well-known/blah/profile.cbor', route => route.fulfill({
    status: profileStatus, contentType: 'application/cbor', body: hostedProfile
  }));
  const publication = () => page.evaluate(() => fixture.identityAction(1, {action: 'publication'}));
  assert.equal((await publication()).publication.pending, false, 'Manual publication clears the notice despite the stored pending flag');
  hostedProfile = Buffer.from([1, 2, 3]);
  assert.equal((await publication()).publication.pending, true, 'Different hosted content requires publication');
  profileStatus = 404;
  assert.equal((await publication()).publication.pending, true, 'Missing hosted content requires publication');
  profileStatus = 503;
  await assert.rejects(publication, /HTTP 503/, 'Unavailable hosting must not be reported as unpublished');
  profileStatus = 200;
  hostedProfile = Buffer.from(created.identity.profile);
  const checked = await page.evaluate(async() => {
    const {cbor} = await import('/cbor.mjs');
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    const challenge = cbor({0: 4, 1: 1, 2: 'alice.example.org', 3: new Uint8Array(32).fill(7), 4: expiresAt,
      5: new Uint8Array(32).fill(0xab), 6: 18446744073709551614n, 7: 18446744073709551613n});
    const extra = {challengeKind: 'invocation', challenge, approvedChallenge: challenge,
      expiresAt, keyID: '18446744073709551614', sessionID: '18446744073709551613', query: [1, 2, 3, 4]};
    const proof = await fixture.withIdentity(1, (secret) => fixture.diem('prove', secret, extra));
    let refused = 0;
    for(const replacement of [{keyID: '1'}, {sessionID: '2'}, {expiresAt: expiresAt + 1}]) {
      try { await fixture.withIdentity(1, (secret) => fixture.diem('prove', secret, {...extra, ...replacement})); }
      catch{ refused++; }
    }
    await fixture.numberIdentity(1, '12345');
    const numbered = await fixture.identityAction(1, {action: 'inspect'});
    await fixture.identityAction(1, {action: 'renew'});
    return {proof: proof.proof.length, refused, numbered: numbered.identity.account};
  });
  assert(checked.proof > 64);
  assert.equal(checked.refused, 3);
  assert.equal(checked.numbered, '12345');
  await page.reload();
  const reopened = await page.evaluate(async(id) => {
    let locked = false, badPassword = false;
    try { await fixture.identityAction(1, {action: 'inspect'}); } catch{ locked = true; }
    try { await fixture.identityAction(1, {action: 'unlock', id, password: 'wrong password here'}); } catch{ badPassword = true; }
    const result = await fixture.identityAction(1, {action: 'unlock', id, password: 'x'});
    return {locked, badPassword, account: result.identity.account};
  }, created.identity.id);
  assert.deepEqual(reopened, {locked: true, badPassword: true, account: '12345'});
  const second = await page.evaluate(async() => {
    const next = await fixture.identityAction(2, {action: 'create', domain: 'bob.example.org', password: 'second identity password'});
    await fixture.bindIdentity(2);
    await fixture.accounts.update(2, {userId: 2, dc1_auth_key: 'cd'.repeat(256)});
    let wrongHome = false;
    try { await fixture.withIdentity(2, (secret) => fixture.diem('inspect', secret, {}, 1)); } catch{ wrongHome = true; }
    let refused = false;
    try { await fixture.identityAction(1, {action: 'unlock', id: next.identity.id, password: 'second identity password'}); } catch{ refused = true; }
    const added = await fixture.identityAction(1, {action: 'addDevice',
      device: btoa(String.fromCharCode(...next.identity.devices[0].key))});
    const removed = await fixture.identityAction(1, {action: 'removeOtherDevices'});
    if(!removed.identity.devices[0].current) throw new Error('Termination must preserve the current device');
    await fixture.accounts.update(3, {userId: 123, dc1_auth_key: 'ab'.repeat(256)});
    const reset = await fixture.resetAccount(3);
    const empty = !Object.keys(await fixture.accounts.get(3)).length;
    return {refused, wrongHome, id: next.identity.id, added: added.identity.devices.length, removed: removed.identity.devices.length, reset, empty};
  });
  assert(second.refused);
  assert(second.wrongHome);
  assert.equal(second.added, 2);
  assert.equal(second.removed, 1);
  assert(second.reset && second.empty);
  const context = await browser.newContext();
  const restoredPage = await context.newPage();
  await restoredPage.route(`${browserOrigin}/**`, serveLocal);
  await restoredPage.goto(browserOrigin);
  const restored = await restoredPage.evaluate(async(backup) => {
    const result = await fixture.identityAction(1, {action: 'restore', backup, password: 'x'});
    let refused = false;
    try { await fixture.identityAction(1, {action: 'restore', backup, password: 'x'}); } catch{ refused = true; }
    return {id: result.identity.id, refused};
  }, created.backup);
  assert.equal(restored.id, created.identity.id);
  assert(restored.refused);
  await context.close();
  // Check the real vault/WASM at the renewal boundary without waiting months.
  const renewal = await page.evaluate(async(id) => {
    const realNow = Date.now;
    const before = (await fixture.identityAction(1, {action: 'inspect'})).identity;
    const at = before.notBefore + (before.expiresAt - before.notBefore) * .8;
    await fixture.identityAction(1, {action: 'renewal', renewal: {profileDays: 60, deviceDays: 90, autoRenew: false}});
    try {
      Date.now = () => at * 1000;
      const disabled = (await fixture.identityAction(1, {action: 'unlock', id, password: 'x'})).identity;
      await fixture.identityAction(1, {action: 'renewal', renewal: {profileDays: 60, deviceDays: 90, autoRenew: true}});
      const renewed = (await fixture.identityAction(1, {action: 'unlock', id, password: 'x'})).identity;
      const again = (await fixture.identityAction(1, {action: 'unlock', id, password: 'x'})).identity;
      const realFetch = window.fetch;
      let attempts = 0;
      window.fetch = async() => new Response('', {status: ++attempts < 3 ? 503 : 200});
      let pendingAfterFailure, published;
      try {
        try { await fixture.identityAction(1, {action: 'publisher', publisher: 'https://publisher.example.org/profile'}); } catch{}
        await fixture.withIdentity(1, async() => {});
        pendingAfterFailure = (await fixture.identityAction(1, {action: 'inspect'})).identity;
        await fixture.withIdentity(1, async() => {});
        published = (await fixture.identityAction(1, {action: 'inspect'})).identity;
      } finally { window.fetch = realFetch; }
      if(!pendingAfterFailure.publicationPending || published.publicationPending || attempts !== 3 ||
        JSON.stringify(published.profile) !== JSON.stringify(renewed.profile)) throw new Error('Publication retry must preserve the renewed profile');
      return {unchanged: disabled.expiresAt === before.expiresAt, profileDays: (renewed.expiresAt - renewed.notBefore) / 86400,
        deviceDays: (renewed.devices[0].expiresAt - renewed.devices[0].notBefore) / 86400,
        pending: renewed.publicationPending, stable: JSON.stringify(again.profile) === JSON.stringify(renewed.profile)};
    } finally { Date.now = realNow; }
  }, created.identity.id);
  assert.deepEqual(renewal, {unchanged: true, profileDays: 60, deviceDays: 90, pending: true, stable: true});
  // A background renewal catches the boundary without keeping the vault unlocked.
  await page.clock.install();
  const timerProfile = await page.evaluate(async() => {
    await fixture.identityAction(1, {action: 'publisher', publisher: ''});
    return (await fixture.identityAction(1, {action: 'inspect'})).identity;
  });
  const timerBoundary = timerProfile.notBefore + (timerProfile.expiresAt - timerProfile.notBefore) * .8;
  await page.clock.setSystemTime(new Date((timerBoundary - 30) * 1000));
  await page.evaluate(id => fixture.identityAction(1, {action: 'unlock', id, password: 'x'}), created.identity.id);
  await page.clock.runFor(60_000);
  await page.waitForFunction(async(previous) => (await fixture.identityAction(1, {action: 'inspect'})).identity.notBefore > previous, timerProfile.notBefore);
  for(let minute = 0; minute < 16; minute++) {
    await page.clock.runFor(60_000);
    await page.evaluate(() => fixture.identityAction(1, {action: 'list'}));
  }
  assert(await page.evaluate(async() => {
    try { await fixture.identityAction(1, {action: 'inspect'}); return false; } catch{ return true; }
  }), 'Background checks must not extend the unlock timeout');
  await page.evaluate(async() => {
    await fixture.accounts.update(1, {userId: 12345, dc1_auth_key: 'ab'.repeat(256)});
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('tweb-account-1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('session');
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('session', 'readwrite');
        tx.objectStore('session').put({_: 'authStateSignedIn'}, 'authState');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      request.onerror = () => reject(request.error);
    });
    await fixture.stored('home:1', 'another home');
  });
  await page.reload();
  assert(await page.evaluate(async(id) => {
    await fixture.resetAccount();
    const emptyCache = await new Promise((resolve, reject) => {
      const request = indexedDB.open('tweb-account-1');
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('session');
        const count = tx.objectStore('session').count();
        tx.oncomplete = () => { db.close(); resolve(count.result === 0); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      request.onerror = () => reject(request.error);
    });
    return !!await fixture.stored('identity:' + id) && emptyCache && (await fixture.accounts.get(1)).userId === 2 &&
      await fixture.stored('slot:1') && !Object.keys(await fixture.accounts.get(2)).length &&
      (await fixture.accounts.getTotalAccounts()) === 1;
  }, created.identity.id));
  const dcImport = await page.evaluate(async() => {
    const {cbor} = await import('/cbor.mjs');
    const sdk = await fixture.diemClient();
    const encode = value => btoa(String.fromCharCode(...value));
    const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
    const identity = await sdk.generateSigningKey(), device = await sdk.generateSigningKey();
    const keys = {};
    for(const [role, key] of Object.entries({identity, device})) {
      keys[role] = await crypto.subtle.importKey('pkcs8', decode(key.privateKey), 'Ed25519', false, ['sign']);
    }
    const backend = {
      random: size => crypto.getRandomValues(new Uint8Array(size)),
      publicKey: role => decode(({identity, device})[role].publicKey),
      sign: async(role, data) => new Uint8Array(await crypto.subtle.sign('Ed25519', keys[role], new Uint8Array(data))),
      verify: async(key, data, signature) => crypto.subtle.verify('Ed25519',
        await crypto.subtle.importKey('raw', new Uint8Array(key), 'Ed25519', false, ['verify']),
        new Uint8Array(signature), new Uint8Array(data))
    };
    const domain = 'operator.example.org', now = Math.floor(Date.now() / 1000);
    const dc = await sdk.dcSetup({data: cbor({9: [domain], 16: 5,
      18: [{0: domain, 1: 443, 2: true, 3: 1, 4: '/apiws'}], 19: [], 20: 'transport-key', 21: 1}),
      profile: null, now}, backend);
    const session = await sdk.keyFiles.create('x');
    const backup = await session.seal({domain, profile: encode(dc.profile), device,
      renewal: {profileDays: 90, deviceDays: 90, autoRenew: false}});
    session.destroy();
    fixture.setBlahConfig(4, {discovery: true, home: {domain, identity: dc.id, generation: '1'},
      defaultDcId: 1, dcs: [], expiresAt: '9999999999'});
    const restored = await fixture.identityAction(4, {action: 'restore', backup: Array.from(backup), password: 'x'});
    const challenge = cbor({0: 4, 1: 1, 2: domain, 3: new Uint8Array(32).fill(7), 4: now + 60,
      5: Uint8Array.from(dc.id.match(/../g), hex => parseInt(hex, 16)), 6: 10, 7: 11});
    const result = await fixture.withIdentity(4, secret => {
      if(secret.identity) throw new Error('Device file acquired recovery authority');
      return fixture.diem('prove', secret, {challengeKind: 'invocation', challenge,
        approvedChallenge: challenge, expiresAt: now + 60, keyID: '10', sessionID: '11', query: [1, 2, 3]}, 4);
    });
    return {account: restored.identity.account, proof: result.proof.length};
  });
  assert.equal(dcImport.account, '777000');
  assert(dcImport.proof > 64);
  console.log('PASS: real BlahDiem WASM creation, encrypted custody, proof/session binding, numbering, renewal, devices, reload, home/slot isolation and recovery.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, {recursive: true, force: true});
}
