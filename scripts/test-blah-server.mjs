// Real tweb UI/worker -> TLS WebSocket -> a throwaway Teleblah DC. No production services.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {openSync} from 'node:fs';
import {createServer} from 'node:https';
import {createServer as tcpServer} from 'node:net';
import {mkdtemp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {spawn, execFileSync} from 'node:child_process';
import {generateKeyPairSync, createHash} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {cbor} from '../tests/blah/cbor.mjs';
import {checkIdentityLayout} from '../tests/blah/identityLayout.mjs';
const repo = fileURLToPath(new URL('../', import.meta.url));
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
  const startDC = (domain, port, web, seedFile) => {
    const server = spawn(tele + '/.build/debug/BlahMTProtoServer', ['--port', String(port), '--web-port', String(web),
      '--data-db', dir + '/' + domain + '-data.sqlite', '--auth-db', dir + '/' + domain + '-auth.sqlite',
      '--jobs-db', dir + '/' + domain + '-jobs.sqlite', '--federation-domain', domain,
      '--federation-key-file', seedFile, '--federation-key-algorithm', 'ed25519',
      '--local-config-file', dir + '/local.json', '--test-profile-directory', dir + '/profiles'], {
      cwd: tele, stdio: ['ignore', 'ignore', 'pipe']
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
  edge = createServer({
    key: await readFile(dir + '/tls.key'),
    cert: await readFile(dir + '/tls.crt')
  }, async(req, res) => {
    try {
      const path = new URL(req.url, 'https://localhost').pathname;
      if(req.method === 'PUT' && (path === '/publish' || path === '/publish/bob')) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        await writeFile(dir + '/profiles/' + (path.endsWith('/bob') ? 'bob' : 'alice') + '.example.org.cbor', Buffer.concat(chunks));
        res.end('ok');
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
    proxy.ws(req, socket, head, {target: 'ws://127.0.0.1:' + (req.url.startsWith('/other/') ? otherPort : port)});
  });
  proxy.on('error', () => {});
  edge.listen(0, '127.0.0.1');
  await once(edge, 'listening');
  const tlsPort = edge.address().port,
    origin = 'https://127.0.0.1:' + tlsPort;
  const rsa = JSON.parse(await readFile(tele + '/Schemas/blah-rsa-key.json', 'utf8'));
  execFileSync(repo + '/node_modules/.bin/vite', ['build', '--mode', 'blah'], {
    cwd: repo,
    env: {
      ...process.env,
      BLAH_BOOTSTRAP_FILE: '',
      BLAH_SERVER_CONFIG_URL: '',
      BLAH_API_ID: '12345',
      BLAH_API_HASH: '0123456789abcdef0123456789abcdef'
    },
    stdio: ['ignore', openSync(dir + '/build.log', 'w'), openSync(dir + '/build-errors.log', 'w')]
  });
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BLAH_BROWSER_EXECUTABLE,
    // SharedWorker requests do not inherit a Playwright context's ignoreHTTPSErrors.
    args: ['--no-sandbox', '--ignore-certificate-errors']
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
  await page.goto(origin + '/?debug=1&noServiceWorker=1&a11y=1');
  const makeDCProfile = async({data, rotatedData, identityKey}) => {
    const {createDiem} = await import('/assets/blah/diem.js');
    const diem = await createDiem(new URL('/assets/blah/diem.wasm', location.href));
    const identity = await crypto.subtle.importKey('jwk', identityKey, 'Ed25519', true, ['sign']);
    const device = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const publicKeys = {identity: Uint8Array.from(atob(identityKey.x.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
      device: new Uint8Array(await crypto.subtle.exportKey('raw', device.publicKey))};
    const backend = {
      random: length => crypto.getRandomValues(new Uint8Array(length)),
      publicKey: role => publicKeys[role],
      sign: async(role, bytes) => new Uint8Array(await crypto.subtle.sign('Ed25519', role === 'identity' ? identity : device.privateKey, new Uint8Array(bytes))),
      verify: async(key, bytes, signature) => crypto.subtle.verify('Ed25519',
        await crypto.subtle.importKey('raw', new Uint8Array(key), 'Ed25519', false, ['verify']), new Uint8Array(signature), new Uint8Array(bytes))
    };
    const current = await diem.dcSetup({data, profile: null, now: Math.floor(Date.now() / 1000)}, backend);
    const rotated = await diem.dcSetup({data: rotatedData, profile: current.profile, now: Math.floor(Date.now() / 1000)}, backend);
    const next = await diem.dcSetup({data: rotatedData, profile: rotated.profile, now: Math.floor(Date.now() / 1000)}, backend);
    return {...current, rotatedProfile: rotated.profile, nextProfile: next.profile};
  };
  const signedDC = await page.evaluate(makeDCProfile, {data: cbor({0: 13, 1: 1, 2: 5, 3: ['dc.example.org'], 4: [{0: '127.0.0.1', 1: tlsPort, 2: true, 3: 1, 4: '/discovered/ws?route=home'}], 5: [], 6: rsa.pkcs1Pem, 7: 1}),
    rotatedData: cbor({0: 13, 1: 1, 2: 5, 3: ['dc.example.org'], 4: [{0: '127.0.0.1', 1: tlsPort, 2: true, 3: 1, 4: '/rotated/ws?route=home'}], 5: [], 6: rsa.pkcs1Pem, 7: 1}),
    identityKey: privateKey.export({format: 'jwk'})});
  assert.equal(signedDC.id, id);
  const otherData = cbor({0: 13, 1: 1, 2: 5, 3: ['other.example.org'], 4: [{0: '127.0.0.1', 1: tlsPort, 2: true, 3: 1, 4: '/other/ws?route=home'}], 5: [], 6: rsa.pkcs1Pem, 7: 1});
  const otherDC = await page.evaluate(makeDCProfile, {data: otherData, rotatedData: otherData, identityKey: otherKey});
  await signupContext.route('https://other.example.org/.well-known/blah/profile.cbor', route => route.fulfill({
    contentType: 'application/cbor', body: Buffer.from(otherDC.profile)
  }));
  let discoveryProfile = signedDC.profile;
  await signupContext.route('https://dc.example.org/.well-known/blah/profile.cbor', route => route.fulfill({
    contentType: 'application/cbor', body: Buffer.from(discoveryProfile)
  }));
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
    const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('account1')).userId);
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
    const opener = panel.getByRole('button', {name: 'Import identity from file', exact: true});
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
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', {
      name: 'Export identity file',
      exact: true
    }).click();
    const download = await downloadPromise;
    const backupFile = dir + '/identity.json';
    await download.saveAs(backupFile);
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
    const invalidFile = {name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('invalid identity file')};
    for(const activate of [() => fileDropzone.click(), () => fileDropzone.press('Space')]) {
      const chooser = restored.waitForEvent('filechooser');
      await activate();
      await (await chooser).setFiles(invalidFile);
    }
    const importButton = restored.getByRole('dialog').getByRole('button', {name: 'Import identity from file', exact: true});
    assert(await importButton.isDisabled(), 'Import requires a password');
    // Supplying a password must not start import until explicitly submitted.
    await restored.getByRole('dialog').getByRole('status').filter({hasText: /^invalid.json$/}).waitFor();
    await restored.getByRole('dialog').getByLabel('Identity password', {exact: true}).fill('test identity password');
    await restored.waitForTimeout(800);
    assert.equal(await restored.getByRole('dialog').getByRole('status').filter({hasText: /Unexpected token/i}).count(), 0);
    await importButton.click();
    await restored.getByRole('dialog').getByRole('status').filter({hasText: /Unexpected token/i}).waitFor();
    // Replacing the failed file also waits for explicit submission.
    const transfer = await restored.evaluateHandle((contents) => {
      const data = new DataTransfer();
      data.items.add(new File([contents], 'identity.json', {type: 'application/json'}));
      return data;
    }, await readFile(backupFile, 'utf8'));
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
    console.log('PASS per-account DC sign-in, two-home account switching/reload/logout, exact signed WebSocket URLs, full browser signup, profile publication, reload, recovered identity login over PFS, dialog keyboard/focus and Axe checks.');
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
  await Promise.all([child, otherChild].filter(Boolean).map(async(server) => {
    server.kill('SIGTERM');
    const stopTimer = setTimeout(() => server.kill('SIGKILL'), 5000);
    if(server.exitCode === null) await once(server, 'exit');
    clearTimeout(stopTimer);
  }));
  await rm(dir, {
    recursive: true,
    force: true
  });
}
