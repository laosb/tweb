// Exercise the released setup page using real BlahDiem signatures and compiled assets.
// No customer token, server binary, or live DC is needed.
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFile, readdir, mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {loadEnv} from 'vite';
import {blahDiemRuntimeURL} from './blah-config.mjs';
import {cbor} from '../tests/blah/cbor.mjs';
import {makeDCProfile} from '../tests/blah/dcProfile.mjs';

const dist = fileURLToPath(new URL('../dist/widget/', import.meta.url));
const originalIndex = await readFile(dist + 'index.html', 'utf8');
const assets = await readdir(dist + 'assets');
assert(!assets.some(name => /diem|\.wasm$/.test(name)), 'BlahDiem must load from the CDN, not the archive.');
const runtimeURL = blahDiemRuntimeURL(loadEnv('production', fileURLToPath(new URL('../', import.meta.url)), '').BLAH_DIEM_CDN_HOST);
const rsa = generateKeyPairSync('rsa', {modulusLength: 2048}).publicKey;
const identityKey = generateKeyPairSync('ed25519').privateKey.export({format: 'jwk'});
const endpoint = {0: 'dc.example.org', 1: 443, 2: true, 3: 1, 4: '/exact/ws?route=one%2Ftwo&client=widget'};
const data = (overrides = {}) => cbor({0: 13, 1: 1, 2: 5, 3: ['dc.example.org'], 4: [endpoint], 5: [],
  6: rsa.export({type: 'pkcs1', format: 'pem'}), 7: 1, ...overrides});
