// Real tweb UI/worker -> TLS WebSocket or HTTPS -> a throwaway Teleblah DC. No production services.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {openSync} from 'node:fs';
import {createServer} from 'node:https';
import {createServer as tcpServer} from 'node:net';
import {mkdtemp, readFile, writeFile, mkdir, rename, rm} from 'node:fs/promises';
import {spawn, execFileSync} from 'node:child_process';
import {generateKeyPairSync, createHash} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {cbor} from '../tests/blah/cbor.mjs';
import {makeDCProfile} from '../tests/blah/dcProfile.mjs';
import {checkIdentityLayout} from '../tests/blah/identityLayout.mjs';
import {checkDeviceLink} from '../tests/blah/deviceLink.mjs';
import {checkDeviceLinkTdlib} from '../tests/blah/deviceLinkTdlib.mjs';
import {checkChatMenus} from '../tests/blah/chatMenus.mjs';
import {loadEnv} from 'vite';
import {blahDiemRuntimeURL} from './blah-config.mjs';
import {localDiemRuntime} from '../tests/blah/localRuntime.mjs';
const repo = fileURLToPath(new URL('../', import.meta.url));
const diemRuntimeURL = blahDiemRuntimeURL(loadEnv('blah', repo, '').BLAH_DIEM_CDN_HOST);
const localRuntime = await localDiemRuntime(diemRuntimeURL);
const testHttp = process.env.BLAH_TEST_HTTP_ONLY === '1';
const tele = process.env.BLAH_SERVER_REPO;
if(!tele) throw new Error('Set BLAH_SERVER_REPO to a Teleblah checkout with a built debug server.');
const require = createRequire(repo + '/package.json');
const {
  chromium, expect
} = require('@playwright/test');
const proxy = require('http-proxy').createProxyServer({
  ws: true
});
const dir = await mkdtemp(process.env.TMPDIR ? process.env.TMPDIR + '/tweb-e2e-' : '/tmp/tweb-e2e-');
const chatDomains = ['news.alice.example.org', 'updates.alice.example.org'];
const profileDomains = ['alice.example.org', 'bob.example.org', 'carol.example.org', ...chatDomains];
async function publishProfile(domain, bytes) {
  assert(profileDomains.includes(domain));
  // Teleblah's test transport reads <domain>.cbor; replace atomically like its e2e publisher.
  const file = dir + '/profiles/' + domain + '.cbor';
  await writeFile(file + '.tmp', bytes);
  await rename(file + '.tmp', file);
}
let child,
  otherChild,
  browser,
  edge,
  logs = '';
