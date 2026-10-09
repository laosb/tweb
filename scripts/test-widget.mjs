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
import {chromium, expect as baseExpect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import httpProxy from 'http-proxy';
import {cbor} from '../tests/blah/cbor.mjs';

// The full client takes a few seconds to restore after a reload.
const expect = baseExpect.configure({timeout: 20_000});
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
  const pins = (html) => {
    const meta = {'dc-id': config.dcId, 'dc-url': config.url, 'rsa-modulus': config.rsaKey.modulus, 'rsa-exponent': config.rsaKey.exponent, 'api-id': config.apiId, 'api-hash': config.apiHash};
    for(const [name, value] of Object.entries(meta)) html = html.replace(new RegExp('(name="blah-widget-' + name + '" content=")[^"]*'), '$1' + value);
    return html;
  };
  const types = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json'};
  const paths = new Set(), requests = [];
  edge = createServer({key: await readFile(dir + '/tls.key'), cert: await readFile(dir + '/tls.crt')}, async(req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'https://localhost').pathname);
    requests.push(path);
    try {
      let body, type;
      if(path === '/host') {
        body = '<!doctype html><html lang="en"><head><title>Widget host</title></head><body><iframe title="Customer support" name="customer-feedback" src="' + origin + '/" style="border:0;width:390px;height:640px"></iframe></body></html>';
        type = 'text/html';
      } else if(path === '/' || path === '/index.html') {
        body = pins(template);
        type = 'text/html';
      } else if(path === '/driver') {
        // The driver's @config/blah reads the same pins from its document.
        body = pins(template.replace(/<body[\s\S]*<\/body>/, '<body><script type="module" src="/driver/driver.js"></script></body>').replace(/<script type="module"[^>]*><\/script>/, ''));
        type = 'text/html';
      } else if(/^\/[\w./@-]+$/.test(path) && !path.includes('..')) {
        body = await readFile(path.startsWith('/driver/') ? dir + path : repo + '/dist/widget' + path);
        type = types[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream';
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
  // The full client also calls Telegram methods a Blah DC does not implement; those
  // rejections are expected, any other uncaught error is not.
  await context.addInitScript(() => addEventListener('unhandledrejection', (event) => console.log('REJECTION ' + (event.reason?.type || event.reason))));
  const page = await context.newPage(), errors = [], logs = [], urls = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => logs.push(msg.text()));
  context.on('request', (request) => urls.push(request.url()));
  // Different hostnames exercise cross-origin iframe storage and embedding.
  await page.goto(origin.replace('127.0.0.1', 'localhost') + '/host');
  const frame = page.frameLocator('iframe');
  const widgetFrame = () => page.frames().find((frame) => frame.parentFrame());
  const status = frame.locator('#widget [role="status"]'), alert = frame.locator('#widget [role="alert"]');
  const title = frame.locator('#column-center .chat .topbar .peer-title');
  const bubble = (text) => frame.locator('#column-center .bubble').filter({hasText: text});
  const send = async(text) => {
    await frame.getByRole('textbox', {name: 'Message'}).click();
    await page.keyboard.insertText(text);
    await page.keyboard.press('Enter');
    await expect(bubble(text)).toBeVisible();
  };
  await expect(status).toContainText('requires a customer token');
  const navigate = async(token, reload = false) => {
    await page.locator('iframe').evaluate((iframe, url) => { iframe.src = url; },
      origin + '/?debug=1&test=1' + (reload ? '&reload=1' : '') + '#token=' + encodeURIComponent(token));
  };
  await navigate(alice.token);
  await expect(title).toHaveText('Customer Care');
  await send('A customer can ask for help first.');
  // Emoji use the system font; the release has no emoji images.
  await send('Thanks 👋');
  await expect(bubble('Thanks 👋').locator('.emoji-native')).toHaveCount(1);
  await expect(bubble('Thanks 👋').locator('img.emoji')).toHaveCount(0);
  await widgetFrame().evaluate(() => location.reload());
  await expect(bubble('A customer can ask for help first.')).toBeVisible();
  assert(new URL(widgetFrame().url()).hash.startsWith('#token='), 'opening the chat keeps the token in the fragment');

  // Only this conversation, with only text, emoji, photos and files.
  await expect(frame.locator('#column-left')).toBeHidden();
  await expect(frame.locator('#column-center .chat .topbar .chat-utils')).toBeHidden();
  await expect(frame.locator('#column-center .btn-send.record')).toHaveCount(0);
  await frame.getByRole('button', {name: 'Attach'}).click();
  await expect(frame.locator('.btn-menu .btn-menu-item').filter({visible: true})).toHaveText([/Photo or Video/, /Document/]);
  await page.keyboard.press('Escape');
  await title.click();
  await expect(frame.locator('#column-right')).toBeHidden();
  await expect(title).toHaveText('Customer Care');

  const driver = await context.newPage();
  const driverErrors = [];
  driver.on('pageerror', (err) => driverErrors.push(err.message));
  driver.on('console', (msg) => driverErrors.push(msg.text()));
  await driver.goto(origin + '/driver');
  await driver.waitForFunction(() => !!window.widgetTestDriver).catch((error) => { throw new Error(driverErrors.join('\n') || error.message); });
  await driver.evaluate(async({config, token}) => window.widgetTestDriver.connect(config, token), {config, token: support.token});
  await driver.evaluate(async(id) => window.widgetTestDriver.reply(id, 'Thanks! We can help.'), alice.id);
  await expect(bubble('Thanks! We can help.')).toBeVisible();
  // CSS variables live in the iframe document, including on a host-served theme.
  await frame.locator('html').evaluate((html) => {
    html.style.setProperty('--widget-chat-background-color', 'rgb(240, 248, 255)');
    html.style.setProperty('--widget-bubble-radius', '4px');
    html.style.setProperty('--widget-outgoing-bubble-color', 'rgb(30, 80, 120)');
  });
  await expect(frame.locator('.blah-widget-background')).toHaveCSS('background-color', 'rgb(240, 248, 255)');
  const outgoing = bubble('A customer can ask for help first.').locator('.bubble-content');
  await expect(outgoing).toHaveCSS('border-top-left-radius', '4px');
  await expect(outgoing).toHaveCSS('background-color', 'rgb(30, 80, 120)');
  await mkdir(repo + '/tmp/widget', {recursive: true});
  await page.screenshot({path: repo + '/tmp/widget/iframe.png'});
  const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(axe.violations.map(({id, nodes}) => id + ': ' + nodes.map(({target}) => target.join(' ')).join(', ')), []);
  // After the scan: tweb's code block header buttons have no accessible names.
  // The release has no syntax highlighting or polls: code shows as plain text, a poll as its question.
  const code = 'const answer = 42;';
  await driver.evaluate(async({id, code}) => window.widgetTestDriver.reply(id, code,
    [{_: 'messageEntityPre', offset: 0, length: code.length, language: 'javascript'}]), {id: alice.id, code});
  await expect(bubble(code)).toBeVisible();
  await expect(bubble(code).locator('.prism-token')).toHaveCount(0);
  await driver.evaluate(async(id) => window.widgetTestDriver.poll(id, 'How did we do?', ['Great', 'Okay']), alice.id);
  await expect(bubble('📊 How did we do?')).toBeVisible();
  // Dark mode follows the system scheme, with the theme's dark values.
  await frame.locator('head').evaluate((head) => head.insertAdjacentHTML('beforeend',
    '<style>:root.night { --widget-incoming-bubble-color: rgb(20, 40, 60); }</style>'));
  await page.emulateMedia({colorScheme: 'dark'});
  await expect(frame.locator('html')).toHaveClass(/\bnight\b/);
  await expect.poll(() => frame.locator('#column-center .chat .topbar').evaluate((el) => getComputedStyle(el).backgroundColor))
  .not.toBe('rgb(255, 255, 255)');
  await expect(bubble('Thanks! We can help.').locator('.bubble-content')).toHaveCSS('background-color', 'rgb(20, 40, 60)');
  await page.screenshot({path: repo + '/tmp/widget/iframe-dark.png'});
  await page.emulateMedia({colorScheme: 'light'});
  await page.locator('iframe').evaluate((iframe) => { iframe.style.width = '280px'; iframe.style.height = '480px'; });
  assert(await frame.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth));

  // A new document must retire the saved authorization before switching users.
  await navigate(bob.token, true);
  await expect(title).toHaveText('Customer Care');
  await expect(bubble('A customer can ask for help first.')).toHaveCount(0);
  const database = new DatabaseSync(dir + '/data.sqlite');
  await expect.poll(() => database.prepare('SELECT count(*) AS n FROM authorizations WHERE user_id = ?').get(alice.id).n).toBe(0);
  await send('A separate customer.');
  // Changing just the hash uses the same transition while the document lives.
  await widgetFrame().evaluate((token) => { location.hash = 'token=' + encodeURIComponent(token); }, alice.token);
  await expect(bubble('A customer can ask for help first.')).toBeVisible();
  await expect(bubble('A separate customer.')).toHaveCount(0);
  await expect.poll(() => database.prepare('SELECT count(*) AS n FROM authorizations WHERE user_id = ?').get(bob.id).n).toBe(0);
  await widgetFrame().evaluate(() => { location.hash = ''; });
  await expect(status).toContainText('requires a customer token');
  await expect.poll(() => database.prepare('SELECT count(*) AS n FROM authorizations WHERE user_id = ?').get(alice.id).n).toBe(0);
  // Revoking a token must also refuse a reload with its previously valid key.
  await navigate(alice.token);
  await expect(bubble('A customer can ask for help first.')).toBeVisible();
  database.prepare('UPDATE users SET bot_token_hash = ? WHERE id = ?')
    .run(createHash('sha256').update(randomBytes(32)).digest('hex'), alice.id);
  await widgetFrame().evaluate(() => location.reload());
  await expect(alert).toContainText('no longer valid');
  await expect(frame.locator('#page-chats')).toBeHidden();
  await expect.poll(() => database.prepare('SELECT count(*) AS n FROM authorizations WHERE user_id = ?').get(alice.id).n).toBe(0);
  database.close();
  await navigate(alice.id + ':' + 'invalid_token_12345678901234567890');
  await expect(alert).toContainText('no longer valid');
  await expect(frame.locator('#page-chats')).toBeHidden();
  const rejections = logs.filter((line) => line.startsWith('REJECTION ')).map((line) => line.slice(10));
  assert.deepEqual(rejections.filter((type) => type !== 'METHOD_NOT_FOUND'), []);
  assert.deepEqual(errors.filter((message) => message !== 'Object'), []);
  for(const {token} of customers) assert(!logs.join('\n').includes(token), 'tokens must not appear in console logs');
  assert.deepEqual([...paths], ['/exact/socket?widget=1']);
  // The pins come from index.html: the widget never loads the BlahDiem runtime.
  assert(!urls.some((url) => url.includes('/assets/img/emoji/')));
  // Text uses system fonts; only the icon font ships.
  assert.deepEqual(urls.filter((url) => /\.(woff2?|ttf|otf)\b/.test(url) && !url.includes('/assets/fonts/tgico.ttf')), []);
  const local = [origin, origin.replace('127.0.0.1', 'localhost'), 'blob:', 'data:'];
  assert.deepEqual(urls.filter((url) => !local.some((prefix) => url.startsWith(prefix))), []);
  console.log('Widget browser checks passed: real token auth, support-first send/reply, reload, single-chat restrictions, token switch/logout across loads and hash changes, revoked/missing/invalid tokens, cross-origin iframe layout, light/dark theme variables, no BlahDiem.');
} catch(error) {
  await writeFile('/tmp/widget-server.log', serverLog);
  await mkdir(repo + '/tmp/widget', {recursive: true});
  await browser?.contexts()[0]?.pages()[0]?.screenshot({path: repo + '/tmp/widget/failure.png'}).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  if(child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  proxy.close(); edge?.close();
  await rm(dir, {recursive: true, force: true});
}
