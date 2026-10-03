// Production widget, in an iframe, against a disposable Blah DC. No live accounts.
import assert from 'node:assert/strict';
import {randomBytes, createHash} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {createServer} from 'node:https';
import {createServer as tcpServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'vite';
import {chromium, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import httpProxy from 'http-proxy';
import {cbor} from '../tests/blah/cbor.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const tele = process.env.BLAH_SERVER_REPO;
if(!tele) throw new Error('Set BLAH_SERVER_REPO to a checkout with a built debug BlahMTProtoServer.');
const dir = await mkdtemp('/tmp/blah-widget-');
const proxy = httpProxy.createProxyServer({ws: true});
let child, browser, edge;
let serverLog = '';
const freePort = async() => {
  const server = tcpServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const port = await freePort(), webPort = await freePort();
  await mkdir(dir + '/profiles');
  await writeFile(dir + '/seed', randomBytes(32));
  const customers = [1000501, 1000502, 1000503].map((id) => ({id, token: id + ':' + randomBytes(24).toString('base64url')}));
  const [alice, bob, support] = customers;
  await writeFile(dir + '/local.json', JSON.stringify({options: {supportUserId: support.id, supportName: 'Customer Care'}}));
  const startDC = async() => {
    child = spawn(tele + '/.build/debug/BlahMTProtoServer', [
      '--port', String(port), '--web-port', String(webPort), '--data-db', dir + '/data.sqlite',
      '--auth-db', dir + '/auth.sqlite', '--jobs-db', dir + '/jobs.sqlite', '--db', dir + '/transport.sqlite',
      '--federation-domain', 'widget.example.org', '--federation-key-file', dir + '/seed',
      '--federation-key-algorithm', 'ed25519', '--test-profile-directory', dir + '/profiles', '--local-config-file', dir + '/local.json'
    ], {cwd: tele, stdio: ['ignore', 'pipe', 'pipe']});
    child.stdout.on('data', (data) => { serverLog = (serverLog + data).slice(-8000); });
    child.stderr.on('data', (data) => { serverLog = (serverLog + data).slice(-8000); });
    for(let i = 0; i < 150; ++i) {
      if(child.exitCode !== null) throw new Error('Fixture server exited: ' + serverLog);
      try { await fetch('http://127.0.0.1:' + webPort + '/'); return; } catch{}
      await sleep(100);
    }
    throw new Error('Fixture server startup timed out');
  };
  const stopDC = async() => { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; };
  await startDC();
  await stopDC();
  // Seed only this temporary database while its server is stopped. Account
  // creation/authority is exercised by Teleblah's ManagedAccountTests.
  const seed = new DatabaseSync(dir + '/data.sqlite');
  const authority = seed.prepare('SELECT key_id FROM known_dcs WHERE local_id = 1').get().key_id;
  const generationQuery = seed.prepare('SELECT namespace_generation FROM federation_schema');
  generationQuery.setReadBigInts(true);
  const generation = generationQuery.get().namespace_generation;
  for(const customer of customers) {
    seed.prepare('INSERT INTO users (id, first_name, is_bot, is_verified, replies_blocked, managed_app_id, quota_owner_id, bot_token_hash) VALUES (?, ?, 0, 0, 0, 12345, ?, ?)')
      .run(customer.id, customer === support ? 'Customer Care' : 'Customer ' + customer.id, support.id, createHash('sha256').update(customer.token).digest('hex'));
    // Match the canonical reservation made by reserveLocalManagedAccount.
    const canonical = Buffer.from(cbor({0: 1, 1: 1, 2: 3, 3: authority, 4: 1, 5: customer.id, 6: generation, 7: new Uint8Array()}));
    seed.prepare('INSERT INTO federation_aliases (kind, scope, local_id, canonical) VALUES (\'user\', ?, ?, ?)')
      .run(new Uint8Array(), customer.id, canonical);
  }
  seed.close();
  await startDC();

  await build({configFile: repo + '/vite.widget.config.ts', logLevel: 'warn'});
  await build({configFile: repo + '/vite.widget.config.ts', logLevel: 'warn', build: {
    outDir: dir + '/driver', lib: {entry: repo + '/tests/widget/driver.ts', formats: ['es'], fileName: () => 'driver.js'}
  }});
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', dir + '/tls.key',
    '-out', dir + '/tls.crt', '-days', '1', '-subj', '/CN=localhost'], {stdio: 'ignore'});
  const rsa = JSON.parse(await readFile(tele + '/Schemas/blah-rsa-key.json', 'utf8'));
  const template = await readFile(repo + '/dist/widget/index.html', 'utf8');
  const paths = new Set();
  edge = createServer({key: await readFile(dir + '/tls.key'), cert: await readFile(dir + '/tls.crt')}, async(req, res) => {
    const path = new URL(req.url, 'https://localhost').pathname;
    try {
      let body, type;
      if(path === '/host') {
        body = '<!doctype html><html lang="en"><head><title>Widget host</title></head><body><iframe title="Customer support" name="customer-feedback" src="' + origin + '/" style="border:0;width:390px;height:640px"></iframe></body></html>';
        type = 'text/html';
      } else if(path === '/') {
        body = template;
        const meta = {'dc-id': config.dcId, 'dc-url': config.url, 'rsa-modulus': config.rsaKey.modulus, 'rsa-exponent': config.rsaKey.exponent, 'api-id': config.apiId, 'api-hash': config.apiHash};
        for(const [name, value] of Object.entries(meta)) body = body.replace(new RegExp('(name="blah-widget-' + name + '" content=")[^"]*'), '$1' + value);
        type = 'text/html';
      } else if(path === '/driver') {
        body = '<!doctype html><html lang="en"><head><title>Test support client</title></head><body><script type="module" src="/driver/driver.js"></script></body></html>';
        type = 'text/html';
      } else if(/^\/(?:assets|driver)\/[\w./-]+$/.test(path) && !path.includes('..')) {
        body = await readFile(path.startsWith('/driver/') ? dir + path : repo + '/dist/widget' + path);
        type = path.endsWith('.css') ? 'text/css' : 'text/javascript';
      } else { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store'}); res.end(body);
    } catch{ res.writeHead(404); res.end(); }
  });
  edge.on('upgrade', (req, socket, head) => {
    paths.add(req.url);
    assert.equal(req.url, '/exact/socket?widget=1');
    proxy.ws(req, socket, head, {target: 'ws://127.0.0.1:' + port});
  });
  proxy.on('error', () => {});
  edge.listen(0, '127.0.0.1'); await once(edge, 'listening');
  const origin = 'https://127.0.0.1:' + edge.address().port;
  const config = {dcId: 1, url: origin.replace('https:', 'wss:') + '/exact/socket?widget=1', rsaKey: {modulus: rsa.n, exponent: rsa.e}, apiId: 12345, apiHash: 'ab'.repeat(16)};
  browser = await chromium.launch({headless: true, executablePath: process.env.BLAH_BROWSER_EXECUTABLE, args: ['--no-sandbox', '--ignore-certificate-errors']});
  const context = await browser.newContext({ignoreHTTPSErrors: true});
  context.setDefaultTimeout(35_000);
  const page = await context.newPage(), errors = [], logs = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { logs.push(msg.text()); if(msg.type() === 'error') console.error(msg.text()); });
  // Different hostnames exercise cross-origin iframe storage and embedding.
  await page.goto(origin.replace('127.0.0.1', 'localhost') + '/host');
  const frame = page.frameLocator('iframe');
  const widgetFrame = () => page.frames().find((frame) => frame.parentFrame());
  await expect(frame.getByRole('status')).toContainText('requires a customer token');
  assert.equal(paths.size, 0, 'a tokenless widget must not connect');
  const navigate = async(token, reload = false) => {
    await page.locator('iframe').evaluate((iframe, url) => { iframe.src = url; },
      origin + '/?a11y=1&debug=1&test=1' + (reload ? '&reload=1' : '') + '#token=' + encodeURIComponent(token));
  };
  await navigate(alice.token);
  await expect(frame.getByRole('heading', {name: 'Customer Care'})).toBeVisible();
  const textarea = frame.getByRole('textbox', {name: 'Message to support'});
  await textarea.fill('A customer can ask for help first.');
  await frame.getByRole('button', {name: 'Send', exact: true}).click();
  await expect(frame.getByText('A customer can ask for help first.', {exact: true})).toBeVisible();
  await widgetFrame().evaluate(() => location.reload());
  await expect(frame.getByText('A customer can ask for help first.', {exact: true})).toBeVisible();

  const driver = await context.newPage();
  await driver.goto(origin + '/driver');
  await driver.waitForFunction(() => !!window.widgetTestDriver);
  await driver.evaluate(async({config, token}) => window.widgetTestDriver.connect(config, token), {config, token: support.token});
  await driver.evaluate(async(id) => window.widgetTestDriver.reply(id, 'Thanks! We can help.'), alice.id);
  await expect(frame.getByText('Thanks! We can help.', {exact: true})).toBeVisible();
  // CSS variables live in the iframe document, including on a host-served theme.
  await frame.locator('html').evaluate((html) => {
    html.style.setProperty('--widget-chat-background-color', 'rgb(240, 248, 255)');
    html.style.setProperty('--widget-bubble-radius', '4px');
    html.style.setProperty('--widget-outgoing-bubble-color', 'rgb(30, 80, 120)');
  });
  await expect(frame.locator('.widget-history')).toHaveCSS('background-color', 'rgb(240, 248, 255)');
  await expect(frame.locator('.widget-outgoing .widget-bubble').first()).toHaveCSS('border-radius', '4px');
  await expect(frame.locator('.widget-outgoing .widget-bubble').first()).toHaveCSS('background-color', 'rgb(30, 80, 120)');
  await textarea.focus(); await page.keyboard.press('Tab');
  await expect(frame.getByRole('button', {name: 'Attach file'})).toBeFocused();
  await mkdir(repo + '/tmp/widget', {recursive: true});
  await page.screenshot({path: repo + '/tmp/widget/iframe.png'});
  const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(axe.violations, []);
  await page.locator('iframe').evaluate((iframe) => { iframe.style.width = '280px'; iframe.style.height = '480px'; });
  assert(await frame.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth));

  // A new document must retire the saved authorization before switching users.
  await navigate(bob.token, true);
  await expect(frame.getByRole('heading', {name: 'Customer Care'})).toBeVisible();
  await expect(frame.getByText('A customer can ask for help first.', {exact: true})).toHaveCount(0);
  const database = new DatabaseSync(dir + '/data.sqlite');
  await expect.poll(() => database.prepare('SELECT count(*) AS n FROM authorizations WHERE user_id = ?').get(alice.id).n).toBe(0);
  await textarea.fill('A separate customer.'); await frame.getByRole('button', {name: 'Send', exact: true}).click();
  await expect(frame.getByText('A separate customer.', {exact: true})).toBeVisible();
  // Changing just the hash uses the same transition while the document lives.
  await widgetFrame().evaluate((token) => { location.hash = 'token=' + encodeURIComponent(token); }, alice.token);
  await expect(frame.getByText('A customer can ask for help first.', {exact: true})).toBeVisible();
  await expect(frame.getByText('A separate customer.', {exact: true})).toHaveCount(0);
  await expect.poll(() => database.prepare('SELECT count(*) AS n FROM authorizations WHERE user_id = ?').get(bob.id).n).toBe(0);
  await widgetFrame().evaluate(() => { location.hash = ''; });
  await expect(frame.getByRole('status')).toContainText('requires a customer token');
  await expect.poll(() => database.prepare('SELECT count(*) AS n FROM authorizations WHERE user_id = ?').get(alice.id).n).toBe(0);
  // Revoking a token must also refuse a reload with its previously valid key.
  await navigate(alice.token);
  await expect(frame.getByText('A customer can ask for help first.', {exact: true})).toBeVisible();
  database.prepare('UPDATE users SET bot_token_hash = ? WHERE id = ?')
    .run(createHash('sha256').update(randomBytes(32)).digest('hex'), alice.id);
  await widgetFrame().evaluate(() => location.reload());
  await expect(frame.getByRole('alert')).toContainText('no longer valid');
  await expect(frame.getByText('A customer can ask for help first.', {exact: true})).toHaveCount(0);
  await expect(textarea).toBeDisabled();
  await expect.poll(() => database.prepare('SELECT count(*) AS n FROM authorizations WHERE user_id = ?').get(alice.id).n).toBe(0);
  database.close();
  await navigate(alice.id + ':' + 'invalid_token_12345678901234567890');
  await expect(frame.getByRole('alert')).toContainText('no longer valid');
  await expect(textarea).toBeDisabled();
  assert.deepEqual(errors, []);
  for(const {token} of customers) assert(!logs.join('\n').includes(token), 'tokens must not appear in console logs');
  assert.deepEqual([...paths], ['/exact/socket?widget=1']);
  console.log('Widget browser checks passed: real token auth, support-first send/reply, reload, token switch/logout across loads and hash changes, revoked/missing/invalid tokens, cross-origin iframe layout, theme variables, keyboard and Axe.');
} catch(error) {
  await writeFile('/tmp/widget-server.log', serverLog);
  throw error;
} finally {
  await browser?.close();
  if(child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  proxy.close(); edge?.close();
  await rm(dir, {recursive: true, force: true});
}
