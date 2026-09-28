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
const repo = fileURLToPath(new URL('../', import.meta.url));
const tele = process.env.BLAH_SERVER_REPO;
if(!tele) throw new Error('Set BLAH_SERVER_REPO to a Teleblah checkout with a built debug server.');
const require = createRequire(repo + '/package.json');
const {
  chromium
} = require('@playwright/test');
const proxy = require('http-proxy').createProxyServer({
  ws: true
});
const dir = await mkdtemp(process.env.TMPDIR ? process.env.TMPDIR + '/tweb-e2e-' : '/tmp/tweb-e2e-');
let child,
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
    web = await free();
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
  const key = Buffer.concat([Buffer.from([0x85, 0x68]), Buffer.from('Diem/key'), Buffer.from([3, 1, 1, 0x58, 0x20]), raw]);
  const id = createHash('sha256').update(key).digest('hex');
  await writeFile(dir + '/local.json', JSON.stringify({
    options: {},
    requiresSignupEmailCode: false,
    requiresSignInEmailCode: false
  }));
  child = spawn(tele + '/.build/debug/BlahMTProtoServer', ['--port', String(port), '--web-port', String(web), '--data-db', dir + '/data.sqlite', '--auth-db', dir + '/auth.sqlite', '--jobs-db', dir + '/jobs.sqlite', '--federation-domain', 'dc.example.org', '--federation-key-file', dir + '/seed', '--federation-key-algorithm', 'ed25519', '--local-config-file', dir + '/local.json', '--test-profile-directory', dir + '/profiles'], {
    cwd: tele,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr.on('data', c => logs += c);
  await new Promise(r => setTimeout(r, 2000));
  if(child.exitCode !== null) throw Error('Server exited: ' + logs);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', dir + '/tls.key', '-out', dir + '/tls.crt', '-days', '1', '-subj', '/CN=localhost'], {
    stdio: 'ignore'
  });
  edge = createServer({
    key: await readFile(dir + '/tls.key'),
    cert: await readFile(dir + '/tls.crt')
  }, async(req, res) => {
    try {
      const path = new URL(req.url, 'https://localhost').pathname;
      if(req.method === 'PUT' && path === '/publish') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        await writeFile(dir + '/profiles/alice.example.org.cbor', Buffer.concat(chunks));
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
    assert(['/discovered/ws?route=home', '/rotated/ws?route=home'].includes(req.url));
    connectedPaths.add(req.url);
    proxy.ws(req, socket, head, {target: 'ws://127.0.0.1:' + port});
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
  const page = await signupContext.newPage();
  let activePage = page;
  page.setDefaultTimeout(15000);
  const diagnostics = [];
  page.on('pageerror', e => diagnostics.push(e.message));
  page.on('console', m => {
    if(m.type() === 'error') diagnostics.push(m.text().slice(0, 350));
  });
  await page.goto(origin + '/?debug=1&noServiceWorker=1');
  const signedDC = await page.evaluate(async({data, rotatedData, identityKey}) => {
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
    return {...current, rotatedProfile: rotated.profile};
  }, {data: cbor([13, 1, 5, ['dc.example.org'], [['127.0.0.1', tlsPort, true, 1, '/discovered/ws?route=home']], [], rsa.pkcs1Pem, 1]),
    rotatedData: cbor([13, 1, 5, ['dc.example.org'], [['127.0.0.1', tlsPort, true, 1, '/rotated/ws?route=home']], [], rsa.pkcs1Pem, 1]),
    identityKey: privateKey.export({format: 'jwk'})});
  assert.equal(signedDC.id, id);
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
  assert.equal(await page.evaluate(() => document.querySelector('.blah-dc-setup').scrollWidth <= innerWidth), true);
  await domainInput.fill('dc.example.org');
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', {name: 'Connect to Blah'}).evaluate(node => node === document.activeElement), true);
  assert.deepEqual((await new AxeBuilder({page}).include('.blah-dc-setup').analyze()).violations, []);
  await page.keyboard.press('Enter');
  try {
    await page.getByText('Create or restore an identity', {
      exact: true
    }).click({
      timeout: 30000
    });
    await page.getByLabel('Identity password', {
      exact: true
    }).fill('test identity password');
    await page.getByLabel('Profile domain', {
      exact: true
    }).fill('alice.example.org');
    await page.getByRole('button', {
      name: 'Create identity',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Download public profile',
      exact: true
    }).waitFor({
      timeout: 30000
    });
    await page.getByText('Profile publishing', {
      exact: true
    }).click();
    await page.getByLabel('Publication URL', {
      exact: true
    }).fill(origin + '/publish');
    await page.getByRole('button', {
      name: 'Save and publish profile',
      exact: true
    }).click();
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    await page.getByRole('button', {
      name: 'Sign in to Blah',
      exact: true
    }).click();
    await page.locator('[contenteditable=true]').first().fill('Alice', {
      timeout: 30000
    });
    await page.getByRole('button', {
      name: /Start messaging/i
    }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('account1') || '{}').userId, {
      timeout: 30000
    });
    const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('account1')).userId);
    discoveryProfile = signedDC.rotatedProfile;
    const refreshed = await signupContext.newPage();
    await refreshed.goto(origin + '/?debug=1&noServiceWorker=1');
    await refreshed.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
    // The original tab is still alive: the refreshed tab must not attach to its stale worker.
    assert(connectedPaths.has('/rotated/ws?route=home'));
    await refreshed.close();
    await page.reload();
    await page.locator('#page-chats').waitFor({state: 'visible', timeout: 30000});
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('account1') || '{}').userId);
    // Restore this same browser identity into a fresh transport/database origin context.
    const opener = page.getByRole('button', {
      name: 'Browser identity',
      exact: true
    });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {
      name: 'Manage Blah identities'
    });
    await dialog.waitFor();
    assert(await dialog.evaluate(element => element.contains(document.activeElement)), 'Dialog must receive focus');
    await page.keyboard.press('Shift+Tab');
    assert(await dialog.evaluate(element => element.contains(document.activeElement)), 'Dialog must contain focus');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    await dialog.waitFor({
      state: 'detached'
    });
    assert(await opener.evaluate(element => element === document.activeElement), 'Restore opener focus');
    await page.keyboard.press('Space');
    await dialog.waitFor();
    const accessibility = await new AxeBuilder({
      page
    }).include('dialog').analyze();
    assert.deepEqual(accessibility.violations.map(({
      id,
      nodes
    }) => ({
      id,
      targets: nodes.map(n => n.target)
    })), []);
    await page.setViewportSize({
      width: 390,
      height: 844
    });
    assert(await dialog.evaluate(element => element.getBoundingClientRect().right <= innerWidth), 'Dialog fits narrow screens');
    await page.getByLabel('Saved identity', {
      exact: true
    }).selectOption({
      index: 1
    });
    await page.getByLabel('Identity password', {
      exact: true
    }).fill('test identity password');
    await page.getByRole('button', {
      name: 'Unlock identity',
      exact: true
    }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', {
      name: 'Download encrypted backup',
      exact: true
    }).click();
    const download = await downloadPromise;
    const backupFile = dir + '/identity.json';
    await download.saveAs(backupFile);
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
    await restored.goto(origin + '/?noServiceWorker=1&pfs=1');
    await restored.getByRole('textbox', {name: 'DC domain'}).fill('dc.example.org');
    await restored.getByRole('button', {name: 'Connect to Blah'}).click();
    await restored.getByText('Create or restore an identity', {
      exact: true
    }).click();
    await restored.getByLabel('Identity password', {
      exact: true
    }).fill('test identity password');
    await restored.getByLabel('Encrypted backup', {
      exact: true
    }).setInputFiles(backupFile);
    await restored.getByRole('button', {
      name: 'Restore backup',
      exact: true
    }).click();
    await restored.getByRole('button', {
      name: 'Download public profile',
      exact: true
    }).waitFor();
    await restored.getByRole('button', {
      name: 'Sign in to Blah',
      exact: true
    }).click();
    await restored.waitForFunction(() => JSON.parse(localStorage.getItem('account1') || '{}').userId);
    const restoredId = await restored.evaluate(() => JSON.parse(localStorage.getItem('account1')).userId);
    if(userId !== restoredId) throw new Error('Recovery changed the account');
    await context.close();
    console.log('PASS DC domain discovery, exact signed WebSocket URL, full browser signup, profile publication, reload, recovered identity login over PFS, dialog keyboard/focus and Axe checks.');
  } catch(error) {
    console.error(error);
    console.error((await activePage.locator('body').innerText()).slice(-7000));
    console.error(diagnostics.slice(-15));
    console.error(logs.slice(-3000));
    throw error;
  }
} finally {
  await browser?.close();
  proxy.close();
  edge?.closeAllConnections();
  if(edge) edge.close();
  child?.kill('SIGTERM');
  const stopTimer = setTimeout(() => child?.kill('SIGKILL'), 5000);
  if(child && child.exitCode === null) await once(child, 'exit');
  clearTimeout(stopTimer);
  await rm(dir, {
    recursive: true,
    force: true
  });
}
