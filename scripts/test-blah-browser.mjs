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
  define: {'import.meta.env': '{}', __BLAH_CONFIG__: JSON.stringify({home, defaultDcId: 1, dcs: []}), 'import.meta.env.BASE_URL': '"/"'}});
const server = createServer(async(req, res) => {
  try {
    const path = req.url === '/fixture.js' ? join(directory, 'fixture.js') :
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
  assert(!created.backup.includes('privateKey'));
  assert(!created.backup.includes('test identity password'));
  const checked = await page.evaluate(async() => {
    // Independent canonical-CBOR encoder, fixture-only; production encoding is Swift.
    const head = (major, input) => {
      let n = BigInt(input);
      if(n < 24n) return [major * 32 + Number(n)];
      const size = n <= 255n ? 1 : n <= 65535n ? 2 : n <= 4294967295n ? 4 : 8;
      const bytes = new Array(size);
      for(let i = size - 1; i >= 0; --i) { bytes[i] = Number(n & 255n); n >>= 8n; }
      return [major * 32 + ({1: 24, 2: 25, 4: 26, 8: 27})[size], ...bytes];
    };
    const cbor = (value) => {
      if(typeof value === 'number' || typeof value === 'bigint') return head(0, value);
      if(typeof value === 'string') { const bytes = [...new TextEncoder().encode(value)]; return [...head(3, bytes.length), ...bytes]; }
      if(value instanceof Uint8Array) return [...head(2, value.length), ...value];
      return [...head(4, value.length), ...value.flatMap(cbor)];
    };
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
    let refused = false;
    try { await fixture.identityAction(1, {action: 'unlock', id: next.identity.id, password: 'second identity password'}); } catch{ refused = true; }
    const added = await fixture.identityAction(1, {action: 'addDevice',
      device: btoa(String.fromCharCode(...next.identity.devices[0].key))});
    const removed = await fixture.identityAction(1, {action: 'removeDevice', device: next.identity.devices[0].id});
    let unbound = false;
    try { await fixture.requireAccountBinding(3, true); } catch{ unbound = true; }
    return {refused, id: next.identity.id, added: added.identity.devices.length, removed: removed.identity.devices.length, unbound};
  });
  assert(second.refused);
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
  await page.evaluate(() => fixture.stored('home', 'another home'));
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
