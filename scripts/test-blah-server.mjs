// Real tweb UI/worker -> TLS WebSocket or HTTPS -> a throwaway Teleblah DC. No production services.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {openSync} from 'node:fs';
import {createServer} from 'node:https';
import {createServer as tcpServer} from 'node:net';
import {mkdtemp, readFile, writeFile, mkdir, rename, rm} from 'node:fs/promises';
import {spawn, execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {Readable} from 'node:stream';
import assert from 'node:assert/strict';
import {saveAndVerifyWords} from '../tests/blah/recoveryWords.mjs';
import {checkDeviceLink} from '../tests/blah/deviceLink.mjs';
import {inspectIdentity, sessionDevices, signInWords, checkSessionTermination, logoutAndCheck, checkChatIdentity} from '../tests/blah/identityIntegration.mjs';
import {checkChatMenus} from '../tests/blah/chatMenus.mjs';
import {loadEnv} from 'vite';
import {blahDiemRuntimeURL} from './blah-config.mjs';
import {localDiemRuntime} from '../tests/blah/localRuntime.mjs';
const repo = fileURLToPath(new URL('../', import.meta.url));
const diemRuntimeURL = blahDiemRuntimeURL(loadEnv('blah', repo, '').BLAH_DIEM_CDN_HOST);
const localRuntime = await localDiemRuntime(diemRuntimeURL);
const setupKey = randomBytes(32).toString('hex');
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
const profileDomains = ['dc.example.org', 'other.example.org', 'alice.example.org', 'bob.example.org', 'carol.example.org', ...chatDomains];
async function publishProfile(domain, bytes) {
  assert(profileDomains.includes(domain) || /^[a-z0-9-]+\.id\.example$/.test(domain));
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
const diagnostics = [];
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
    otherWeb = await free(),
    bidcom = await free(),
    otherBidcom = await free();
  await mkdir(dir + '/profiles');
  const testHosting = true;
  if(testHosting) await writeFile(dir + '/hosting.json', JSON.stringify({domain: 'id.example',
    database: dir + '/hosting.sqlite', maxUpdatesPerIdentityPerHour: 100,
    proofOfWork: {baseBits: 8, bitsPerShorterCharacter: 0, referenceLength: 0}}));
  const startDC = (domain, port, web, peerPort) => {
    const server = spawn(tele + '/.build/debug/BlahMTProtoServer', ['--port', String(port), '--web-port', String(web),
      '--bidcom-listen-port', String(peerPort), '--data-dir', dir + '/' + domain,
      '--data-db', dir + '/' + domain + '-data.sqlite', '--auth-db', dir + '/' + domain + '-auth.sqlite',
      '--jobs-db', dir + '/' + domain + '-jobs.sqlite', '--federation-domain', domain,
      // Transport keys survive a restart, as in a `--data-dir` deployment.
      '--db', dir + '/' + domain + '-sessions.sqlite',
      '--setup-key', setupKey,
      '--real-ip-header', 'X-Real-IP', '--real-ip-header-required', 'true',
      '--test-profile-directory', dir + '/profiles'], {
      cwd: tele, stdio: ['ignore', 'ignore', 'pipe'],
      env: {...process.env, ...(testHosting && domain === 'dc.example.org' ? {BLAH_PROFILE_HOSTING_CONFIG: dir + '/hosting.json'} : {})}
    });
    server.stderr.on('data', c => logs += c);
    return server;
  };
  child = startDC('dc.example.org', port, web, bidcom);
  otherChild = startDC('other.example.org', otherPort, otherWeb, otherBidcom);
  await new Promise(r => setTimeout(r, 2000));
  if(child.exitCode !== null || otherChild.exitCode !== null) throw Error('Server exited: ' + logs);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', dir + '/tls.key', '-out', dir + '/tls.crt', '-days', '1', '-subj', '/CN=localhost'], {
    stdio: 'ignore'
  });
  let httpRequests = 0;
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
      if(['dc.example.org', 'other.example.org'].includes(new URL('https://' + req.headers.host).hostname)) {
        const dcWeb = req.headers.host.startsWith('other.') ? otherWeb : web;
        if(req.method === 'POST' && path === '/api/v1/renewal') {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks);
          req.fixtureProfile = {host: new URL('https://' + req.headers.host).hostname,
            body: Buffer.from(JSON.parse(body).profile, 'base64')};
          proxy.web(req, res, {target: 'http://127.0.0.1:' + dcWeb, buffer: Readable.from([body]), selfHandleResponse: true});
        } else proxy.web(req, res, {target: 'http://127.0.0.1:' + dcWeb});
        return;
      }
      // Profile hosting for fetches from the shared worker, which page routes do not intercept.
      const host = new URL('https://' + req.headers.host).hostname;
      if(testHosting && (host === 'id.example' || host.endsWith('.id.example'))) {
        if(req.method === 'PUT') {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks);
          req.fixtureProfile = {host, body};
          proxy.web(req, res, {target: 'http://127.0.0.1:' + web, buffer: Readable.from([body]), selfHandleResponse: true});
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
    } catch(error) {
      if(error.code !== 'ENOENT') console.error('Edge request failed', req.method, req.url, error);
      res.writeHead(404);
      res.end();
    }
  });
  const connectedPaths = new Set();
  edge.on('secureConnection', (socket) => socket.on('error', (error) => {
    if(error.code !== 'ECONNRESET') diagnostics.push('TLS socket: ' + error.message);
  }));
  edge.on('upgrade', (req, socket, head) => {
    assert(['/discovered/ws?route=home', '/rotated/ws?route=home', '/other/ws?route=home'].includes(req.url));
    connectedPaths.add(req.url);
    req.headers['x-real-ip'] = req.socket.remoteAddress;
    proxy.ws(req, socket, head, {target: 'ws://127.0.0.1:' + (req.url.startsWith('/other/') ? otherPort : port)});
  });
  proxy.on('proxyRes', async(response, request, result) => {
    if(!request.fixtureProfile) return;
    const chunks = [];
    for await (const chunk of response) chunks.push(chunk);
    if([200, 204].includes(response.statusCode)) await publishProfile(request.fixtureProfile.host, request.fixtureProfile.body);
    result.writeHead(response.statusCode, response.headers);
    result.end(Buffer.concat(chunks));
  });
  proxy.on('error', (error) => console.error('Proxy error: ' + error.message));
  edge.listen(0, '127.0.0.1');
  await once(edge, 'listening');
  const tlsPort = edge.address().port,
    origin = 'https://blah-server-test.blahim.com';
  if(process.env.BLAH_TEST_SKIP_BUILD !== '1') execFileSync(repo + '/node_modules/.bin/vite', ['build', '--mode', 'blah'], {
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
      '--host-resolver-rules=' + ['dc.example.org', 'other.example.org', 'blah-server-test.blahim.com', 'other-server-test.blahim.com', ...profileDomains, ...(testHosting ? ['id.example', '*.id.example'] : [])].map(host => `MAP ${host} 127.0.0.1:${tlsPort}`).join(',') +
        (localRuntime.size ? `,MAP ${new URL(diemRuntimeURL).hostname} 127.0.0.1:${tlsPort}` : '')]
  });
  const signupContext = await browser.newContext({
    ignoreHTTPSErrors: true
  });
  signupContext.setDefaultTimeout(30000);
  signupContext.setDefaultNavigationTimeout(60000);
  const page = await signupContext.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => diagnostics.push(e.message));
  page.on('console', m => {
    if(m.type() === 'error') {
      diagnostics.push(m.text().slice(0, 350));
      void Promise.all(m.args().map((arg) => arg.evaluate((value) => value && typeof value === 'object' ?
        {type: value.type, message: value.message, cause: value.cause && {type: value.cause.type, message: value.cause.message}} : undefined).catch(() => undefined)))
        .then((details) => console.error('Browser error details: ' + JSON.stringify(details.filter(Boolean))));
    }
  });
  await page.goto(origin + '/?debug=1&noServiceWorker=1&a11y=1' + (testHttp ? '&http=1' : ''));
  async function setupDC(webPort, wsPath) {
    async function post(path, body) {
      const response = await fetch(`http://127.0.0.1:${webPort}${path}`, {method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + setupKey}, body: JSON.stringify(body)});
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    }
    let context = await post('/setup/context', {});
    context = await post('/setup/endpoints', {
      endpoints: context.endpoints.map((endpoint) => endpoint.transport === 'webSocket' ?
        {...endpoint, host: 'blah-server-test.blahim.com', port: tlsPort, path: wsPath, tls: true} : endpoint),
      bidcomEndpoints: context.bidcomEndpoints
    });
    const signed = await page.evaluate(async({context, runtimeURL}) => {
      const client = await (await import(runtimeURL)).createDiem();
      const seed = client.seeds.generate();
      try {
        return {...await client.dcSetup({data: Uint8Array.from(atob(context.data), (char) => char.charCodeAt(0)),
          seed: seed.entropy, device: await client.deviceKeys.generate(), now: context.now}), words: seed.words};
      } finally { seed.entropy.fill(0); }
    }, {context, runtimeURL: diemRuntimeURL});
    await post('/setup/complete', {profile: Buffer.from(signed.profile).toString('base64'), name: 'Fixture DC'});
    await publishProfile(webPort === web ? 'dc.example.org' : 'other.example.org', Buffer.from(signed.profile));
    return signed;
  }
  const signedDC = await setupDC(web, '/discovered/ws?route=home');
  await setupDC(otherWeb, '/other/ws?route=home');
  await page.reload();
  await page.getByRole('textbox', {name: 'DC domain', exact: true}).fill('dc.example.org');
  await page.getByRole('button', {name: 'Connect to Blah', exact: true}).click();
  await page.getByRole('button', {name: 'Create Account', exact: true}).click();
  await page.getByLabel('Profile address').selectOption('hosted');
  await page.getByRole('textbox', {name: 'Hosting domain', exact: true}).fill('id.example');
  await page.getByRole('textbox', {name: 'Name', exact: true}).fill('alice');
  await page.getByRole('button', {name: 'Continue', exact: true}).click();
  const words = await saveAndVerifyWords(page);
  await page.getByRole('button', {name: 'Claim and publish', exact: true}).click();
  await page.getByRole('textbox', {name: /first name/i}).fill('Alice');
  await page.getByRole('button', {name: 'Start Messaging', exact: true}).click();
  await page.locator('#page-chats').waitFor();
  const first = await page.evaluate(() => window.rootScope.managers.appAccountManager.blahIdentity({action: 'inspect'}));
  assert.equal(first.identity.holder, true);
  const identityID = first.identity.id, userId = first.identity.account;
  console.log('PASS seed-based setup, hosted signup with word verification and custody.');
  await page.reload(); await page.locator('#page-chats').waitFor();
  if(process.env.BLAH_TEST_DEVICE_LINK === '1') {
    await checkDeviceLink({browser, page, origin, signedDC, identityID, userId});
    await checkSessionTermination(page);
  }
  if(process.env.BLAH_TEST_MENUS_ONLY === '1') await checkChatMenus({page, expect});
  if(diagnostics.length) {
    const failures = await page.evaluate(async() => (await window.collectLogs())
      .filter((entry) => entry.args?.[0] === 'rpc error' && entry.args?.[1]?.error_message === 'METHOD_NOT_FOUND')
      .map((entry) => ({method: entry.args[2]?.humanReadable, error: entry.args[1].error_message})));
    console.log('Unsupported UI RPCs: ' + JSON.stringify(failures));
  }
  const recovered = await signInWords({browser, origin, domain: 'alice.id.example', words, http: testHttp});
  const restored = await inspectIdentity(recovered.page);
  assert.equal(restored.identity.id, identityID);
  assert.equal(restored.identity.account, userId);
  const retiredDevice = restored.identity.devices.find((device) => device.current).id;
  assert.notEqual(retiredDevice, first.identity.devices.find((device) => device.current).id);
  await logoutAndCheck(recovered.page);
  await expect.poll(async() => (await sessionDevices(page)).length).toBe(1);
  await recovered.context.close();
  const next = await signInWords({browser, origin, domain: 'alice.id.example', words, http: testHttp});
  await expect.poll(async() => (await inspectIdentity(next.page)).identity.devices.some((device) => device.id === retiredDevice)).toBe(false);
  console.log('PASS recovery-word sign-in, ordinary logout custody deletion, and background pruning of the retired device.');
  await checkChatIdentity({page, recovery: next.page, publishProfile});
  await next.context.close();
  const operator = await signInWords({browser, origin, domain: 'dc.example.org', words: signedDC.words, http: testHttp});
  const operatorIdentity = (await inspectIdentity(operator.page)).identity;
  assert.equal(operatorIdentity.account, '777000');
  assert.equal(operatorIdentity.id, signedDC.id);
  assert.equal(operatorIdentity.holder, true);
  // The ephemeral setup device never had a session and is not retired. Holders keep it.
  await expect.poll(async() => (await inspectIdentity(operator.page)).identity.devices.length).toBe(2);
  await operator.context.close();
  console.log('PASS DC operator sign-in with words and public POST /api/v1/renewal publication/pruning.');
  await page.locator('.sidebar-tools-button').click();
  await page.getByRole('menuitem', {name: 'Settings', exact: true}).click();
  await expect(page.getByText('My Stars', {exact: true})).toHaveCount(0);
  await expect(page.getByText('My Grams', {exact: true})).toHaveCount(0);
  console.log('PASS stock Settings without unsupported commerce balance requests.');
  assert.equal(diagnostics.length, 0, diagnostics.join('\n'));
  console.log('PASS seed-based setup, hosted signup with word verification, opaque custody reload, and recovery-word login with a fresh device.');
} catch(error) {
  console.error('Browser diagnostics: ' + diagnostics.join('\n'));
  for(const context of browser?.contexts() || []) for(const page of context.pages()) {
    console.error('Page ' + page.url() + '\n' + await page.locator('body').innerText().catch(() => 'Unavailable'));
    console.error('Public slot state: ' + JSON.stringify(await page.evaluate(async() => {
      const request = indexedDB.open('blah-device-custody-v1');
      const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try {
        return await new Promise((resolve) => {
          const tx = db.transaction('vault'); const store = tx.objectStore('vault');
          const keys = store.getAllKeys(); const values = store.getAll();
          tx.oncomplete = () => resolve(keys.result.flatMap((key, i) => /^(home:|slot:|reset-slot:|account-)/.test(String(key)) ? [[key, values.result[i]]] : []));
        });
      } finally { db.close(); }
    }).catch(() => [])));
    await page.screenshot({path: dir + '/failure.png'}).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close(); proxy.close(); edge?.closeAllConnections(); if(edge) edge.close();
  await Promise.all([child, otherChild].filter(Boolean).map(stopServer));
  if(process.env.BLAH_TEST_KEEP_OUTPUT === '1') {
    await writeFile(dir + '/server.log', logs);
    console.log('Fixture output: ' + dir);
  } else await rm(dir, {recursive: true, force: true});
}
