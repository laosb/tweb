// A local fixture server, never an authorized Telegram preview or a deployed publisher.
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {ensureBlahWasm} from './blah-wasm.mjs';

await ensureBlahWasm('public/assets/blah');
const home = {domain: 'dc.example.org', identity: 'ab'.repeat(32), generation: '1'};
const directory = await mkdtemp(join(tmpdir(), 'blah-browser-test-'));
await build({entryPoints: ['tests/blah/browser-entry.ts'], bundle: true, format: 'iife', globalName: 'fixture',
  plugins: [{name: 'public-assets', setup(build) {
    build.onResolve({filter: /^\/assets\/blah\/.*\?url$/}, ({path}) => ({path, namespace: 'public-asset'}));
    build.onLoad({filter: /.*/, namespace: 'public-asset'}, ({path}) => ({contents: 'export default ' + JSON.stringify(path.replace('?url', '')), loader: 'js'}));
  }}],
  target: 'es2022', outfile: join(directory, 'fixture.js'),
  define: {'import.meta.env': '{}', __BLAH_CONFIG__: JSON.stringify({discovery: true, home, defaultDcId: 1, dcs: [], expiresAt: '9999999999'}), 'import.meta.env.BASE_URL': '"/"'}});
const server = createServer(async(req, res) => {
  try {
    const path = req.url === '/fixture.js' ? join(directory, 'fixture.js') :
      req.url === '/cbor.mjs' ? 'tests/blah/cbor.mjs' :
      req.url === '/assets/blah/diem.js' ? 'public/assets/blah/diem.js' :
      req.url === '/assets/blah/diem.wasm' ? 'public/assets/blah/diem.wasm' : undefined;
    res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : path ? 'text/javascript' : 'text/html');
    res.end(path ? await readFile(path) : '<!doctype html><title>Blah identity fixture</title><script src="/fixture.js"></script>');
  } catch(error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.BLAH_BROWSER_EXECUTABLE, args: ['--no-sandbox']});
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error(error));
  await page.goto(origin);
  const created = await page.evaluate(async() => {
    const response = await fixture.identityAction(1, {action: 'create', domain: 'alice.example.org', password: 'test identity password'});
    const backup = (await fixture.identityAction(1, {action: 'backup'})).backup;
    await fixture.bindIdentity(1);
    return {identity: response.identity, backup};
  });
  assert.equal(created.identity.id.length, 64);
  assert.equal(created.identity.devices.length, 1);
  assert.equal(created.identity.expiresAt - created.identity.notBefore, 180 * 86400);
  assert.equal(created.identity.devices[0].expiresAt - created.identity.devices[0].notBefore, 180 * 86400);
  assert(!created.backup.includes('privateKey'));
  assert(!created.backup.includes('test identity password'));
  const checked = await page.evaluate(async() => {
    const {cbor} = await import('/cbor.mjs');
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    const challenge = cbor([4, 1, 'alice.example.org', new Uint8Array(32).fill(7), expiresAt,
      new Uint8Array(32).fill(0xab), 18446744073709551614n, 18446744073709551613n]);
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
    const result = await fixture.identityAction(1, {action: 'unlock', id, password: 'test identity password'});
    return {locked, badPassword, account: result.identity.account};
  }, created.identity.id);
  assert.deepEqual(reopened, {locked: true, badPassword: true, account: '12345'});
  const second = await page.evaluate(async() => {
    const next = await fixture.identityAction(2, {action: 'create', domain: 'bob.example.org', password: 'second identity password'});
    let wrongHome = false;
    try { await fixture.withIdentity(2, (secret) => fixture.diem('inspect', secret, {}, 1)); } catch{ wrongHome = true; }
    let refused = false;
    try { await fixture.identityAction(1, {action: 'unlock', id: next.identity.id, password: 'second identity password'}); } catch{ refused = true; }
    const added = await fixture.identityAction(1, {action: 'addDevice',
      device: btoa(String.fromCharCode(...next.identity.devices[0].key))});
    const removed = await fixture.identityAction(1, {action: 'removeDevice', device: next.identity.devices[0].id});
    let unbound = false;
    try { await fixture.requireAccountBinding(3, true); } catch{ unbound = true; }
    return {refused, wrongHome, id: next.identity.id, added: added.identity.devices.length, removed: removed.identity.devices.length, unbound};
  });
  assert(second.refused);
  assert(second.wrongHome);
  assert.equal(second.added, 2);
  assert.equal(second.removed, 1);
  assert(second.unbound);
  const context = await browser.newContext();
  const restoredPage = await context.newPage();
  await restoredPage.goto(origin);
  const restored = await restoredPage.evaluate(async(backup) => {
    const result = await fixture.identityAction(1, {action: 'restore', backup, password: 'test identity password'});
    let refused = false;
    try { await fixture.identityAction(1, {action: 'restore', backup, password: 'test identity password'}); } catch{ refused = true; }
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
      const disabled = (await fixture.identityAction(1, {action: 'unlock', id, password: 'test identity password'})).identity;
      await fixture.identityAction(1, {action: 'renewal', renewal: {profileDays: 60, deviceDays: 90, autoRenew: true}});
      const renewed = (await fixture.identityAction(1, {action: 'unlock', id, password: 'test identity password'})).identity;
      const again = (await fixture.identityAction(1, {action: 'unlock', id, password: 'test identity password'})).identity;
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
  await page.evaluate(id => fixture.identityAction(1, {action: 'unlock', id, password: 'test identity password'}), created.identity.id);
  await page.clock.runFor(60_000);
  await page.waitForFunction(async(previous) => (await fixture.identityAction(1, {action: 'inspect'})).identity.notBefore > previous, timerProfile.notBefore);
  for(let minute = 0; minute < 16; minute++) {
    await page.clock.runFor(60_000);
    await page.evaluate(() => fixture.identityAction(1, {action: 'list'}));
  }
  assert(await page.evaluate(async() => {
    try { await fixture.identityAction(1, {action: 'inspect'}); return false; } catch{ return true; }
  }), 'Background checks must not extend the unlock timeout');
  await page.evaluate(() => fixture.stored('home:1', 'another home'));
  await page.reload();
  assert(await page.evaluate(async() => {
    try { await fixture.identityAction(1, {action: 'list'}); return false; } catch{ return true; }
  }));
  console.log('PASS: real BlahDiem WASM creation, encrypted custody, proof/session binding, numbering, renewal, devices, reload, home/slot isolation and recovery.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, {recursive: true, force: true});
}
