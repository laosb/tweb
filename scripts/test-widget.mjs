// Production widget, in an iframe, against a disposable Blah DC. No live accounts.
import assert from 'node:assert/strict';
import {randomBytes, createHash} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {createServer} from 'node:https';
import {createServer as tcpServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'vite';
import {chromium, webkit, expect as baseExpect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import httpProxy from 'http-proxy';
import {cbor} from '../tests/blah/cbor.mjs';
import {objectStorage} from '../tests/widget/objectStorage.mjs';

// The full client takes a few seconds to restore after a reload.
const expect = baseExpect.configure({timeout: 20_000});
const repo = fileURLToPath(new URL('../', import.meta.url));
const transport = process.env.WIDGET_TEST_TRANSPORT || 'auto';
assert(['auto', 'http', 'ws'].includes(transport));
const transportQuery = transport === 'http' ? 'http=1' : transport === 'ws' ? 'noMultipleTransports=1' : '';
let httpRequests = 0;
const widgetDist = process.env.WIDGET_DIST || repo + '/dist/widget';
const browserName = process.env.WIDGET_BROWSER || 'chromium';
assert(['chromium', 'webkit'].includes(browserName), 'WIDGET_BROWSER must be chromium or webkit');
const tele = process.env.BLAH_SERVER_REPO;
if(!tele) throw new Error('Set BLAH_SERVER_REPO to a checkout with a built debug BlahMTProtoServer.');
const dir = await mkdtemp(join(tmpdir(), 'blah-widget-'));
const artifacts = process.env.WIDGET_TEST_ARTIFACTS || repo + '/tmp/widget';
await mkdir(artifacts, {recursive: true});
const proxy = httpProxy.createProxyServer({ws: true});
let child, browser, edge;
const storage = await objectStorage();
const errors = [], logs = [], mediaErrors = [];
const optionalFixtureErrors = ['METHOD_NOT_FOUND', 'METHOD_NOT_IMPLEMENTED'];
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
  await writeFile(dir + '/local.json', JSON.stringify({options: {supportUserId: support.id, supportName: 'Customer Care'},
    applications: [{id: 12345, ownerUserID: support.id, apiHashVerifier: createHash('sha256').update('Blah/app-hash:1:12345:' + 'ab'.repeat(16)).digest('hex')}]}));
  const startDC = async() => {
    child = spawn(process.env.BLAH_SERVER_BINARY || tele + '/.build/debug/BlahMTProtoServer', [
      '--port', String(port), '--web-port', String(webPort), '--data-db', dir + '/data.sqlite',
      '--auth-db', dir + '/auth.sqlite', '--jobs-db', dir + '/jobs.sqlite', '--db', dir + '/transport.sqlite',
      '--s3-endpoint', storage.url, '--s3-region', 'us-east-1', '--s3-bucket', 'widget',
      '--s3-access-key', 'widget', '--s3-secret-key', 'widget-fixture-only',
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

  if(!process.env.WIDGET_SKIP_BUILD) await build({configFile: repo + '/vite.widget.config.ts', logLevel: 'warn'});
  await build({configFile: repo + '/vite.widget.config.ts', logLevel: 'warn',
    ...(transport === 'http' ? {define: {'import.meta.env.VITE_MTPROTO_HAS_WS': 'false', 'import.meta.env.VITE_MTPROTO_HTTP': 'true', 'import.meta.env.VITE_MTPROTO_AUTO': 'false'}} : {}), build: {
    outDir: dir + '/driver', lib: {entry: repo + '/tests/widget/driver.ts', formats: ['es'], fileName: () => 'driver.js'}
  }});
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', dir + '/tls.key',
    '-out', dir + '/tls.crt', '-days', '1', '-subj', '/CN=localhost'], {stdio: 'ignore'});
  const rsa = JSON.parse(await readFile(tele + '/Schemas/blah-rsa-key.json', 'utf8'));
  const template = await readFile(widgetDist + '/index.html', 'utf8');
  const pins = (html) => {
    const meta = {'dc-id': config.dcId, 'dc-url': config.url, 'rsa-modulus': config.rsaKey.modulus, 'rsa-exponent': config.rsaKey.exponent, 'api-id': config.apiId, 'api-hash': config.apiHash};
    for(const [name, value] of Object.entries(meta)) html = html.replace(new RegExp('(name="blah-widget-' + name + '" content=")[^"]*'), '$1' + value);
    return html;
  };
  const types = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json'};
  const paths = new Set(), requests = [], missing = [];
  edge = createServer({key: await readFile(dir + '/tls.key'), cert: await readFile(dir + '/tls.crt')}, async(req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'https://localhost').pathname);
    // The authorizer races HTTP and WebSocket; serve both transport endpoints.
    if(['POST', 'OPTIONS'].includes(req.method) && /^\/apiw?1?(?:_test)?$/.test(path)) {
      if(req.method === 'POST') ++httpRequests;
      proxy.web(req, res, {target: 'http://127.0.0.1:' + port});
      return;
    }
    requests.push(path);
    try {
      let body, type;
      if(path === '/favicon.ico') {
        res.writeHead(204); res.end(); return;
      } else if(path === '/host') {
        body = '<!doctype html><html lang="en"><head><title>Widget host</title></head><body><iframe title="Customer support" name="customer-feedback" src="' + origin + '/?' + transportQuery + '" style="border:0;width:390px;height:640px"></iframe></body></html>';
        type = 'text/html';
      } else if(path === '/' || path === '/index.html') {
        body = pins(template);
        type = 'text/html';
      } else if(path === '/driver') {
        // The driver's @config/blah reads the same pins from its document.
        body = pins(template.replace(/<script type="module"[^>]*><\/script>/g, '').replace(/<body[\s\S]*<\/body>/, '<body><script type="module" src="/driver/driver.js"></script></body>'));
        type = 'text/html';
      } else if(/^\/[\w./@-]+$/.test(path) && !path.includes('..')) {
        body = await readFile(path.startsWith('/driver/') ? dir + path : widgetDist + path);
        type = types[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream';
      } else { missing.push(path); res.writeHead(404); res.end(); return; }
      res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store'}); res.end(body);
    } catch{ missing.push(path); res.writeHead(404); res.end(); }
  });
  edge.on('upgrade', (req, socket, head) => {
    paths.add(req.url);
    assert.equal(req.url, '/exact/socket?widget=1');
    // Preserve the configured public path, then route to the DC's transport endpoint.
    req.url = '/apiws';
    // A browser may reset an upgraded TLS socket when it closes a frame.
    socket.on('error', error => { if(error.code !== 'ECONNRESET') logs.push('SOCKET_ERROR ' + error.message); });
    proxy.ws(req, socket, head, {target: 'ws://127.0.0.1:' + port});
  });
  proxy.on('error', () => {});
  edge.listen(0, '127.0.0.1'); await once(edge, 'listening');
  const origin = 'https://127.0.0.1:' + edge.address().port;
  const config = {dcId: 1, url: origin.replace('https:', 'wss:') + '/exact/socket?widget=1', rsaKey: {modulus: rsa.n, exponent: rsa.e}, apiId: 12345, apiHash: 'ab'.repeat(16)};
  browser = await ({chromium, webkit})[browserName].launch({headless: true, executablePath: process.env.BLAH_BROWSER_EXECUTABLE,
    ...(browserName === 'chromium' ? {args: ['--no-sandbox', '--ignore-certificate-errors']} : {})});
  const context = await browser.newContext({ignoreHTTPSErrors: true});
  context.setDefaultTimeout(35_000);
  // The full client also calls Telegram methods a Blah DC does not implement; those
  // rejections are expected, any other uncaught error is not.
  await context.addInitScript(({optionalErrors, transportQuery, origin}) => {
    // Account logout discards query parameters. Reapply this run's chosen transport
    // before startup on each document, including the otherwise tokenless entry.
    if(location.origin === origin && transportQuery) {
      const url = new URL(location.href);
      for(const [key, value] of new URLSearchParams(transportQuery)) url.searchParams.set(key, value);
      history.replaceState(null, '', url);
    }
    addEventListener('unhandledrejection', (event) => {
      console.log('REJECTION ' + (event.reason?.type || event.reason?.stack || event.reason));
      // Keep unsupported optional DC methods in the log, without Chromium's untyped
      // 'Object' pageerror obscuring actual UI errors in the menu checks below.
      if(optionalErrors.includes(event.reason?.type)) event.preventDefault();
    });
  }, {optionalErrors: optionalFixtureErrors, transportQuery, origin});
  const page = await context.newPage(), urls = [];
  page.on('crash', () => logs.push('PAGE_CRASH'));
  page.on('pageerror', (err) => errors.push({message: err.message, stack: err.stack}));
  page.on('console', (msg) => {
    logs.push(msg.text());
    if(msg.text().startsWith('MEDIA_ERROR ')) mediaErrors.push(msg.text());
  });
  context.on('request', (request) => urls.push(request.url()));
  context.on('requestfailed', request => logs.push('REQUEST_FAILED ' + request.url() + ' ' + request.failure()?.errorText));
  // Different hostnames exercise cross-origin iframe storage and embedding.
  await page.goto(origin.replace('127.0.0.1', 'localhost') + '/host');
  const frame = page.frameLocator('iframe');
  const widgetFrame = () => page.frames().find((frame) => frame.parentFrame());
  const status = frame.locator('#widget [role="status"]'), alert = frame.locator('#widget [role="alert"]');
  const title = frame.locator('#column-center .chat .topbar .peer-title');
  const header = frame.locator('.chat.active .topbar');
  const assertHeader = async() => {
    await expect(header.locator('.person > .content > .bottom, .info')).toHaveCount(0);
    const centered = await header.evaluate(el => {
      const title = el.querySelector('.user-title').getBoundingClientRect();
      const person = el.querySelector('.person').getBoundingClientRect();
      return Math.abs((title.top + title.bottom - person.top - person.bottom) / 2);
    });
    expect(centered).toBeLessThanOrEqual(2);
  };
  const bubble = (text) => frame.locator('#column-center .bubble[data-mid]').filter({hasText: text});
  const send = async(text) => {
    await frame.getByRole('textbox', {name: 'Message'}).click();
    await page.keyboard.insertText(text);
    await page.keyboard.press('Enter');
    await expect(bubble(text)).toBeVisible();
    await expect(bubble(text)).not.toHaveClass(/is-outgoing|is-error/);
  };
  await expect(status).toContainText('requires a customer token');
  const navigate = async(token, reload = false) => {
    await Promise.all([widgetFrame().waitForNavigation(), page.locator('iframe').evaluate((iframe, url) => { iframe.src = url; },
      origin + '/?debug=1&test=1&' + transportQuery + (reload ? '&reload=1' : '') + '#token=' + encodeURIComponent(token))]);
  };
  const driver = await context.newPage();
  const driverErrors = [];
  driver.on('pageerror', (err) => driverErrors.push(err.message));
  driver.on('console', msg => logs.push('DRIVER ' + msg.text()));
  driver.on('console', (msg) => driverErrors.push(msg.text()));
  await driver.goto(origin + '/driver?' + transportQuery);
  await driver.waitForFunction(() => !!window.widgetTestDriver).catch((error) => { throw new Error(driverErrors.join('\n') || error.message); });
  await driver.evaluate(async({config, token}) => window.widgetTestDriver.connect(config, token).catch(error => { throw new Error(JSON.stringify(error, Object.getOwnPropertyNames(error || {}))); }), {config, token: support.token});

  await page.bringToFront();
  await navigate(alice.token);
  await expect(title).toHaveText('Customer Care');
  const slots = await widgetFrame().evaluate(() => [1, 2, 3, 4].map(slot => {
    const account = JSON.parse(localStorage.getItem('account' + slot) || '{}');
    return {slot, authorized: !!account.userId, hasAuthKey: Object.keys(account).some(key => /_auth_key$/.test(key) && account[key])};
  }));
  assert.deepEqual(slots.map(slot => slot.hasAuthKey), [true, false, false, false]);
  console.log('Account slots (no keys logged):', JSON.stringify(slots));

  // Exercise the real header and composer across both responsive breakpoints.
  for(const width of [280, 390, 800]) {
    await page.locator('iframe').evaluate((el, width) => el.style.width = width + 'px', width);
    for(const theme of ['light', 'dark']) {
      await page.emulateMedia({colorScheme: theme});
      for(const rtl of [false, true]) {
        await frame.locator('html').evaluate((el, rtl) => { el.dir = rtl ? 'rtl' : 'ltr'; el.classList.toggle('is-rtl', rtl); }, rtl);
        await assertHeader();
        await expect(frame.locator('.chat.active .topbar .sidebar-close-button')).toBeHidden();
        await expect(frame.locator('.chat.active .topbar .chat-info')).toHaveCSS('padding-inline-start', '0px');
        await expect(frame.locator('.chat.active .topbar')).toHaveCSS('--topbar-close-active-size', '0px');
        const input = frame.getByRole('textbox', {name: 'Message'});
        for(const typed of [false, true]) {
          await input.fill(typed ? 'Hello from the composer' : '');
          await page.waitForTimeout(350);
          if(process.env.WIDGET_LAYOUT_SCREENSHOTS) await page.locator('iframe').screenshot({path: `${artifacts}/${width}-${theme}-${rtl ? 'rtl' : 'ltr'}-${typed ? 'typed' : 'idle'}.png`});
        }
        await input.fill('');
      }
    }
  }
  await frame.locator('html').evaluate(el => { el.dir = 'ltr'; el.classList.remove('is-rtl'); });
  await page.emulateMedia({colorScheme: 'light'});
  await page.locator('iframe').evaluate(el => el.style.width = '390px');

  await frame.locator('#column-center .chat.active .attach-file').click();
  const attachmentMenu = frame.getByRole('menu').filter({has: frame.getByRole('menuitem', {name: 'Document', exact: true})});
  await expect(attachmentMenu).toBeVisible();
  const titleBox = await title.boundingBox();
  await page.mouse.click(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
  await expect(attachmentMenu).not.toBeVisible();
  console.log('PASS attachment menu opens on click and closes');
  // Exercise the real file picker handler and popup Send button, independently of
  // the attachment menu's opening gesture.
  await widgetFrame().evaluate(() => window.rootScope.addEventListener('message_error', event => console.log('MEDIA_ERROR ' + JSON.stringify(event.error, Object.getOwnPropertyNames(event.error || {})))));
  const photo = await widgetFrame().evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#235347';
    ctx.fillRect(0, 0, 64, 64);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const sendFiles = async(files, caption, type, asDocument = false) => {
    const [picker] = await Promise.all([page.waitForEvent('filechooser'),
      widgetFrame().evaluate(document => window.appImManager.chat.input.onAttachClick(document, !document, !document), asDocument)]);
    console.log('Sending media:', Array.isArray(files) ? files.map(file => file.name).join(', ') : files.name);
    await picker.setFiles(files);
    await expect(frame.locator('.popup-new-media')).toBeVisible();
    await frame.locator('.popup-new-media [contenteditable="true"]').fill(caption);
    await frame.locator('.popup-new-media').getByRole('button', {name: 'Send', exact: true}).click();
    await expect(frame.locator('.popup-new-media')).toHaveCount(0);
    await expect(async() => {
      const history = await driver.evaluate(id => window.widgetTestDriver.history(id), alice.id);
      expect(history.messages?.filter(message => message.message === caption && message.media?._ === type)).toHaveLength(1);
    }).toPass({timeout: 20_000});
    if(caption) await expect(bubble(caption)).not.toHaveClass(/is-outgoing|is-error/);
    console.log('Media delivered:', caption);
  };
  await sendFiles({name: 'first-photo.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64')},
    '', 'messageMediaPhoto');
  await sendFiles({name: 'widget-photo.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64')},
    'Widget photo regression', 'messageMediaPhoto');
  await sendFiles([
    {name: 'album-one.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64')},
    {name: 'album-two.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64')}
  ], 'Widget album regression', 'messageMediaPhoto');
  await expect(bubble('Widget album regression').locator('.album-item')).toHaveCount(2);
  const largePhoto = await widgetFrame().evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 3200; canvas.height = 2400;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 3200, 2400);
    gradient.addColorStop(0, '#235347'); gradient.addColorStop(1, '#fafafa');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 3200, 2400);
    return canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
  });
  await sendFiles({name: 'large-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(largePhoto, 'base64')},
    'Widget resized photo', 'messageMediaPhoto');
  // WebKit has no VP9 encoder; Playwright Chromium may lack an H.264 decoder.
  const video = browserName === 'webkit' ? await readFile(repo + '/src/tests/fixtures/ephemeralBot/media/video.mp4') :
    Buffer.from(await driver.evaluate(() => window.widgetTestDriver.videoFixture()));
  const videoType = browserName === 'webkit' ? 'mp4' : 'webm';
  await sendFiles({name: 'widget-video.' + videoType, mimeType: 'video/' + videoType, buffer: video},
    'Widget video regression', 'messageMediaDocument');
  await sendFiles({name: 'widget-file.txt', mimeType: 'text/plain', buffer: Buffer.from('Widget file bytes')},
    'Widget file regression', 'messageMediaDocument', true);

  for(const [caption, bytes] of [
    ['Widget photo regression', Buffer.from(photo, 'base64')],
    ['Widget video regression', video],
    ['Widget file regression', Buffer.from('Widget file bytes')]
  ]) {
    const downloaded = await driver.evaluate(({id, caption}) => window.widgetTestDriver.mediaBytes(id, caption), {id: alice.id, caption});
    assert.deepEqual(Buffer.from(downloaded), bytes, caption + ' downloads from the DC');
  }

  await send('A customer can ask for help first.');
  // Emoji use the system font; the release has no emoji images.
  await send('Thanks 👋');
  await expect(bubble('Thanks 👋').locator('.emoji-native')).toHaveCount(1);
  await expect(bubble('Thanks 👋').locator('img.emoji')).toHaveCount(0);
  await driver.evaluate(id => window.widgetTestDriver.read(id), alice.id);
  // Wait for the actual server read cursor, so a sent icon alone cannot pass early.
  await expect.poll(() => widgetFrame().evaluate(() => {
    const chat = window.appImManager.chat;
    return chat.getHistoryStorage().readOutboxMaxId >= Number(
      [...document.querySelectorAll('.bubble[data-mid]')].find(el => el.textContent.includes('Thanks 👋')).dataset.mid);
  })).toBe(true);
  const assertSent = async() => {
    for(const text of ['A customer can ask for help first.', 'Thanks 👋', 'Widget photo regression', 'Widget video regression', 'Widget file regression', 'Widget album regression']) {
      await expect(bubble(text)).toHaveClass(/is-sent/);
      await expect(bubble(text)).not.toHaveClass(/is-read/);
      await expect(bubble(text).locator('.time-inner > .time-sending-status')).toHaveCount(1);
      await expect(bubble(text).locator('.time-inner > .time-sending-status')).toHaveClass(/sending-status-is-sent/);
      await expect(bubble(text).locator('.time-inner > .time-sending-status')).toHaveAttribute('aria-hidden', 'true');
    }
    await expect(frame.locator('.bubble.is-read, .bubble .sending-status-is-read, .bubble [aria-label*="read" i]')).toHaveCount(0);
    await assertHeader();
  };
  await assertSent();
  await bubble('Thanks 👋').scrollIntoViewIfNeeded();
  await page.locator('iframe').screenshot({path: artifacts + '/read-outgoing-single-check.png'});
  await Promise.all([widgetFrame().waitForNavigation(), widgetFrame().evaluate(() => location.reload())]);
  await expect(bubble('A customer can ask for help first.')).toBeVisible();
  await assertSent();
  assert(new URL(widgetFrame().url()).hash.startsWith('#token='), 'opening the chat keeps the token in the fragment');

  await bubble('Widget video regression').scrollIntoViewIfNeeded();
  await expect.poll(() => bubble('Widget video regression').locator('video').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
  await expect(bubble('Widget file regression').getByText('widget-file.txt', {exact: true})).toHaveCount(1);
  await expect.poll(() => bubble('Widget photo regression').locator('img.media-photo').last().evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  for(const rtl of [false, true]) {
    await widgetFrame().evaluate(rtl => window.I18n.forceRTL(rtl), rtl);
    await bubble('Widget photo regression').scrollIntoViewIfNeeded();
    const selectable = bubble('Widget photo regression');
    const errorsBeforeMenu = errors.length;
    await selectable.getByText('Widget photo regression', {exact: true}).click({button: 'right'});
    const contextMenu = frame.locator('#bubble-contextmenu');
    await expect(contextMenu).toBeVisible();
    await expect(contextMenu.getByText('Reply', {exact: true})).toBeVisible();
    await expect(contextMenu.getByText('Select', {exact: true})).toHaveCount(0);
    await expect(contextMenu.getByText(/seen|read time|read date/i)).toHaveCount(0);
    assert.equal(await widgetFrame().evaluate(() => window.appImManager.chat.contextMenu.buttons.some(button => button.localName === 'views')), false);
    const strip = contextMenu.locator('.btn-menu-reactions-reaction');
    await expect.poll(async() => (await strip.evaluateAll(elements => elements.map(e => e.getAttribute('aria-label'))))
      .map(label => ({'Thumbs Up': '👍', 'Thumbs Down': '👎', 'Red Heart': '❤', 'HUNDRED POINTS SYMBOL': '💯', 'ROLLING ON THE FLOOR LAUGHING': '🤣', 'EYES': '👀'}[label] || label)))
      .toEqual(['👍', '👎', '❤', '💯', '🤣', '👀']);
    for(let i = 0; i < 3; ++i) await expect(strip.nth(i).locator('.btn-menu-reactions-reaction-select canvas')).toBeVisible({timeout: 30_000});
    if(process.env.BLAH_MENU_SCREENSHOTS) {
      await page.waitForTimeout(600);
      await page.screenshot({path: `${process.env.BLAH_MENU_SCREENSHOTS}/widget-menu-${rtl ? 'rtl' : 'ltr'}.png`});
    }
    await page.keyboard.press('Escape');
    await expect(contextMenu).not.toBeVisible();
    assert.deepEqual(errors.slice(errorsBeforeMenu), [], 'right-click opens the real menu without pageerror');
    assert.equal(await widgetFrame().evaluate(() => window.appImManager.chat.topbar.menuButtons.some(button => button.text === 'Chat.Menu.SelectMessages')), false);
    await selectable.locator('.time').dispatchEvent('click');
    await selectable.getByText('Widget photo regression', {exact: true}).click({modifiers: ['Shift']});
    await selectable.getByText('Widget photo regression', {exact: true}).click({modifiers: ['Control']});
    const start = await selectable.boundingBox(), end = await bubble('Widget resized photo').boundingBox();
    await page.mouse.move(start.x + 3, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + 3, end.y + end.height / 2, {steps: 8});
    await page.mouse.up();
    await widgetFrame().evaluate(() => {
      const {selection} = window.appImManager.chat;
      const element = document.querySelector('#column-center .bubble[data-mid]');
      selection.toggleSelection(true, true);
      selection.toggleByElement(element);
      selection.enterReportSelection({option: new Uint8Array([1])});
      if(!selection.canSelectBubble(element)) throw new Error('Widget disabled the reaction predicate');
    });
    await expect(frame.locator('.selection-wrapper, .bubble-select-checkbox')).toHaveCount(0);
    assert.equal(await widgetFrame().evaluate(() => window.appImManager.chat.selection.isSelecting), false);
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Escape');
    await expect(frame.locator('.selection-wrapper, .bubble-select-checkbox')).toHaveCount(0);
  }
  await widgetFrame().evaluate(() => window.I18n.forceRTL(false));

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
  await page.screenshot({path: artifacts + '/iframe.png'});
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
  await page.screenshot({path: artifacts + '/iframe-dark.png'});
  await page.emulateMedia({colorScheme: 'light'});
  await page.locator('iframe').evaluate((iframe) => { iframe.style.width = '280px'; iframe.style.height = '480px'; });
  assert(await frame.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth));

  // A new document must retire the saved authorization before switching users.
  await navigate(bob.token, true);
  await expect(title).toHaveText('Customer Care');
  await expect(bubble('A customer can ask for help first.')).toHaveCount(0);
  const database = new DatabaseSync(dir + '/data.sqlite');
  await expect.poll(() => database.prepare('SELECT count(*) AS n FROM authorizations WHERE user_id = ?').get(alice.id).n).toBe(0);
  await expect.poll(() => widgetFrame().evaluate(() => window.rootScope?.myId)).toBe(bob.id);
  await send('A separate customer.');
  // Changing just the hash uses the same transition while the document lives.
  await Promise.all([widgetFrame().waitForNavigation(), widgetFrame().evaluate((token) => { location.hash = 'token=' + encodeURIComponent(token); }, alice.token)]);
  await expect(bubble('A customer can ask for help first.')).toBeVisible();
  await expect(bubble('A separate customer.')).toHaveCount(0);
  await expect.poll(() => database.prepare('SELECT count(*) AS n FROM authorizations WHERE user_id = ?').get(bob.id).n).toBe(0);
  await Promise.all([widgetFrame().waitForNavigation(), widgetFrame().evaluate(() => { location.hash = ''; })]);
  await expect(status).toContainText('requires a customer token');
  await expect.poll(() => database.prepare('SELECT count(*) AS n FROM authorizations WHERE user_id = ?').get(alice.id).n).toBe(0);
  // Revoking a token must also refuse a reload with its previously valid key.
  await navigate(alice.token);
  await expect(bubble('A customer can ask for help first.')).toBeVisible();
  database.prepare('UPDATE users SET bot_token_hash = ? WHERE id = ?')
    .run(createHash('sha256').update(randomBytes(32)).digest('hex'), alice.id);
  await Promise.all([widgetFrame().waitForNavigation(), widgetFrame().evaluate(() => location.reload())]);
  await expect(alert).toContainText('no longer valid');
  await expect(frame.locator('#page-chats')).toBeHidden();
  await expect.poll(() => database.prepare('SELECT count(*) AS n FROM authorizations WHERE user_id = ?').get(alice.id).n).toBe(0);
  database.close();
  await navigate(alice.id + ':' + 'invalid_token_12345678901234567890');
  await expect(alert).toContainText('no longer valid');
  await expect(frame.locator('#page-chats')).toBeHidden();
  const rejections = logs.filter((line) => line.startsWith('REJECTION ')).map((line) => line.slice(10));
  assert.deepEqual(rejections.filter((type) => !optionalFixtureErrors.includes(type)), []);
  assert.deepEqual(mediaErrors, []);
  assert.deepEqual(errors, []);
  for(const {token} of customers) assert(!logs.join('\n').includes(token), 'tokens must not appear in console logs');
  assert.deepEqual([...paths], transport === 'http' ? [] : ['/exact/socket?widget=1']);
  if(transport === 'http') assert(httpRequests > 0);
  if(transport === 'ws') assert.equal(httpRequests, 0);
  console.log('Transport verified:', transport, httpRequests, 'HTTP requests');
  // The pins come from index.html: the widget never loads the BlahDiem runtime.
  assert(!urls.some((url) => url.includes('/assets/img/emoji/')));
  // Everything the client asks for ships in the release.
  assert.deepEqual(missing, []);
  assert.deepEqual(storage.errors, []);
  // The chat sits on a plain color, not the client's wallpaper.
  assert(!urls.some((url) => /\/assets\/img\/pattern\.svg|\/wallpapers?\//.test(url)));
  // Text uses system fonts; only the icon font ships.
  assert.deepEqual(urls.filter((url) => /\.(woff2?|ttf|otf)\b/.test(url) && !url.includes('/assets/fonts/tgico.ttf')), []);
  const local = [origin, origin.replace('127.0.0.1', 'localhost'), 'blob:', 'data:'];
  assert.deepEqual(urls.filter((url) => !local.some((prefix) => url.startsWith(prefix))), []);
  console.log('Widget browser checks passed: real token auth, single checks after server reads and reload (text/media/albums), centered header without subtitle, no read-date menu, captionless photo-first contact, resized photos, video/file upload and download, decoded video after reload, LTR/RTL selection disabled, send/reply, reload, single-chat restrictions, token switch/logout across loads and hash changes, revoked/missing/invalid tokens, cross-origin iframe layout, light/dark theme variables, no BlahDiem.');
} catch(error) {
  await writeFile(artifacts + '/server.log', serverLog);
  await browser?.contexts()[0]?.pages()[0]?.screenshot({path: artifacts + '/failure.png'}).catch(() => {});
  throw error;
} finally {
  await writeFile(artifacts + '/browser.log', JSON.stringify({errors, logs}, null, 2));
  await browser?.close();
  if(child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  proxy.close(); edge?.close();
  storage.server.close();
  if(!process.env.WIDGET_KEEP_FIXTURE) await rm(dir, {recursive: true, force: true});
  else console.log('Fixture retained:', dir);
}