const free = async() => {
  const s = tcpServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
};
const stopServer = async server => {
  if(server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  const stopTimer = setTimeout(() => server.kill('SIGKILL'), 5000);
  if(server.exitCode === null && server.signalCode === null) await once(server, 'exit');
  clearTimeout(stopTimer);
};
try {
  const port = await free(),
    web = await free(),
    otherPort = await free(),
    otherWeb = await free();
  await mkdir(dir + '/profiles');
  const {
    privateKey,
    publicKey
  } = generateKeyPairSync('ed25519');
  const seed = Buffer.from(privateKey.export({
    format: 'jwk'
  }).d, 'base64url');
  await writeFile(dir + '/seed', seed);
  const raw = Buffer.from(publicKey.export({
    format: 'jwk'
  }).x, 'base64url');
  // Diem's public identity key encoding, independently constructed by this fixture.
  const key = Buffer.from(cbor({0: 'Diem/key', 1: 3, 2: 1, 3: 1, 4: raw}));
  const id = createHash('sha256').update(key).digest('hex');
  await writeFile(dir + '/local.json', JSON.stringify({
    options: {},
    requiresSignupEmailCode: false,
    requiresSignInEmailCode: false
  }));
  const testHosting = process.env.BLAH_TEST_HOSTING === '1';
  if(testHosting) await writeFile(dir + '/hosting.json', JSON.stringify({domain: 'id.example',
    database: dir + '/hosting.sqlite', maxUpdatesPerIdentityPerHour: 100,
    proofOfWork: {baseBits: 8, bitsPerShorterCharacter: 0, referenceLength: 0}}));
  const startDC = (domain, port, web, seedFile) => {
    const server = spawn(tele + '/.build/debug/BlahMTProtoServer', ['--port', String(port), '--web-port', String(web),
      '--data-db', dir + '/' + domain + '-data.sqlite', '--auth-db', dir + '/' + domain + '-auth.sqlite',
      '--jobs-db', dir + '/' + domain + '-jobs.sqlite', '--federation-domain', domain,
      // Transport keys survive a restart, as in a `--data-dir` deployment.
      '--db', dir + '/' + domain + '-sessions.sqlite',
      '--federation-key-file', seedFile, '--federation-key-algorithm', 'ed25519',
      '--real-ip-header', 'X-Real-IP', '--real-ip-header-required', 'true',
      '--local-config-file', dir + '/local.json', '--test-profile-directory', dir + '/profiles'], {
      cwd: tele, stdio: ['ignore', 'ignore', 'pipe'],
      env: {...process.env, ...(testHosting && domain === 'dc.example.org' ? {BLAH_PROFILE_HOSTING_CONFIG: dir + '/hosting.json'} : {})}
    });
    server.stderr.on('data', c => logs += c);
    return server;
  };
  child = startDC('dc.example.org', port, web, dir + '/seed');
  const otherKey = generateKeyPairSync('ed25519').privateKey.export({format: 'jwk'});
  await writeFile(dir + '/other-seed', Buffer.from(otherKey.d, 'base64url'));
  otherChild = startDC('other.example.org', otherPort, otherWeb, dir + '/other-seed');
  await new Promise(r => setTimeout(r, 2000));
  if(child.exitCode !== null || otherChild.exitCode !== null) throw Error('Server exited: ' + logs);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', dir + '/tls.key', '-out', dir + '/tls.crt', '-days', '1', '-subj', '/CN=localhost'], {
    stdio: 'ignore'
  });
  let hostingPuts = 0, httpRequests = 0;
  edge = createServer({
    key: await readFile(dir + '/tls.key'),
    cert: await readFile(dir + '/tls.crt')
  }, async(req, res) => {
    try {
      // Host routing also reaches the SharedWorker, unlike Playwright page routes.
      const runtime = localRuntime.get(`https://${req.headers.host}${req.url}`);
      if(runtime) {
        res.writeHead(200, {...runtime.headers, 'Content-Type': runtime.contentType});
        res.end(runtime.body);
        return;
      }
      const path = new URL(req.url, 'https://localhost').pathname;
      if(['POST', 'OPTIONS'].includes(req.method) && /^\/apiw?1?(?:_test)?$/.test(path)) {
        if(req.method === 'POST') ++httpRequests;
        req.headers['x-real-ip'] = req.socket.remoteAddress;
        const dcPort = new URL('https://' + req.headers.host).hostname === 'other-server-test.blahim.com' ? otherPort : port;
        proxy.web(req, res, {target: 'http://127.0.0.1:' + dcPort});
        return;
      }
      if(req.method === 'PUT' && ['/publish', '/publish/bob', '/publish/carol'].includes(path)) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        await publishProfile((path.split('/')[2] || 'alice') + '.example.org', Buffer.concat(chunks));
        res.end('ok');
        return;
      }
      // Profile hosting for fetches from the shared worker, which page routes do not intercept.
      const host = new URL('https://' + req.headers.host).hostname;
      if(testHosting && (host === 'id.example' || host.endsWith('.id.example'))) {
        if(req.method === 'PUT' && ++hostingPuts === 3) {
          // Commit the last-name release, then deliberately lose its acknowledgement.
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const response = await fetch('http://127.0.0.1:' + web + req.url, {method: 'PUT',
            headers: req.headers, body: Buffer.concat(chunks)});
          assert.equal(response.status, 200);
          await response.arrayBuffer();
          res.destroy();
          return;
        }
        proxy.web(req, res, {target: 'http://127.0.0.1:' + web});
        return;
      }
      if(req.method === 'GET' && path === '/.well-known/blah/profile.cbor' && profileDomains.includes(host)) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/cbor');
        res.setHeader('Cache-Control', 'no-store');
        res.end(await readFile(dir + '/profiles/' + host + '.cbor'));
        return;
      }
      const relative = path === '/' ? 'index.html' : path.slice(1);
      if(relative.includes('..')) {
        res.writeHead(400);
        res.end();
        return;
      }
      let body;
      try {
        body = await readFile(repo + '/dist/' + relative);
      } catch{
        body = await readFile(repo + '/public/' + relative);
      }
      const mime = {
        js: 'text/javascript',
        css: 'text/css',
        wasm: 'application/wasm',
        html: 'text/html',
        json: 'application/json',
        svg: 'image/svg+xml',
        woff2: 'font/woff2',
        webmanifest: 'application/manifest+json'
      };
      res.setHeader('Content-Type', mime[relative.split('.').at(-1)] || 'application/octet-stream');
      res.end(body);
    } catch{
      res.writeHead(404);
      res.end();
    }
  });
  const connectedPaths = new Set();
  edge.on('upgrade', (req, socket, head) => {
    assert(['/discovered/ws?route=home', '/rotated/ws?route=home', '/other/ws?route=home'].includes(req.url));
    connectedPaths.add(req.url);
    req.headers['x-real-ip'] = req.socket.remoteAddress;
    proxy.ws(req, socket, head, {target: 'ws://127.0.0.1:' + (req.url.startsWith('/other/') ? otherPort : port)});
  });
  proxy.on('error', () => {});
  edge.listen(0, '127.0.0.1');
  await once(edge, 'listening');
  const tlsPort = edge.address().port,
    origin = 'https://blah-server-test.blahim.com';
  const rsa = JSON.parse(await readFile(tele + '/Schemas/blah-rsa-key.json', 'utf8'));
  execFileSync(repo + '/node_modules/.bin/vite', ['build', '--mode', 'blah'], {
    cwd: repo,
    env: {
      ...process.env,
      BLAH_BOOTSTRAP_FILE: '',
      BLAH_SERVER_CONFIG_URL: '',
      BLAH_PROFILE_HOSTING_DOMAIN: testHosting ? 'id.example' : '',
      BLAH_API_ID: '12345',
      BLAH_API_HASH: '0123456789abcdef0123456789abcdef'
    },
    stdio: ['ignore', openSync(dir + '/build.log', 'w'), openSync(dir + '/build-errors.log', 'w')]
  });
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BLAH_BROWSER_EXECUTABLE,
    // SharedWorker requests do not inherit a Playwright context's ignoreHTTPSErrors.
    args: ['--no-sandbox', '--ignore-certificate-errors',
      // Keep the page and worker on an allowed CDN origin while serving everything locally.
      '--host-resolver-rules=' + ['blah-server-test.blahim.com', 'other-server-test.blahim.com', ...profileDomains, ...(testHosting ? ['id.example', '*.id.example'] : [])].map(host => `MAP ${host} 127.0.0.1:${tlsPort}`).join(',') +
        (localRuntime.size ? `,MAP ${new URL(diemRuntimeURL).hostname} 127.0.0.1:${tlsPort}` : '')]
  });
  const signupContext = await browser.newContext({
    ignoreHTTPSErrors: true
  });
  signupContext.setDefaultTimeout(30000);
  signupContext.setDefaultNavigationTimeout(60000);
  const page = await signupContext.newPage();
  let activePage = page;
  page.setDefaultTimeout(15000);
  const diagnostics = [];
  page.on('pageerror', e => diagnostics.push(e.message));
  page.on('console', m => {
    if(m.type() === 'error') diagnostics.push(m.text().slice(0, 350));
  });
  await page.goto(origin + '/?debug=1&noServiceWorker=1&a11y=1' + (testHttp ? '&http=1' : ''));
  const signedDC = await page.evaluate(makeDCProfile, {data: cbor({9: ['dc.example.org'], 16: 5, 18: [{0: '127.0.0.1', 1: tlsPort, 2: true, 3: 1, 4: '/discovered/ws?route=home'}], 19: [], 20: rsa.pkcs1Pem, 21: 1}),
    rotatedData: cbor({9: ['dc.example.org'], 16: 5, 18: [{0: '127.0.0.1', 1: tlsPort, 2: true, 3: 1, 4: '/rotated/ws?route=home'}], 19: [], 20: rsa.pkcs1Pem, 21: 1}),
    identityKey: privateKey.export({format: 'jwk'}), runtimeURL: diemRuntimeURL});
  assert.equal(signedDC.id, id);
  const otherData = cbor({9: ['other.example.org'], 16: 5, 18: [{0: 'other-server-test.blahim.com', 1: tlsPort, 2: true, 3: 1, 4: '/other/ws?route=home'}], 19: [], 20: rsa.pkcs1Pem, 21: 1});
  const otherDC = await page.evaluate(makeDCProfile, {data: otherData, rotatedData: otherData, identityKey: otherKey, runtimeURL: diemRuntimeURL});
  await signupContext.route('https://other.example.org/.well-known/blah/profile.cbor', route => route.fulfill({
    contentType: 'application/cbor', body: Buffer.from(otherDC.profile)
  }));
  let discoveryProfile = signedDC.profile;
  // A stopped DC serves no profile either; its web origin is the same process.
  let dcDown = false;
  await signupContext.route('https://dc.example.org/.well-known/blah/profile.cbor', route => dcDown ?
    route.abort('connectionrefused') : route.fulfill({contentType: 'application/cbor', body: Buffer.from(discoveryProfile)}));
  const domainInput = page.getByRole('textbox', {name: 'DC domain'});
  await domainInput.fill('http://dc.example.org');
  await domainInput.press('Enter');
  await page.getByRole('status').filter({hasText: 'Enter a DC domain'}).waitFor();
  assert.equal(await domainInput.evaluate(node => node === document.activeElement), true);
  await page.setViewportSize({width: 375, height: 720});
  assert.equal(await page.evaluate(() => document.querySelector('#auth-pages').scrollWidth <= innerWidth), true);
  await domainInput.fill('dc.example.org');
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', {name: 'Connect to Blah'}).evaluate(node => node === document.activeElement), true);
  if(process.env.BLAH_UI_SCREENSHOT) await page.screenshot({path: process.env.BLAH_UI_SCREENSHOT, animations: 'disabled'});
  // Shared tweb controls retain the theme palette; audit contrast in the
  // client's increased-contrast mode, like the main accessibility suite.
  assert.deepEqual((await new AxeBuilder({page}).include('#auth-pages').disableRules(['color-contrast']).analyze()).violations, []);
  await page.evaluate(async() => { await window.useAppSettings()[1]('increaseContrast', true); window.themeController.setTheme(); });
  assert.deepEqual((await new AxeBuilder({page}).include('#auth-pages').analyze()).violations, []);
  await page.evaluate(async() => { await window.useAppSettings()[1]('increaseContrast', false); window.themeController.setTheme(); });
  await page.keyboard.press('Enter');
  try {
    if(testHosting) {
      const picker = page.getByRole('combobox', {name: 'Saved identity', exact: true});
      await picker.fill('create');
      await page.getByRole('option', {name: 'Create identity', exact: true}).click();
      const setup = page.getByRole('dialog', {name: 'Create identity', exact: true});
      await setup.getByRole('combobox', {name: 'Profile address'}).selectOption('hosted');
      await setup.getByLabel('Identity password', {exact: true}).fill('hosted password');
      assert.equal(await setup.getByRole('textbox', {name: 'Hosting domain', exact: true}).inputValue(), 'id.example');
      await setup.getByRole('textbox', {name: 'Name', exact: true}).fill('browser');
      await setup.getByRole('button', {name: 'Claim and publish', exact: true}).click();
      const details = page.getByRole('dialog', {name: 'Identity details', exact: true});
      await details.getByText('Hosted profile published.', {exact: true}).waitFor();
      const first = await page.evaluate(async() => {
        const manager = window.rootScope.managers.appAccountManager;
        const {identity} = await manager.blahIdentity({action: 'inspect'});
        const {publication} = await manager.blahIdentity({action: 'publication'});
        return {domains: identity.domains, held: identity.hostedNames.held, pending: publication.pending};
      });
      assert.deepEqual(first, {domains: ['browser.id.example'], held: ['browser'], pending: false});
      await details.getByRole('textbox', {name: 'Profile domain', exact: true}).fill('own.example');
      await details.getByRole('button', {name: 'Add domain', exact: true}).click();
      await details.getByRole('group', {name: 'browser.id.example', exact: true}).getByRole('button', {name: 'Delete', exact: true}).click();
      await details.getByRole('group', {name: 'browser.id.example', exact: true}).waitFor({state: 'detached'});
      await details.getByText('Publication pending. Retry the claim or choose another name.', {exact: true}).waitFor();
      await details.getByRole('button', {name: 'Retry publication', exact: true}).click();
      await details.getByText('Hosted profile published.', {exact: true}).waitFor();
      const released = await page.evaluate(async() => {
        const {identity} = await window.rootScope.managers.appAccountManager.blahIdentity({action: 'inspect'});
        return {held: identity.hostedNames.held, status: (await fetch('https://browser.id.example/.well-known/blah/profile.cbor')).status};
      });
      assert.deepEqual(released, {held: [], status: 404});
      await details.getByRole('button', {name: 'Close', exact: true}).click();
      await details.waitFor({state: 'detached'});
      const hostedChat = await page.evaluate(async(runtimeURL) => {
        const manager = window.rootScope.managers.appAccountManager;
        const users = (await manager.blahIdentity({action: 'list'})).ids;
        const hosted = {domain: 'id.example', label: 'chat'};
        const {identity, paperKey} = await manager.blahChatIdentity({action: 'prepare', domain: 'chat.id.example',
          password: 'chat password', attempt: 'server-hosted-chat', hosted});
        const {hostingPlan} = await manager.blahIdentity({action: 'hostingPlan', id: identity.id, hosted});
        const client = await (await import(runtimeURL)).createDiem();
        const nonce = await client.hosting.solve(hostingPlan.puzzle);
        const claimed = await manager.blahIdentity({action: 'hostingClaim', id: identity.id, hosted: {...hosted, proofs: {chat: nonce}}});
        const {publication} = await manager.blahIdentity({action: 'publication', id: identity.id});
        const {backup} = await manager.blahIdentity({action: 'backup', id: identity.id});
        const opened = await client.keyFiles.unlock(backup, 'chat password');
        const hosting = opened.contents.hosting;
        opened.session.destroy();
        const after = (await manager.blahIdentity({action: 'list'})).ids;
        await manager.blahIdentity({action: 'lock', id: identity.id});
        return {kind: claimed.identity.kind, held: claimed.identity.hostedNames.held, pending: publication.pending,
          words: paperKey.phrase.split(' ').length, isolated: JSON.stringify(users) === JSON.stringify(after),
          backupHeld: hosting.held, backupPending: 'pending' in hosting};
      }, diemRuntimeURL);
      assert.deepEqual(hostedChat, {kind: 'channel', held: ['chat'], pending: false, words: 24,
        isolated: true, backupHeld: ['chat'], backupPending: false});
      console.log('PASS hosted UI claim, dedicated proof workers, actual Teleblah hosting PUT/discovery and unanswered last-name release reconciliation; hosted chat claim, exact publication, paper key, backup and custody isolation.');
    }
    accountChecks: {
    if(testHosting && process.env.BLAH_TEST_HOSTING_ONLY) break accountChecks;
    await checkIdentityLayout(page);
    async function signUp(page, slot, domain, name, publisher) {
      const picker = page.getByRole('combobox', {name: 'Saved identity', exact: true});
      assert.equal(await page.getByText('Your keys are never uploaded.', {exact: false}).count(), 0);
      await picker.fill('create');
      if(process.env.BLAH_IDENTITY_SCREENSHOT) await page.getByRole('listbox', {name: 'Saved identity'}).screenshot({
        path: process.env.BLAH_IDENTITY_SCREENSHOT + '-picker.png', animations: 'disabled'
      });
      await page.getByRole('option', {name: 'Create identity', exact: true}).click();
      assert.equal(await page.getByRole('dialog').getByLabel('Identity file', {exact: true}).count(), 0);
      const publicationURL = page.getByRole('dialog').locator('code');
      assert.equal(await publicationURL.innerText(), 'https://your-domain/.well-known/blah/profile.cbor');
      await page.getByRole('dialog').getByLabel('Identity password', {exact: true}).fill('test identity password');
      await page.getByLabel('Profile domain', {exact: true}).fill(' EXAMPLE.ORG ');
      assert.equal(await publicationURL.innerText(), 'https://example.org/.well-known/blah/profile.cbor');
      await page.getByLabel('Profile domain', {
        exact: true
      }).fill(domain);
      assert.equal(await publicationURL.innerText(), `https://${domain}/.well-known/blah/profile.cbor`);
      if(process.env.BLAH_IDENTITY_SCREENSHOT) await page.getByRole('dialog').screenshot({
        path: process.env.BLAH_IDENTITY_SCREENSHOT + '-create.png', animations: 'disabled'
      });
      await page.getByRole('button', {
        name: 'Create identity',
        exact: true
      }).click();
      await page.getByRole('button', {
        name: 'Export public profile',
        exact: true
      }).waitFor({
        timeout: 30000
      });
      const details = page.getByRole('dialog', {name: 'Identity details', exact: true});
      const identityID = await details.locator('code').filter({hasText: /^[a-f0-9]{64}$/}).first().innerText();
      assert.equal(await picker.innerText(), domain + ' - ' + identityID.slice(0, 6));
      if(process.env.BLAH_IDENTITY_SCREENSHOT) await details.screenshot({path: process.env.BLAH_IDENTITY_SCREENSHOT + '-details.png', animations: 'disabled'});
      assert.deepEqual((await new AxeBuilder({page}).include('[role="dialog"]').disableRules(['color-contrast']).analyze()).violations, []);
      const profileValidity = details.getByLabel('Profile validity (days)', {exact: true});
      const deviceValidity = details.getByLabel('Device key validity (days)', {exact: true});
      assert.equal(await profileValidity.inputValue(), '180');
      assert.equal(await deviceValidity.inputValue(), '180');
      const autoRenew = details.getByRole('checkbox', {name: 'Renew automatically', exact: true});
      assert(await autoRenew.isChecked());
      await profileValidity.fill('60');
      await deviceValidity.fill('90');
      await autoRenew.press('Space');
      assert.equal(await autoRenew.isChecked(), false);
      assert.equal(await details.locator('details').count(), 0);
      assert.equal(await details.getByRole('button', {name: 'Save', exact: true}).count(), 0);
      assert.equal(await details.getByText('Profile publishing', {exact: true}).count(), 0);
      // Imported publisher settings remain supported; configuration is no longer in details.
      await page.evaluate(async(publisher) => {
        await window.rootScope.managers.appAccountManager.blahIdentity({action: 'publisher', publisher});
      }, publisher);
      await details.getByRole('button', {name: 'Close', exact: true}).click();
      await details.waitFor({state: 'detached'});
      await page.getByRole('button', {name: 'Identity details', exact: true}).click();
      await details.getByLabel('Identity password', {exact: true}).fill('test identity password');
      await details.getByRole('button', {name: 'Unlock identity', exact: true}).click();
      await profileValidity.waitFor();
      assert.equal(await profileValidity.inputValue(), '60');
      assert.equal(await deviceValidity.inputValue(), '90');
      assert.equal(await autoRenew.isChecked(), false);
      await page.keyboard.press('Escape');
      await details.waitFor({state: 'detached'});
      await assert.rejects(() => page.evaluate(() => window.rootScope.managers.appAccountManager.blahIdentity({action: 'inspect'})));
      await page.getByLabel('Identity password', {exact: true}).fill('test identity password');
      await page.getByRole('button', {
        name: 'Sign in to Blah',
        exact: true
      }).click();
      await page.locator('[contenteditable=true]').first().fill(name, {
        timeout: 30000
      });
      await page.getByRole('button', {
        name: /Start messaging/i
      }).click();
      await page.waitForFunction(slot => JSON.parse(localStorage.getItem('account' + slot) || '{}').userId, slot, {timeout: 30000});
      return identityID;
    }
    const aliceIdentity = await signUp(page, 1, 'alice.example.org', 'Alice', origin + '/publish');
    // The long-domain layout check also left a user identity in the vault.
    const signInIDsBeforeChats = await page.evaluate(async() => (await window.rootScope.managers.appAccountManager.blahIdentity({action: 'list'})).ids);
    assert(signInIDsBeforeChats.includes(aliceIdentity));
    const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('account1')).userId);
    // These go through the application schema and manager, never a raw UI RPC.
    await page.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
    await page.locator('#auth-pages').waitFor({state: 'hidden'});
    if(process.env.BLAH_TEST_MENUS_ONLY === '1') {
      await checkChatMenus({page, expect});
      break accountChecks;
    }
    if(process.env.BLAH_TEST_DEVICE_LINK_TDLIB === '1') {
      await checkDeviceLinkTdlib({browser, page, origin, signedDC, identityID: aliceIdentity, userId,
        tele, dir, port, rsa, dc: Buffer.from(id, 'hex').toString('base64'), runtimeURL: diemRuntimeURL});
      if(process.env.BLAH_TEST_DEVICE_LINK_ONLY === '1') break accountChecks;
    }
    if(process.env.BLAH_TEST_DEVICE_LINK === '1') {
      await checkDeviceLink({browser, page, origin, signedDC, identityID: aliceIdentity, userId, runtimeURL: diemRuntimeURL});
      if(process.env.BLAH_TEST_DEVICE_LINK_ONLY === '1') break accountChecks;
    }
    const resourceProfiles = await page.evaluate(async(userId) => {
      const managers = window.rootScope.managers;
      const channelId = await managers.appChatsManager.createChannel({title: 'Home-only fixture', about: '', megagroup: true});
      const profiles = await managers.appProfileManager.getBlahResourceProfiles([userId, -channelId]);
      return {channelId, profiles};
    }, userId);
    assert.equal(resourceProfiles.profiles[0].status, 'present');
    assert.equal(String(resourceProfiles.profiles[0].profile.id), String(userId));
    assert.deepEqual(resourceProfiles.profiles[1], {status: 'missing', homeDomain: 'dc.example.org'});
    await page.evaluate(async(channelId) => {
      await window.appImManager.setPeer({peerId: -channelId});
    }, resourceProfiles.channelId);
    await page.locator('#column-center .chat-info').filter({hasText: 'Home-only fixture'}).click();
    const homeNotice = page.getByText('Only people on dc.example.org can join', {exact: true});
    await homeNotice.waitFor();
    assert.equal(await homeNotice.locator('..').getByRole('button').count(), 0, 'The notice is informational');
    await page.evaluate(() => window.appSidebarRight.toggleSidebar(false));

    // The service account answers its commands. Its answer must reach the client after
    // the command's own result: overtaking it is a pts gap, and a difference that delivers
    // the command first leaves the sent message pending under its temporary id.
    async function askServiceAccount(command, answer) {
      await page.waitForFunction(() => !!window.appImManager?.chat);
      await page.evaluate(() => window.appImManager.setPeer({peerId: 777000}));
      await page.waitForFunction(() => window.appImManager.chat.peerId === 777000 && !window.appImManager.chat.setPeerPromise);
      const chat = page.locator('#column-center .chat.active');
      // An empty editor can lay out at zero height under its placeholder after a reload.
      await chat.locator('.chat-input .input-message-input[contenteditable="true"]').focus();
      await page.keyboard.type(command);
      await page.keyboard.press('Enter');
      await expect(chat.locator('.bubble.is-in').filter({hasText: answer}).last()).toBeVisible({timeout: 30000});
      // The client holds the command confirmed under its server id; a stuck send keeps a
      // temporary id beside the copy getDifference delivered.
      await expect.poll(() => page.evaluate(async(command) => {
        const messages = window.rootScope.managers.appMessagesManager;
        const {history} = await messages.getHistory({peerId: 777000, limit: 20});
        const held = await Promise.all(history.map(mid => messages.getMessageByPeer(777000, mid)));
        return {temporary: history.filter(mid => !Number.isInteger(mid)),
          sent: held.some(message => message.pFlags.out && message.message === command)};
      }, command)).toEqual({temporary: [], sent: true});
    }
    if(testHttp) {
      await askServiceAccount('/storage_usage', 'Storage usage');
      await page.reload();
      await page.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
      await askServiceAccount('/check_profile', 'Profile check queued.');
      assert(httpRequests > 0, 'The client must POST MTProto requests');
      assert.equal(connectedPaths.size, 0, 'HTTP-only mode must not open a WebSocket');
      console.log(`PASS HTTP-only DC discovery, UI signup/sign-in, service-account sends and replies, and signed-in reload (${httpRequests} MTProto POSTs; zero WebSockets).`);
      break accountChecks;
    }
    const restartDC = () => { child = startDC('dc.example.org', port, web, dir + '/seed'); };
    await askServiceAccount('/storage_usage', 'Storage usage');
    // A DC restarting under an open client: the command waits for the reconnection.
    await stopServer(child);
    restartDC();
    await askServiceAccount('/check_profile', 'Profile check queued.');
    // Reloading while the DC is down keeps the signed-in account on its saved verified
    // profile, and the client connects once the DC is back, with no further reload.
    await stopServer(child);
    dcDown = true;
    await page.reload();
    await page.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
    await expect(page.getByRole('textbox', {name: 'DC domain'})).toHaveCount(0);
    dcDown = false;
    restartDC();
    // The connection status names itself in the search field until it is back.
    await expect(page.locator('#column-left').getByRole('textbox', {name: 'Search', exact: true})).toBeVisible({timeout: 30000});
    await askServiceAccount('/storage_usage', 'Storage usage');

    async function downloadFile(button, filename, suggestedFilename) {
      await expect(button).toBeEnabled();
      const pending = page.waitForEvent('download');
      await button.press('Enter');
      const download = await pending;
      if(suggestedFilename) assert.equal(download.suggestedFilename(), suggestedFilename);
      await download.saveAs(filename);
      const bytes = await readFile(filename);
      assert(bytes.length > 0, 'Downloaded file is not empty');
      return bytes;
    }
    async function verifyChatProfile(bytes, domain, account) {
      const profile = await page.evaluate(async({bytes, runtimeURL}) => {
        const {createDiem} = await import(runtimeURL);
        const diem = await (window.blahTestProfileVerifier ||= createDiem());
        return diem.verifyProfile(new Uint8Array(bytes), Math.floor(Date.now() / 1000), {
          verify: async(key, data, signature) => crypto.subtle.verify('Ed25519',
            await crypto.subtle.importKey('raw', new Uint8Array(key), 'Ed25519', false, ['verify']),
            new Uint8Array(signature), new Uint8Array(data))
        });
      }, {bytes: Array.from(bytes), runtimeURL: diemRuntimeURL});
      assert.equal(profile.kind, 'channel');
      assert.deepEqual(profile.domains, [domain]);
      assert.equal(profile.home.dc, id);
      if(account === undefined) assert(!profile.home.account, 'Proposed identity is unnumbered');
      else assert.equal(profile.home.account, String(account));
      return profile;
    }
    async function readChatProfile(chatId) {
      const result = await page.evaluate(async(chatId) => {
        const [result] = await window.rootScope.managers.appProfileManager.getBlahResourceProfiles([-chatId]);
        return result?.status === 'present' ? {id: result.profile.id, profile: Array.from(result.profile.profile)} : result;
      }, chatId);
      assert.equal(String(result.id), String(chatId), 'blah.getChannelProfile returns the requested channel');
      return result.profile;
    }
    async function completeChatIdentity(domain, title, primaryAction) {
      const dialog = page.getByRole('dialog', {name: 'Cross-server', exact: true});
      const password = dialog.getByLabel('Identity password', {exact: true});
      await dialog.waitFor();
      await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await password.fill('test chat identity password');
      await password.press('Enter');
      await expect(dialog.locator('ol li')).toHaveCount(24, {timeout: 30000});
      const paperPhrase = (await dialog.locator('ol li').allInnerTexts()).join(' ');
      assert(paperPhrase.split(' ').every(word => /^[a-z]+$/.test(word)), 'Paper key contains 24 words');
      const saveFile = dialog.getByRole('button', {name: 'Save identity file', exact: true});
      await expect(saveFile).toBeFocused();
      await downloadFile(saveFile, dir + '/' + domain + '-identity.cbor', domain + '-identity.cbor');
      for(const key of ['Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        assert(await dialog.evaluate(element => element.contains(document.activeElement)), 'Chat dialog contains keyboard focus');
      }
      await expect(dialog.getByText(`https://${domain}/.well-known/blah/profile.cbor`, {exact: true})).toBeVisible();
      assert.deepEqual((await new AxeBuilder({page}).include('[role="dialog"]').disableRules(['color-contrast']).analyze()).violations, []);
      await dialog.getByRole('button', {name: 'I wrote it down', exact: true}).press('Enter');
      await expect(dialog.locator('ol li')).toHaveCount(0);
      const exportProfile = dialog.getByRole('button', {name: 'Export public profile', exact: true});
      const proposed = await downloadFile(exportProfile, dir + '/' + domain + '-proposed.cbor', 'profile.cbor');
      const verified = await verifyChatProfile(proposed, domain);
      await publishProfile(domain, proposed);
      // The bind action checks the exact HTTPS bytes from the shared worker before sending its proof.
      await dialog.getByRole('button', {name: primaryAction, exact: true}).press('Enter');
      const check = dialog.getByRole('button', {name: 'Check publication', exact: true});
      await expect(check).toBeFocused({timeout: 30000});
      await expect(dialog).toContainText('The chat is now bound to this identity.');
      const entry = await page.evaluate(async(domain) => {
        const {identities} = await window.rootScope.managers.appAccountManager.blahIdentity({action: 'list', kind: 'channel'});
        return identities.find(entry => entry.domain === domain);
      }, domain);
      assert.equal(entry.id, verified.id);
      assert.equal(entry.title, title);
      assert(entry.chatId > 0);
      assert.deepEqual(Buffer.from(await readChatProfile(entry.chatId)), proposed, 'The create/edit proof bound the proposed profile at the DC');
      const numbered = await downloadFile(exportProfile, dir + '/' + domain + '-numbered.cbor', 'profile.cbor');
      assert.equal((await verifyChatProfile(numbered, domain, entry.chatId)).id, verified.id);
      assert(!numbered.equals(proposed), 'Numbering changes the exported profile');
      await publishProfile(domain, numbered);
      await downloadFile(saveFile, dir + '/' + domain + '-numbered-identity.cbor', domain + '-identity.cbor');
      // getChannelProfile returns stored knowledge. A proof-wrapped read refetches the
      // hosted numbered revision, just like the account read after signup. Custody is
      // still unlocked here; closing the dialog locks it.
      await page.evaluate(async({id, chatId}) => {
        const managers = window.rootScope.managers;
        const channel = await managers.appChatsManager.getChannelInput(chatId);
        await managers.apiManager.invokeApi('blah.getChannelProfile', {id: [channel]}, {blahResourceIdentity: id});
      }, entry);
      await check.press('Enter');
      await dialog.waitFor({state: 'detached'});
      const storedProfile = await readChatProfile(entry.chatId);
      assert.deepEqual(Buffer.from(storedProfile), numbered, 'The DC returns the published numbered profile');
      assert.equal((await verifyChatProfile(storedProfile, domain, entry.chatId)).id, entry.id);
      return {...entry, paperPhrase};
    }
    async function openNewChannel(title) {
      // At desktop width the sidebar is already visible and the chat's Close button is hidden.
      await page.locator('#new-menu').press('Enter');
      await page.getByRole('menuitem', {name: 'New Channel', exact: true}).press('Enter');
      const form = page.locator('.new-channel-container.active');
      await form.getByLabel('Channel name', {exact: true}).fill(title);
      await expect(form.getByRole('checkbox', {name: 'Cross-server', exact: true})).not.toBeChecked();
      return form;
    }
    async function finishChannelCreation(title) {
      const members = page.locator('.add-members-container.active');
      await members.waitFor();
      // Leave optional subscriber selection via its own Back button; Escape routes to the chat.
      await members.getByRole('button', {name: 'Back', exact: true}).press('Enter');
      await members.waitFor({state: 'detached'});
      await expect(page.locator('#column-center .chat-info').filter({hasText: title})).toBeVisible();
      const peerId = await page.evaluate(() => window.appImManager.chat.peerId);
      assert(peerId < 0, 'The newly created channel opened');
      return -peerId;
    }
    async function assertCrossServerInfo(entry) {
      // Peer identity lookups cache omissions for five minutes. Reopen after reload
      // to verify persisted binding and the info panel with a fresh lookup.
      await page.reload();
      await page.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
      // The chats page can show a moment before the client mounts its chat manager.
      await page.waitForFunction(() => window.appImManager);
      await page.evaluate(chatId => window.appImManager.setPeer({peerId: -chatId}), entry.chatId);
      await page.locator('#column-center .chat-info').filter({hasText: entry.title}).click();
      const info = page.locator('#column-right .tabs-tab.active');
      // Reconciliation can promote the domain to the channel's public link;
      // either that link or the fallback Identity row names the same domain.
      await expect(info.locator('.row-title').filter({hasText: entry.domain}).first()).toBeVisible();
      await expect(info.getByText('Only people on dc.example.org can join', {exact: true})).toHaveCount(0);
      assert.equal((await verifyChatProfile(await readChatProfile(entry.chatId), entry.domain, entry.chatId)).id, entry.id);
      await page.evaluate(() => window.appSidebarRight.toggleSidebar(false));
    }

    await page.setViewportSize({width: 1280, height: 900});
    const createdTitle = 'Cross-server news';
    const createForm = await openNewChannel(createdTitle);
    await createForm.getByRole('checkbox', {name: 'Cross-server', exact: true}).press('Space');
    await createForm.getByLabel('Profile domain', {exact: true}).fill(chatDomains[0]);
    await createForm.getByRole('button', {name: 'Next', exact: true}).press('Enter');
    const createdChatIdentity = await completeChatIdentity(chatDomains[0], createdTitle, 'New Channel');
    assert.equal(await finishChannelCreation(createdTitle), createdChatIdentity.chatId);
    await assertCrossServerInfo(createdChatIdentity);

    const upgradedTitle = 'Initially home-only news';
    const ordinaryForm = await openNewChannel(upgradedTitle);
    await ordinaryForm.getByRole('button', {name: 'Next', exact: true}).press('Enter');
    const ordinaryId = await finishChannelCreation(upgradedTitle);
    await page.locator('#column-center .chat-info').filter({hasText: upgradedTitle}).click();
    await page.locator('#column-right').getByText('Only people on dc.example.org can join', {exact: true}).waitFor();
    await page.locator('#column-right .tabs-tab.active').getByRole('button', {name: 'Edit', exact: true}).press('Enter');
    const editForm = page.locator('#column-right .edit-group-container.active');
    const crossServer = editForm.getByRole('checkbox', {name: 'Cross-server', exact: true});
    await expect(crossServer).not.toBeChecked();
    await expect(editForm.getByRole('button', {name: 'Save', exact: true})).toHaveCount(0);
    await crossServer.press('Space');
    await editForm.getByLabel('Profile domain', {exact: true}).fill(chatDomains[1]);
    await expect(editForm.getByLabel('Channel name', {exact: true})).toHaveText(upgradedTitle);
    await expect(editForm.getByLabel('Description', {exact: true})).toHaveText('');
    // No title/about/photo edits: Teleblah binds, then returns CHAT_NOT_MODIFIED.
    await editForm.getByRole('button', {name: 'Save', exact: true}).press('Enter');
    const upgradedChatIdentity = await completeChatIdentity(chatDomains[1], upgradedTitle, 'Save');
    assert.equal(upgradedChatIdentity.chatId, ordinaryId);
    await editForm.waitFor({state: 'detached'});
    await assertCrossServerInfo(upgradedChatIdentity);
    const chatIdentities = [createdChatIdentity, upgradedChatIdentity];
    const signInIDs = await page.evaluate(async() => (await window.rootScope.managers.appAccountManager.blahIdentity({action: 'list'})).ids);
    assert.deepEqual(signInIDs, signInIDsBeforeChats, 'Creating chat custody leaves the sign-in candidates unchanged');
    for(const entry of chatIdentities) assert(!signInIDs.includes(entry.id), 'Chat custody never becomes a sign-in candidate');
    // Deletion uses the real dialog and a locked chat key; the worker must retry with its proof.
    const deletionInput = await page.evaluate(async(entry) => {
      await window.rootScope.managers.appAccountManager.blahIdentity({action: 'lock', id: entry.id});
      await window.appImManager.setPeer({peerId: -entry.chatId});
      return window.rootScope.managers.appChatsManager.getChannelInput(entry.chatId);
    }, createdChatIdentity);
    await page.locator('#column-center .chat-info').filter({hasText: createdTitle}).click();
    await page.locator('#column-right .tabs-tab.active').getByRole('button', {name: 'Edit', exact: true}).click();
    await page.locator('#column-right .edit-group-container.active').getByRole('button', {name: 'Delete Channel', exact: true}).click();
    const deletion = page.locator('.popup-delete-chat');
    await deletion.getByRole('checkbox').check();
    await deletion.getByRole('button', {name: /^delete channel$/i}).click();
    const unlock = page.getByRole('dialog', {name: 'Unlock chat identity', exact: true});
    await expect(unlock.getByLabel('Identity password', {exact: true})).toBeFocused();
    await unlock.getByLabel('Identity password', {exact: true}).fill('test chat identity password');
    await unlock.getByRole('button', {name: 'Unlock identity', exact: true}).press('Enter');
    await unlock.waitFor({state: 'detached'});
    await page.locator('#column-right .edit-group-container.active').waitFor({state: 'detached'});
    // An independent fresh RPC observes deletion on the DC (never the local dialogs cache).
    assert.equal(deletionInput._, 'inputChannel');
    const deleted = await page.evaluate(channel =>
      window.rootScope.managers.apiManager.invokeApi('channels.getChannels', {id: [channel]}), deletionInput);
    assert.deepEqual(deleted.chats, [], 'A fresh DC read confirms the cross-server channel is gone');

    // A separate account on the same home imports only the chat's paper device and claims it.
    const claimContext = await browser.newContext({ignoreHTTPSErrors: true});
    const claimant = await claimContext.newPage();
    claimant.setDefaultTimeout(30000);
    activePage = claimant;
    try {
      await claimContext.route('https://dc.example.org/.well-known/blah/profile.cbor', route => route.fulfill({
        contentType: 'application/cbor', body: Buffer.from(signedDC.profile)
      }));
      await claimant.goto(origin + '/?noServiceWorker=1&a11y=1');
      await claimant.getByRole('textbox', {name: 'DC domain'}).fill('dc.example.org');
      await claimant.getByRole('button', {name: 'Connect to Blah'}).click();
      const carolIdentity = await signUp(claimant, 1, 'carol.example.org', 'Carol', origin + '/publish/carol');
      await claimant.locator('#page-chats').waitFor({state: 'visible'});
      await claimant.locator('#auth-pages').waitFor({state: 'hidden'});
      const claimantID = await claimant.evaluate(() => window.rootScope.myId);
      assert.notEqual(claimantID, userId, 'Claim uses another account');
      await claimant.setViewportSize({width: 390, height: 844});
      await claimant.locator('.sidebar-tools-button').click();
      await claimant.getByRole('menuitem', {name: 'Identity Manager', exact: true}).click();
      const chatSection = claimant.locator('.tabs-tab.active .sidebar-left-section').filter({has: claimant.getByText('Chat identities', {exact: true})});
      await chatSection.getByRole('button', {name: 'Use paper key', exact: true}).click();
      const paper = claimant.getByRole('dialog', {name: 'Use paper key', exact: true});
      await paper.getByLabel('Profile domain', {exact: true}).fill(upgradedChatIdentity.domain);
      await paper.getByLabel('Paper key words', {exact: true}).fill(upgradedChatIdentity.paperPhrase);
      await paper.getByLabel('Identity password', {exact: true}).fill('claim paper password');
      await paper.getByRole('button', {name: 'Use paper key', exact: true}).press('Enter');
      await paper.waitFor({state: 'detached'});
      const details = claimant.locator('.tabs-tab.active').filter({has: claimant.getByRole('button', {name: 'Export public profile', exact: true})});
      await expect(details).toContainText('Join this chat with your current account before claiming ownership.');
      await expect(details.getByRole('button', {name: 'Claim ownership', exact: true})).toHaveCount(0);
      await claimant.evaluate(chatId => window.rootScope.managers.appChatsManager.joinChannel(chatId), upgradedChatIdentity.chatId);
      await claimant.keyboard.press('Escape');
      await details.waitFor({state: 'detached'});
      await chatSection.getByRole('button').filter({hasText: upgradedChatIdentity.domain}).press('Enter');
      const locked = claimant.locator('.tabs-tab.active').filter({has: claimant.getByRole('button', {name: 'Unlock identity', exact: true})});
      await locked.getByLabel('Identity password', {exact: true}).fill('claim paper password');
      await locked.getByRole('button', {name: 'Unlock identity', exact: true}).press('Enter');
      await details.getByRole('button', {name: 'Claim ownership', exact: true}).press('Enter');
      await claimant.getByRole('status').filter({hasText: 'Your account now owns this chat.'}).waitFor();
      await expect(details.getByRole('button', {name: 'Export public profile', exact: true})).toBeFocused();
      assert(await details.evaluate(element => element.getBoundingClientRect().right <= innerWidth + 1), 'Chat identity details fit narrow screens');
      assert.deepEqual((await new AxeBuilder({page: claimant}).include('.tabs-tab.active').disableRules(['color-contrast']).analyze()).violations, []);
      const ownership = await claimant.evaluate(async(entry) => {
        const managers = window.rootScope.managers;
        await managers.appChatsManager.getChannels([entry.chatId]);
        const chat = await managers.appChatsManager.getChat(entry.chatId);
        const identities = await managers.appAccountManager.blahIdentity({action: 'list'});
        const failure = async(action) => {
          try { await managers.appAccountManager.blahIdentity({action, id: entry.id, device: 'AAAA'}); }
          catch(error) { return error.message; }
        };
        return {creator: chat.pFlags.creator, ids: identities.ids,
          addPaper: await failure('addPaperKey'), addDevice: await failure('addDevice'), renew: await failure('renew')};
      }, upgradedChatIdentity);
      assert.equal(ownership.creator, true, 'Fresh channels.getChannels confirms the paper holder became creator');
      assert.deepEqual(ownership.ids, [carolIdentity], 'An imported chat paper key never appears for sign-in');
      assert.match(ownership.addPaper, /identity key/);
      assert(ownership.addDevice && ownership.renew, 'Device-only custody cannot enroll or renew');
    } finally {
      await claimContext.close();
      activePage = page;
      await page.bringToFront();
    }
    // Leave the original account viewing the surviving chat for the following settings checks.
    await page.evaluate(chatId => window.appImManager.setPeer({peerId: -chatId}), upgradedChatIdentity.chatId);
    await page.setViewportSize({width: 375, height: 720});

    // Settings renders the same peer info panel with self details enabled.
    await page.locator('#column-center .chat-info-container').getByRole('button', {name: 'Close', exact: true}).click();
    await page.locator('.sidebar-tools-button').click();
    await page.getByRole('menuitem', {name: 'Settings', exact: true}).click();
    const identityRow = page.getByRole('button', {name: 'alice.example.org Identity', exact: true});
    await identityRow.waitFor();
    await signupContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    for(const action of ['Enter', 'Space', 'click']) {
      if(action === 'click') await identityRow.click();
      else await identityRow.press(action);
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'alice.example.org');
    }
    await identityRow.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(identityRow).toBeFocused();
    await identityRow.evaluate(element => {
      element.id = 'blah-peer-identity-test';
      element.scrollIntoView({block: 'center'});
    });
    const previousTheme = await page.evaluate(() => window.useAppSettings()[0].theme);
    for(const theme of ['day', 'night', 'light', 'tinted']) {
      await page.evaluate(async(theme) => {
        await window.useAppSettings()[1]('increaseContrast', true);
        await window.themeController.switchTheme(theme);
      }, theme);
      await identityRow.evaluate(element => element.scrollIntoView({block: 'center'}));
      await identityRow.screenshot({path: process.env.BLAH_IDENTITY_SCREENSHOT && process.env.BLAH_IDENTITY_SCREENSHOT + '-peer-' + theme + '.png', animations: 'disabled'});
      assert.deepEqual((await new AxeBuilder({page}).include('#blah-peer-identity-test').analyze()).violations, []);
    }
    await page.evaluate(async(theme) => {
      await window.useAppSettings()[1]('increaseContrast', false);
      await window.themeController.switchTheme(theme);
    }, previousTheme);
    assert(await identityRow.evaluate(element => element.getBoundingClientRect().right <= innerWidth), 'Identity row fits a narrow viewport');
    if(process.env.BLAH_IDENTITY_SCREENSHOT) await identityRow.screenshot({path: process.env.BLAH_IDENTITY_SCREENSHOT + '-peer.png'});
    await page.keyboard.press('Escape');

    discoveryProfile = signedDC.rotatedProfile;
    const refreshed = await signupContext.newPage();
    await refreshed.goto(origin + '/?debug=1&noServiceWorker=1&a11y=1');
    await refreshed.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
    // The original tab is still alive: the refreshed tab must not attach to its stale worker.
    assert(connectedPaths.has('/rotated/ws?route=home'));
    await refreshed.close();
    await page.reload();
    await page.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('account1') || '{}').userId);
    // The normal add-account URL must offer a fresh home step, not inherit DC1.
    const otherPage = await signupContext.newPage();
    activePage = otherPage;
    await otherPage.goto(origin + '/?account=2&debug=1&noServiceWorker=1&a11y=1');
    const otherInput = otherPage.getByRole('textbox', {name: 'DC domain'});
    await otherInput.waitFor();
    assert.equal(await otherInput.inputValue(), '');
    await otherPage.getByRole('button', {name: 'Back', exact: true}).click();
    await otherPage.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
    await otherPage.goto(origin + '/?account=2&debug=1&noServiceWorker=1&a11y=1');
    await otherInput.fill('other.example.org');
    await otherPage.getByRole('button', {name: 'Connect to Blah'}).click();
    const accountPicker = otherPage.getByRole('combobox', {name: 'Saved identity', exact: true});
    await accountPicker.fill('alice.example.org');
    const accountOptions = otherPage.getByRole('listbox', {name: 'Saved identity'}).getByRole('option');
    const expectAccountOptions = async(labels) => {
      await expect(accountOptions).toHaveCount(labels.length);
      for(const [index, label] of labels.entries()) await expect(accountOptions.nth(index)).toHaveAccessibleName(label);
    };
    await expectAccountOptions([
      'alice.example.org - ' + aliceIdentity.slice(0, 6), 'Create identity', 'Import identity from file', 'Sign in with paper key'
    ]);
    for(const entry of chatIdentities) {
      await accountPicker.fill(entry.domain);
      await expectAccountOptions(['Create identity', 'Import identity from file', 'Sign in with paper key']);
    }
    await signUp(otherPage, 2, 'bob.example.org', 'Bob', origin + '/publish/bob');
    const accounts = await otherPage.evaluate(() => [1, 2].map(slot => JSON.parse(localStorage.getItem('account' + slot))));
    assert.equal(accounts[0].userId, userId);
    assert.equal(accounts[1].userId, userId, 'Equal local IDs on different homes must remain separate accounts');
    assert.notEqual(accounts[0].dc1_auth_key, accounts[1].dc1_auth_key);
    assert(connectedPaths.has('/other/ws?route=home'));
    await otherPage.reload();
    await otherPage.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
    assert.equal(await otherPage.evaluate(() => window.rootScope.myId), accounts[1].userId);
    await otherPage.close();
    activePage = page;
    await page.bringToFront();
    await page.reload();
    await page.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
    assert.equal(await page.evaluate(() => window.rootScope.myId), userId);
    await page.waitForFunction(() => document.body.classList.contains('is-left-column-shown') && !document.body.classList.contains('has-auth-pages'));
    // Restore this same browser identity into a fresh transport/database origin context.
    // Identity Manager is an ordinary settings tab, reached below the accounts.
    assert.equal(await page.locator('body > button').filter({hasText: 'Identity Manager'}).count(), 0);
    await page.locator('.sidebar-tools-button').click();
    await page.getByRole('menuitem', {name: 'Identity Manager', exact: true}).click();
    const panel = page.locator('.tabs-tab.active').filter({has: page.getByText('Saved identities', {exact: true})});
    await panel.waitFor();
    assert.equal(await panel.getByRole('combobox').count(), 0);
    const chatSection = panel.locator('.sidebar-left-section').filter({has: page.getByText('Chat identities', {exact: true})});
    await expect(chatSection.getByRole('button')).toHaveCount(4);
    const userSection = panel.locator('.sidebar-left-section').filter({has: page.getByText('Saved identities', {exact: true})});
    for(const entry of chatIdentities) {
      await expect(chatSection.getByRole('button', {name: entry.title + ' ' + entry.domain, exact: true})).toBeVisible();
      await expect(userSection.getByText(entry.domain, {exact: true})).toHaveCount(0);
    }
    const opener = panel.getByRole('button', {name: 'Import identity from file', exact: true}).last();
    await opener.press('Enter');
    const dialog = page.getByRole('dialog', {name: 'Import identity from file'});
    await dialog.waitFor();
    await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement));
    await page.keyboard.press('Shift+Tab');
    assert(await dialog.evaluate(element => element.contains(document.activeElement)), 'Dialog must contain focus');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    await dialog.waitFor({state: 'detached'});
    assert(await opener.evaluate(element => element === document.activeElement), 'Restore opener focus');
    await opener.press('Enter');
    await dialog.waitFor();
    assert.equal(await dialog.locator('.drop-outline-wrapper').count(), 0);
    assert.equal(await dialog.locator('.drop').evaluate(element => getComputedStyle(element).boxShadow), 'none');
    assert.equal(await dialog.locator('.drop').evaluate(element => getComputedStyle(element).borderTopStyle), 'dashed');
    const footnote = dialog.getByText('Your keys are never uploaded.', {exact: false});
    assert.equal(await footnote.evaluate(element => getComputedStyle(element).textAlign), 'center');
    const fileBounds = await dialog.locator('.drop').boundingBox();
    const passwordBounds = await dialog.getByLabel('Identity password', {exact: true}).boundingBox();
    assert(fileBounds.y + fileBounds.height <= passwordBounds.y, 'File selection precedes password entry');
    const submitBounds = await dialog.getByRole('button', {name: 'Import identity from file', exact: true}).boundingBox();
    const footnoteBounds = await footnote.boundingBox();
    assert(submitBounds.y + submitBounds.height <= footnoteBounds.y, 'Custody footnote follows the main button');
    // Shared controls use the theme palette; check contrast in increased-contrast mode.
    await page.evaluate(async() => { await window.useAppSettings()[1]('increaseContrast', true); window.themeController.setTheme(); });
    // Finish popup and theme transitions before measuring text contrast.
    await dialog.screenshot({path: process.env.BLAH_IDENTITY_SCREENSHOT, animations: 'disabled'});
    const accessibility = await new AxeBuilder({page}).include('[role="dialog"]').analyze();
    assert.deepEqual(accessibility.violations.map(({id, nodes}) => ({id, targets: nodes.map(n => n.target)})), []);
    await page.evaluate(async() => { await window.useAppSettings()[1]('increaseContrast', false); window.themeController.setTheme(); });
    await page.setViewportSize({width: 390, height: 844});
    assert(await dialog.evaluate(element => element.getBoundingClientRect().right <= innerWidth), 'Dialog fits narrow screens');
    await page.keyboard.press('Escape');
    await dialog.waitFor({state: 'detached'});
    if(process.env.BLAH_IDENTITY_SCREENSHOT) await panel.screenshot({path: process.env.BLAH_IDENTITY_SCREENSHOT + '-list.png', animations: 'disabled'});
    const savedIdentity = panel.getByRole('button').filter({hasText: aliceIdentity});
    await savedIdentity.press('Enter');
    const nested = page.locator('.tabs-tab.active').filter({has: page.getByRole('button', {name: 'Unlock identity', exact: true})});
    await expect(nested.getByLabel('Identity password', {exact: true})).toBeFocused();
    if(process.env.BLAH_IDENTITY_SCREENSHOT) await nested.screenshot({path: process.env.BLAH_IDENTITY_SCREENSHOT + '-locked.png', animations: 'disabled'});
    await nested.getByLabel('Identity password', {exact: true}).fill('test identity password');
    await nested.getByRole('button', {name: 'Unlock identity', exact: true}).press('Enter');
    assert.equal(await panel.getByRole('button', {name: 'Identity details', exact: true}).count(), 0);
    const identityDetails = page.locator('.tabs-tab.active').filter({has: page.getByRole('button', {name: 'Export public profile', exact: true})});
    await identityDetails.getByRole('button', {name: 'Export public profile', exact: true}).waitFor();
    await page.keyboard.press('Escape');
    await identityDetails.waitFor({state: 'detached'});
    await panel.waitFor({state: 'visible'});
    await expect(savedIdentity).toBeFocused();
    await assert.rejects(() => page.evaluate(() => window.rootScope.managers.appAccountManager.blahIdentity({action: 'inspect'})));
    await savedIdentity.press('Enter');
    await nested.getByLabel('Identity password', {exact: true}).fill('test identity password');
    await nested.getByRole('button', {name: 'Unlock identity', exact: true}).press('Enter');
    await identityDetails.getByRole('button', {name: 'Export public profile', exact: true}).waitFor();
    await expect.poll(() => identityDetails.evaluate(element => element.getBoundingClientRect().right <= innerWidth + 1)).toBe(true);
    if(process.env.BLAH_IDENTITY_SCREENSHOT) await identityDetails.screenshot({path: process.env.BLAH_IDENTITY_SCREENSHOT + '-settings.png', animations: 'disabled'});
    const authorize = identityDetails.getByRole('button', {name: 'Authorize new device', exact: true});
    for(const device of [signedDC.devices[0], otherDC.devices[0]]) {
      await authorize.click();
      const enrollment = page.getByRole('dialog', {name: 'Authorize new device', exact: true});
      const deviceKey = Buffer.from(device.key).toString('base64');
      await enrollment.getByLabel('Public device key (base64)', {exact: true}).fill(deviceKey);
      assert.deepEqual((await new AxeBuilder({page}).include('[role="dialog"]').disableRules(['color-contrast']).analyze()).violations, []);
      await enrollment.getByRole('button', {name: 'Authorize new device', exact: true}).press('Enter');
      await enrollment.waitFor({state: 'detached'});
    }
    const deviceRows = identityDetails.locator('.session-row');
    await expect(deviceRows).toHaveCount(3);
    await deviceRows.last().press('Enter');
    const deviceDialog = page.getByRole('dialog', {name: 'Device details', exact: true});
    await deviceDialog.getByRole('button', {name: 'Terminate', exact: true}).click();
    await page.locator('.popup-confirmation').getByRole('button', {name: 'Terminate', exact: true}).click();
    await deviceDialog.waitFor({state: 'detached'});
    await expect(deviceRows).toHaveCount(2);
    await identityDetails.getByRole('button', {name: 'Terminate other devices', exact: true}).click();
    await page.locator('.popup-confirmation').getByRole('button', {name: 'Terminate', exact: true}).click();
    await expect(deviceRows).toHaveCount(1);
    assert.equal(await deviceRows.first().locator('.row-title').innerText(), 'This browser');
    assert.deepEqual((await new AxeBuilder({page}).include('.tabs-tab.active').disableRules(['color-contrast']).analyze()).violations, []);
    // A paper key is a device written down as words: shown once and listed with the others.
    await identityDetails.getByRole('button', {name: 'Add paper key', exact: true}).click();
    await page.locator('.popup-confirmation').getByRole('button', {name: 'Add paper key', exact: true}).click();
    const paperDialog = page.getByRole('dialog', {name: 'Paper key', exact: true});
    await paperDialog.locator('ol li').first().waitFor();
    const paperWords = await paperDialog.locator('ol li').allInnerTexts();
    assert.equal(paperWords.length, 24);
    assert.deepEqual((await new AxeBuilder({page}).include('[role="dialog"]').disableRules(['color-contrast']).analyze()).violations, []);
    if(process.env.BLAH_IDENTITY_SCREENSHOT) await paperDialog.screenshot({path: process.env.BLAH_IDENTITY_SCREENSHOT + '-paper.png', animations: 'disabled'});
    await paperDialog.getByRole('button', {name: 'I wrote it down', exact: true}).click();
    await paperDialog.waitFor({state: 'detached'});
    await expect(deviceRows).toHaveCount(2);
    const backupFile = dir + '/identity.cbor';
    await downloadFile(page.getByRole('button', {
      name: 'Export identity file',
      exact: true
    }), backupFile);
    await page.keyboard.press('Escape');
    await identityDetails.waitFor({state: 'detached'});
    const context = await browser.newContext({
      ignoreHTTPSErrors: true
    });
    const restored = await context.newPage();
    activePage = restored;
    restored.setDefaultTimeout(30000);
    restored.on('console', m => {
      if(m.type() === 'error') diagnostics.push(m.text().slice(0, 350));
    });
    await context.route('https://dc.example.org/.well-known/blah/profile.cbor', route => route.fulfill({
      contentType: 'application/cbor', body: Buffer.from(signedDC.profile)
    }));
    await restored.goto(origin + '/?noServiceWorker=1&a11y=1&pfs=1');
    await restored.getByRole('textbox', {name: 'DC domain'}).fill('dc.example.org');
    await restored.getByRole('button', {name: 'Connect to Blah'}).click();
    const savedPicker = restored.getByRole('combobox', {name: 'Saved identity', exact: true});
    await savedPicker.fill('import');
    await restored.getByRole('option', {name: 'Import identity from file', exact: true}).click();
    assert.equal(await restored.getByRole('dialog').getByLabel('Profile domain', {exact: true}).count(), 0);
    const fileDropzone = restored.getByRole('dialog').getByRole('button', {name: /^Identity file/});
    const invalidFile = {name: 'invalid.cbor', mimeType: 'application/cbor', buffer: Buffer.from('invalid identity file')};
    for(const activate of [() => fileDropzone.click(), () => fileDropzone.press('Space')]) {
      const chooser = restored.waitForEvent('filechooser');
      await activate();
      await (await chooser).setFiles(invalidFile);
    }
    const importButton = restored.getByRole('dialog').getByRole('button', {name: 'Import identity from file', exact: true});
    assert(await importButton.isDisabled(), 'Import requires a password');
    // Supplying a password must not start import until explicitly submitted.
    await restored.getByRole('dialog').getByRole('status').filter({hasText: /^invalid.cbor$/}).waitFor();
    await restored.getByRole('dialog').getByLabel('Identity password', {exact: true}).fill('test identity password');
    await restored.waitForTimeout(800);
    assert.equal(await restored.getByRole('dialog').getByRole('status').filter({hasText: /invalidProfile|invalidEncoding/i}).count(), 0);
    await importButton.click();
    await restored.getByRole('dialog').getByRole('status').filter({hasText: /invalidProfile|invalidEncoding/i}).waitFor();
    // Replacing the failed file also waits for explicit submission.
    const transfer = await restored.evaluateHandle((contents) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(contents)], 'identity.cbor', {type: 'application/cbor'}));
      return data;
    }, Array.from(await readFile(backupFile)));
    await restored.getByRole('dialog').locator('.drop').dispatchEvent('drop', {dataTransfer: transfer});
    await transfer.dispose();
    await restored.waitForTimeout(800);
    assert(await importButton.isVisible(), 'Picking a file must not start import');
    await importButton.press('Enter');
    await restored.getByRole('dialog').waitFor({state: 'detached'});
    await restored.getByRole('button', {name: 'Identity details', exact: true}).waitFor();
    // Reload to require unlocking the saved identity, then sign in with one action.
    await restored.reload();
    await savedPicker.fill('alice.example.org');
    await restored.getByRole('option', {name: 'alice.example.org - ' + aliceIdentity.slice(0, 6), exact: true}).waitFor();
    await savedPicker.press('ArrowDown');
    await savedPicker.press('Enter');
    assert.equal(await restored.getByRole('button', {name: 'Unlock identity', exact: true}).count(), 0);
    const password = restored.getByLabel('Identity password', {exact: true});
    await password.fill('wrong identity password');
    await restored.getByRole('button', {name: 'Sign in to Blah', exact: true}).click();
    await restored.getByRole('region', {name: 'Identity Manager'}).getByRole('status')
      .filter({hasText: /.+/}).filter({hasNotText: 'Working…'}).waitFor();
    assert.equal(await password.inputValue(), 'wrong identity password');
    await password.fill('test identity password');
    await password.press('Enter');
    await restored.waitForFunction(() => JSON.parse(localStorage.getItem('account1') || '{}').userId);
    const restoredId = await restored.evaluate(() => JSON.parse(localStorage.getItem('account1')).userId);
    if(userId !== restoredId) throw new Error('Recovery changed the account');
    await context.close();
    // A fresh browser signs in to the same account from the paper key's words alone.
    const paperContext = await browser.newContext({ignoreHTTPSErrors: true});
    const paperPage = await paperContext.newPage();
    activePage = paperPage;
    paperPage.setDefaultTimeout(30000);
    await paperContext.route('https://dc.example.org/.well-known/blah/profile.cbor', route => route.fulfill({
      contentType: 'application/cbor', body: Buffer.from(signedDC.profile)
    }));
    await paperPage.goto(origin + '/?noServiceWorker=1&a11y=1');
    await paperPage.getByRole('textbox', {name: 'DC domain'}).fill('dc.example.org');
    await paperPage.getByRole('button', {name: 'Connect to Blah'}).click();
    await paperPage.getByRole('combobox', {name: 'Saved identity', exact: true}).fill('paper');
    await paperPage.getByRole('option', {name: 'Sign in with paper key', exact: true}).click();
    const paperSignIn = paperPage.getByRole('dialog', {name: 'Sign in with paper key', exact: true});
    await paperSignIn.getByLabel('Profile domain', {exact: true}).fill('alice.example.org');
    await paperSignIn.getByLabel('Paper key words', {exact: true}).fill(paperWords.join(' ').toUpperCase());
    await paperSignIn.getByLabel('Identity password', {exact: true}).fill('paper identity password');
    assert.deepEqual((await new AxeBuilder({page: paperPage}).include('[role="dialog"]').disableRules(['color-contrast']).analyze()).violations, []);
    if(process.env.BLAH_IDENTITY_SCREENSHOT) await paperSignIn.screenshot({path: process.env.BLAH_IDENTITY_SCREENSHOT + '-paper-sign-in.png', animations: 'disabled'});
    await paperSignIn.getByRole('button', {name: 'Sign in with paper key', exact: true}).click();
    await paperSignIn.waitFor({state: 'detached'});
    // Focus returns to the picker, which opens its list over the sign-in button.
    const paperOptions = paperPage.getByRole('listbox', {name: 'Saved identity'});
    if(await paperOptions.isVisible()) {
      await paperPage.keyboard.press('Escape');
      await paperOptions.waitFor({state: 'hidden'});
    }
    await paperPage.getByRole('button', {name: 'Sign in to Blah', exact: true}).click();
    await paperPage.waitForFunction(() => JSON.parse(localStorage.getItem('account1') || '{}').userId);
    assert.equal(await paperPage.evaluate(() => JSON.parse(localStorage.getItem('account1')).userId), userId, 'A paper key signs in to the same account');
    await paperContext.close();
    // Logging out the first account shifts the second account's caches and home together.
    activePage = page;
    await page.bringToFront();
    // Refresh one home after both accounts exist, leaving the original tab on
    // the previous worker. A logout from either worker must reload both tabs.
    const oldWorkerPage = await signupContext.newPage();
    await oldWorkerPage.goto(origin + '/?debug=1&noServiceWorker=1&a11y=1');
    await oldWorkerPage.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
    discoveryProfile = signedDC.nextProfile;
    await page.reload();
    await page.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
    const reloaded = page.waitForEvent('load');
    const oldWorkerReloaded = oldWorkerPage.waitForEvent('load');
    await page.evaluate(() => { void window.rootScope.managers.apiManager.logOut(); });
    await Promise.all([reloaded, oldWorkerReloaded]);
    await oldWorkerPage.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
    assert.equal(await oldWorkerPage.evaluate(() => JSON.parse(localStorage.getItem('account1')).dc1_auth_key), accounts[1].dc1_auth_key);
    await oldWorkerPage.close();
    await page.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
    const remaining = await page.evaluate(() => JSON.parse(localStorage.getItem('account1')));
    assert.equal(remaining.dc1_auth_key, accounts[1].dc1_auth_key);
    await page.goto(origin + '/?account=2&debug=1&noServiceWorker=1&a11y=1');
    await page.getByRole('textbox', {name: 'DC domain'}).waitFor();
    assert.equal(await page.getByRole('textbox', {name: 'DC domain'}).inputValue(), '');
    console.log('PASS per-account DC sign-in, two-home account switching/reload/logout, exact signed WebSocket URLs, full browser signup, Cross-server creation and toggle-only upgrade, locked-identity UI deletion, paper-key ownership claim by a second account, numbered channel profiles, chat custody/sign-in separation, verified peer identity row and home-only notice, service-account answers after the sent result, reconnection after a DC restart and a reload while it was down, profile publication, reload, recovered identity and paper-key login, dialog keyboard/focus and Axe checks.');
    }
  } catch(error) {
    if(process.env.BLAH_IDENTITY_SCREENSHOT) await activePage.screenshot({path: process.env.BLAH_IDENTITY_SCREENSHOT + '-failure.png', timeout: 3000}).catch(() => {});
    console.error(error);
    console.error((await activePage.locator('body').innerText({timeout: 2000}).catch(() => 'Page unavailable')).slice(-7000));
    console.error(diagnostics.slice(-15));
    console.error(logs.slice(-3000));
    throw error;
  }
} finally {
  await browser?.close();
  proxy.close();
  edge?.closeAllConnections();
  if(edge) edge.close();
  await Promise.all([child, otherChild].filter(Boolean).map(stopServer));
  await rm(dir, {
    recursive: true,
    force: true
  });
}