let generatedIndex, failTemplate = false;
const server = createServer(async(req, res) => {
  try {
    // A subdirectory deliberately exercises all relative release asset URLs.
    const path = new URL(req.url, 'http://localhost').pathname;
    if(!/^\/support\/[\w./-]+$/.test(path) || path.includes('..')) { res.writeHead(404).end(); return; }
    const file = path.slice('/support/'.length);
    if(file === 'index.html' && failTemplate) { res.writeHead(503).end(); return; }
    const body = file === 'index.html' && generatedIndex ? generatedIndex : await readFile(dist + file);
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
    res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store'}).end(body);
  } catch{ res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browserOrigin = 'https://widget-setup-test.blahim.com';
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.BLAH_BROWSER_EXECUTABLE, args: ['--no-sandbox']});
  const context = await browser.newContext();
  const page = await context.newPage();
  // Only fixture pages are intercepted; CDN requests use the real browser CORS policy.
  const serveLocal = async route => {
    const response = await route.fetch({url: route.request().url().replace(browserOrigin, origin)});
    await route.fulfill({response});
  };
  await page.route(browserOrigin + '/**', serveLocal);
  const errors = [], sockets = [], runtimeRequests = new Set();
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('request', request => {
    if(new URL(request.url()).origin === new URL(runtimeURL).origin) runtimeRequests.add(request.url());
  });
  await page.goto(browserOrigin + '/support/setup.html');
  const fixtureOptions = {identityKey, runtimeURL};
  const signed = await page.evaluate(makeDCProfile, {...fixtureOptions, data: data()});
  let profile = Buffer.from(signed.profile), profileStatus = 200, holdProfile;
  await page.route('https://*.example.org/.well-known/blah/profile.cbor', async route => {
    if(holdProfile) await holdProfile;
    await route.fulfill({status: profileStatus, contentType: 'application/cbor', body: profile});
  });
  const download = page.getByRole('button', {name: 'Download index.html'});
  const domain = page.getByLabel('DC profile domain');
  const verify = page.getByRole('button', {name: 'Verify DC'});
  const dcStatus = page.locator('#dc-status');
  const preview = page.frameLocator('#preview');
  await expect(download).toBeDisabled();
  await expect(preview.getByText('Hello! How can we help you today?')).toBeVisible();
  await domain.fill('https://DC.Example.ORG/');
  await domain.press('Enter');
  await expect(dcStatus).toHaveText('DC profile verified.');
  assert.deepEqual([...runtimeRequests].sort(), [runtimeURL, new URL('./diem.wasm', runtimeURL).href].sort());
  await expect(page.locator('#dc-identity')).toHaveText(signed.id);
  await expect(page.locator('#dc-endpoint')).toHaveText('wss://dc.example.org/exact/ws?route=one%2Ftwo&client=widget');

  await page.getByLabel('App ID', {exact: true}).fill('12345');
  await page.getByLabel('App hash', {exact: true}).fill('ab'.repeat(16));
  await page.getByLabel('Accent (light)', {exact: true}).fill('#235347');
  await page.getByLabel('Customer bubble (light)', {exact: true}).fill('#235347');
  await page.getByLabel('Customer bubble (dark)', {exact: true}).fill('#8fd3c1');
  await page.getByLabel('Bubble radius', {exact: true}).fill('8px');
  await page.getByLabel('Chat background (light)', {exact: true}).fill('#f6f2ec');
  await expect(preview.locator('.widget-outgoing .widget-bubble')).toHaveCSS('background-color', 'rgb(35, 83, 71)');
  await expect(preview.locator('.widget-outgoing .widget-bubble')).toHaveCSS('border-radius', '8px');
  await expect(preview.locator('.widget-history')).toHaveCSS('background-color', 'rgb(246, 242, 236)');
  // Dark values apply in dark mode only; a blank one keeps the dark default.
  await page.getByLabel('Dark mode').check();
  await expect(preview.locator('.widget-outgoing .widget-bubble')).toHaveCSS('background-color', 'rgb(143, 211, 193)');
  await expect(preview.locator('.widget-history')).toHaveCSS('background-color', 'rgb(15, 15, 15)');
  await page.getByLabel('Dark mode').uncheck();

  const radius = page.getByLabel('Bubble radius', {exact: true});
  await radius.fill('not-a-length');
  assert.equal(await radius.evaluate(input => input.checkValidity()), false);
  await radius.fill('8px');
  failTemplate = true;
  await download.click();
  await expect(page.locator('#download-status')).toContainText('HTTP 503');
  failTemplate = false;
  const saveIndex = async() => {
    const saved = page.waitForEvent('download');
    await download.click();
    const file = await saved;
    assert.equal(file.suggestedFilename(), 'index.html');
    return readFile(await file.path(), 'utf8');
  };
  generatedIndex = await saveIndex();
  const details = await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return {meta: Object.fromEntries([...doc.querySelectorAll('meta[name^="blah-widget-"]')].map(meta => [meta.name, meta.content])),
      scripts: [...doc.querySelectorAll('script[src]')].map(script => script.getAttribute('src')),
      styles: [...doc.querySelectorAll('link[rel="stylesheet"]')].map(link => link.getAttribute('href'))};
  }, generatedIndex);
  assert.equal(details.meta['blah-widget-dc-id'], '1');
  assert.equal(details.meta['blah-widget-rsa-modulus'], Buffer.from(rsa.export({format: 'jwk'}).n, 'base64url').toString('hex'));
  assert.equal(details.meta['blah-widget-rsa-exponent'], '010001');
  assert.equal(details.meta['blah-widget-api-id'], '12345');
  assert.equal(details.meta['blah-widget-api-hash'], 'ab'.repeat(16));
  for(const path of [...details.scripts, ...details.styles]) assert(originalIndex.includes(path));
  assert(generatedIndex.includes(':root.night {\n--widget-outgoing-bubble-color: #8fd3c1;\n}'));

  // Test the actual downloaded document and the widget runtime together.
  const widget = await context.newPage();
  // Context-level, so the client's shared and service worker scripts are served too.
  await context.route(browserOrigin + '/**', serveLocal);
  widget.on('pageerror', error => errors.push(error.message));
  const widgetSockets = [];
  widget.on('websocket', socket => widgetSockets.push(socket.url()));
  await widget.goto(browserOrigin + '/support/index.html');
  await expect(widget.getByRole('status')).toContainText('requires a customer token', {timeout: 30_000})
  .catch((error) => { throw new Error(errors.join('\n') + '\n' + error.message); });
  assert.equal(await widget.locator('html').evaluate(html => getComputedStyle(html).getPropertyValue('--widget-bubble-radius').trim()), '8px');
  await widget.close();
  // The client may dial its pinned DC before reading the fragment, but nowhere else.
  for(const url of widgetSockets) assert.equal(url, 'wss://dc.example.org/exact/ws?route=one%2Ftwo&client=widget');

  // Regeneration replaces the prior theme and does not duplicate metadata.
  await page.getByRole('button', {name: 'Reset styling'}).click();
  await expect(preview.locator('.widget-outgoing .widget-bubble')).toHaveCSS('border-radius', '16px');
  assert(!(await saveIndex()).includes('--widget-bubble-radius'));
  await domain.focus();
  await page.keyboard.press('Tab');
  await expect(verify).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(domain).toBeFocused();
  const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(axe.violations, []);
  await mkdir(new URL('../tmp/widget/', import.meta.url), {recursive: true});
  await page.screenshot({path: fileURLToPath(new URL('../tmp/widget/setup.png', import.meta.url)), fullPage: true});
  await page.setViewportSize({width: 320, height: 720});
  assert(await page.locator('body').evaluate(body => body.scrollWidth <= body.clientWidth));
  await expect(preview.getByRole('heading', {name: 'Customer support'})).toBeVisible();

  // Invalid signatures, wrong domains, expiry, HTTP failures and insecure-only
  // profiles must all revoke the previous valid configuration.
  const invalid = Buffer.from(signed.profile); invalid[invalid.length - 1] ^= 1;
  const expired = await page.evaluate(makeDCProfile, {...fixtureOptions, data: data(), now: Math.floor(Date.now() / 1000) - 100 * 86400});
  const insecure = await page.evaluate(makeDCProfile, {...fixtureOptions, data: data({4: [{...endpoint, 2: false}]})});
  for(const test of [
    {body: invalid}, {body: Buffer.from(signed.profile), domain: 'other.example.org'},
    {body: Buffer.from(expired.profile)}, {body: Buffer.from(insecure.profile)},
    {body: Buffer.from(signed.profile), status: 503}
  ]) {
    profile = test.body; profileStatus = test.status || 200;
    await domain.fill(test.domain || 'dc.example.org');
    await verify.click();
    await expect(dcStatus).toContainText('Could not verify the DC:');
    await expect(download).toBeDisabled();
    await expect(page.locator('#dc-details')).toBeHidden();
  }
  profile = Buffer.from(signed.profile); profileStatus = 200;
  let releaseProfile;
  holdProfile = new Promise(resolve => { releaseProfile = resolve; });
  await verify.click();
  await expect(dcStatus).toContainText('Fetching');
  await domain.fill('other.example.org');
  releaseProfile();
  holdProfile = undefined;
  await expect(download).toBeDisabled();
  // A fresh verification works after rejected and superseded requests.
  await domain.fill('dc.example.org');
  await verify.click();
  await expect(dcStatus).toHaveText('DC profile verified.');
  await expect(download).toBeEnabled();
  assert.deepEqual(errors, []);
  assert.deepEqual(sockets, [], 'Setup must never open an MTProto connection.');
  console.log('Widget setup: signed discovery, rejection/retry, CSS preview, downloads, relative assets, keyboard, narrow layout and Axe passed.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
