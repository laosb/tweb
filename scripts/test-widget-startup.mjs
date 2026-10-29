// Exercise the real startup boundary and stylesheet with controlled async dependencies.
// This fixture is bundled only here; there are no runtime fault/timeout knobs in the widget.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {compile} from 'sass';
import {chromium, expect} from '@playwright/test';

const repo = fileURLToPath(new URL('../', import.meta.url));
const shots = process.env.WIDGET_STARTUP_SCREENSHOTS || repo + 'tmp/widget-startup';
await mkdir(shots, {recursive: true});
const state = `
const mode = new URLSearchParams(location.search).get('stage');
const counts = {};
let resolve, reject;
const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
export const fixture = window.startupFixture = {counts, resolve, reject};
export async function step(name) {
  counts[name] = (counts[name] || 0) + 1;
  if(mode === name + '-pending') await pending;
  if(mode === name + '-error') throw new Error('private RPC argument: fixture-secret');
}
export const managers = {
  appAccountManager: {importManagedAccountAuthorization: () => step('authorize')},
  appUsersManager: {saveApiUser: () => step('save')},
  apiManager: {
    logOut: () => step('logout'),
    invokeApi: async() => { await step('support'); return {user: {_: 'user', id: 456}}; }
  }
};
`;
const stubs = {
  '@config/blah': 'export default {widget: {param: true}};',
  '@lib/rootScope': 'import {managers} from "fixture-state"; export default {managers};',
  '@lib/accounts/accountController': 'export default {get: async() => ({userId: 123})};',
  '@lib/accounts/getCurrentAccount': 'export const getCurrentAccount = () => 1;',
  '@components/appNavigationController': 'export default {reload: () => location.reload()};',
  '@/widget/restrictions': `import {step} from 'fixture-state'; export const restrictToSupport = () => ({
    setInnerPeer: () => step('open'), chat: {bubbles: {scrollable: {container: document.querySelector('#history')}}}
  });`,
  '@/widget/theme': 'export const applyWidgetTheme = () => {};',
  '@/pages/bootstrapIm': `import {step} from 'fixture-state'; export const bootstrapIm = async() => {
    await step('bootstrap'); document.querySelector('#page-chats').style.display = 'block';
  };`,
  'fixture-state': state
};
const bundle = await build({
  stdin: {contents: `import '@helpers/peerIdPolyfill'; import {startWidget} from '@/widget/index';
    import {fixture} from 'fixture-state'; fixture.done = startWidget({_: 'authStateSignedIn'});`,
  resolveDir: repo, loader: 'ts'}, bundle: true, write: false, format: 'esm',
  plugins: [{name: 'startup-fixture', setup(plugin) {
    plugin.onResolve({filter: /.*/}, args => args.path in stubs ? {path: args.path, namespace: 'fixture'} : undefined);
    plugin.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: stubs[args.path], loader: 'ts'}));
    plugin.onLoad({filter: /\.scss$/}, () => ({contents: '', loader: 'js'}));
  }}]
});
const css = compile(repo + 'src/widget/style.scss').css;
const server = createServer((req, res) => {
  if(req.url === '/fixture.js') res.writeHead(200, {'Content-Type': 'text/javascript'}).end(bundle.outputFiles[0].text);
  else res.writeHead(200, {'Content-Type': 'text/html'}).end(`<!doctype html><html><head>
    <meta name="blah-widget-revision" content="${'a'.repeat(40)}"><style>${css}</style></head><body>
    <div id="widget"></div><div id="page-chats"><div id="history">Support chat</div><button>Send</button></div>
    <script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({executablePath: process.env.BLAH_BROWSER_EXECUTABLE, args: ['--no-sandbox']});
  for(const stage of ['authorize-pending', 'support-pending', 'save-pending', 'bootstrap-pending', 'open-pending', 'support-error', 'save-error', 'bootstrap-error', 'open-error', 'success']) {
    const page = await browser.newPage({viewport: {width: 390, height: 640}});
    const errors = [], logs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => logs.push(message.text()));
    await page.clock.install();
    await page.goto(origin + '/?stage=' + stage + '#token=123:fixture_secret_12345678901234567890');
    const alert = page.getByRole('alert');
    if(stage.endsWith('-pending')) {
      await expect.poll(() => page.evaluate(name => window.startupFixture?.counts[name], stage.split('-')[0])).toBe(1);
      await page.clock.fastForward(45_000);
      await expect(alert).toContainText('took too long');
      await page.evaluate(() => window.startupFixture.resolve());
      await page.clock.runFor(1);
      await expect(alert).toContainText('took too long');
      if(stage === 'authorize-pending') assert.equal(await page.evaluate(() => window.startupFixture.counts.support), undefined);
      if(stage === 'bootstrap-pending') assert.equal(await page.evaluate(() => window.startupFixture.counts.open), undefined);
    } else if(stage.endsWith('-error')) {
      await expect(alert).toHaveText('Could not connect to support. Please try again.');
    } else {
      await expect(page.locator('#widget')).toBeHidden();
      await expect(page.locator('#page-chats')).toBeVisible();
      await page.clock.fastForward(60_000);
      await expect(alert).toHaveCount(0);
    }
    if(stage !== 'success') {
      await expect(page.locator('#page-chats')).toBeHidden();
      assert.equal(await page.locator('#page-chats').evaluate(el => el.inert), true);
      for(const direction of ['ltr', 'rtl']) {
        await page.evaluate(direction => document.documentElement.dir = direction, direction);
        await page.getByRole('button', {name: 'Reconnect'}).focus();
        await page.screenshot({path: `${shots}/${stage}-${direction}.png`});
      }
      assert.equal(await page.evaluate(() => window.startupFixture.counts.logout), undefined);
      assert.equal(await page.evaluate(() => window.startupFixture.counts.authorize), 1);
    }
    assert.deepEqual(errors, []);
    assert(!logs.some(line => line.includes('fixture-secret')));
    assert.equal(logs.filter(line => line === 'Blah widget ' + 'a'.repeat(40)).length, 1);
    if(stage === 'authorize-pending') {
      await Promise.all([page.waitForNavigation(), page.getByRole('button', {name: 'Reconnect'}).click()]);
      await expect(page.getByRole('status')).toContainText('Connecting');
      assert.equal(await page.evaluate(() => window.startupFixture.counts.authorize), 1);
    }
    await page.close();
    console.log('PASS startup:', stage);
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
