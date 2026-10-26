import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

// Runs after the runner's ordinary signup. Profile PUTs and discovery are served
// by its independent HTTPS fixture, never by the DC's bundled profile host.
export async function checkDeviceLink({browser, page, origin, signedDC, identityID, userId, runtimeURL}) {
  const contexts = [];
  const password = 'linked browser password';
  let active = page;

  async function freshBrowser() {
    const context = await browser.newContext({ignoreHTTPSErrors: true});
    contexts.push(context);
    context.setDefaultTimeout(30000);
    await context.route('https://dc.example.org/.well-known/blah/profile.cbor', route => route.fulfill({
      contentType: 'application/cbor', body: Buffer.from(signedDC.profile)
    }));
    const next = await context.newPage();
    active = next;
    await next.goto(origin + '/?noServiceWorker=1&a11y=1');
    await next.getByRole('textbox', {name: 'DC domain', exact: true}).fill('dc.example.org');
    await next.getByRole('button', {name: 'Connect to Blah', exact: true}).click();
    await next.getByRole('button', {name: /Log in by QR code/i}).waitFor({state: 'visible'});
    // Observe the real public manager result used to paint the QR. Chromium has
    // no QR decoder here; approval still goes through the application's paste UI.
    await next.evaluate(() => {
      const bridge = window.apiManagerProxy;
      const invoke = bridge.invoke;
      bridge.invoke = function(...args) {
        const result = invoke.apply(this, args);
        if(args[0] === 'manager' && args[1]?.method === 'blahDeviceLink') {
          result.then(value => {
            if(value.loginToken?._ === 'auth.loginToken' && value.parameter) {
              const token = btoa(String.fromCharCode(...value.loginToken.token)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
              window.deviceLinkTestURL = 'tg://login?token=' + token + '&blah=' + value.parameter;
            }
          }).catch(() => {});
        }
        return result;
      };
    });
    await next.getByRole('button', {name: /Log in by QR code/i}).click();
    return next;
  }

  async function link(owner, next, ownerPassword, transferIdentity) {
    active = next;
    await next.waitForFunction(() => window.deviceLinkTestURL);
    const link = await next.evaluate(() => window.deviceLinkTestURL);
    await next.locator('canvas[class*="qrCanvas"]').waitFor({state: 'visible'});
    const url = new URL(link);
    assert(url.searchParams.get('token'));
    assert(url.searchParams.get('blah'));
    active = owner;
    const ownerDetails = await openDeviceLinkIdentity(owner, ownerPassword, identityID);
    await ownerDetails.getByRole('button', {name: 'Link device by QR code', exact: true}).click();
    const dialog = owner.getByRole('dialog', {name: 'Link device by QR code', exact: true});
    await dialog.getByRole('textbox', {name: /link/i}).fill(link);
    await dialog.getByRole('button', {name: /continue|next/i}).click();
    const transfer = owner.getByRole('checkbox', {name: 'Also let this device approve new devices', exact: true});
    await expect(transfer).toBeChecked();
    await transfer.setChecked(transferIdentity);
    await owner.getByRole('dialog').getByRole('button', {name: /^Log in$|^Link device$/i}).click();
    active = next;
    await next.getByLabel('Identity password', {exact: true}).fill(password);
    await next.getByRole('button', {name: /^Continue$|^Sign in to Blah$/i}).click();
    await next.locator('#page-chats').waitFor({state: 'visible'});
    await next.waitForFunction(() => JSON.parse(localStorage.getItem('account1') || '{}').userId);
    assert.equal(String(await next.evaluate(() => JSON.parse(localStorage.getItem('account1')).userId)), String(userId));
    // Reload discards the opaque in-memory link session and requires real custody.
    await next.reload();
    await next.locator('#page-chats').waitFor({state: 'visible'});
    const result = await inspectLinkedCustody(next, {identityID, password, runtimeURL, userId, origin}, transferIdentity);
    active = owner;
    await owner.keyboard.press('Escape');
    await ownerDetails.waitFor({state: 'detached'});
    await owner.keyboard.press('Escape');
    return result;
  }

  try {
    const deviceOnly = await freshBrowser();
    const withoutIdentity = await link(page, deviceOnly, 'test identity password', false);
    console.log('PASS device-link QR paste: device-only custody survives reload on the original account.');
    const linked = await freshBrowser();
    const withIdentity = await link(page, linked, 'test identity password', true);
    assert.notEqual(withoutIdentity.deviceKey, withIdentity.deviceKey, 'Each browser generates its own device key');
    console.log('PASS device-link QR paste: transferred identity and independent publisher survive reload.');
    const third = await freshBrowser();
    const delegated = await link(linked, third, password, true);
    assert.notEqual(withIdentity.deviceKey, delegated.deviceKey);
    console.log('PASS device-link QR paste: linked browser approves a third browser using transferred custody.');
  } catch(error) {
    console.error('Device-link scenario page:', await active.locator('body').innerText({timeout: 2000}).catch(() => 'unavailable'));
    if(active !== page) console.error('Original approving page:', await page.locator('body').innerText({timeout: 2000}).catch(() => 'unavailable'));
    throw error;
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
}

export async function openDeviceLinkIdentity(owner, ownerPassword, identityID) {
  await owner.locator('.sidebar-tools-button').click();
  await owner.getByRole('menuitem', {name: 'Identity Manager', exact: true}).click();
  const list = owner.locator('.tabs-tab.active').filter({has: owner.getByText('Saved identities', {exact: true})});
  await list.getByRole('button').filter({hasText: identityID}).click();
  const locked = owner.locator('.tabs-tab.active').filter({has: owner.getByRole('button', {name: 'Unlock identity', exact: true})});
  await locked.getByLabel('Identity password', {exact: true}).fill(ownerPassword);
  await locked.getByRole('button', {name: 'Unlock identity', exact: true}).click();
  return owner.locator('.tabs-tab.active').filter({has: owner.getByRole('button', {name: 'Export public profile', exact: true})});
}

export async function inspectLinkedCustody(next, {identityID, password, runtimeURL, userId, origin}, expectedTransfer) {
  const result = await next.evaluate(async({identityID, password, runtimeURL}) => {
    const manager = window.rootScope.managers.appAccountManager;
    await manager.blahIdentity({action: 'unlock', id: identityID, password});
    const {identity} = await manager.blahIdentity({action: 'inspect', id: identityID});
    const {backup} = await manager.blahIdentity({action: 'backup', id: identityID});
    const client = await (await import(runtimeURL)).createDiem();
    const opened = await client.keyFiles.unlock(backup, password);
    try {
      // Return public assertions only; private material stays in the browser.
      return {id: identity.id, domain: opened.contents.domain, account: identity.account,
        identityKey: !!opened.contents.identity, deviceKey: opened.contents.device.publicKey,
        publisher: opened.contents.publisher, pending: !!opened.contents.publicationPending,
        pendingHosting: !!opened.contents.hosting?.pending};
    } finally {
      opened.session.destroy();
      await manager.blahIdentity({action: 'lock', id: identityID});
    }
  }, {identityID, password, runtimeURL});
  assert.equal(result.id, identityID);
  assert.equal(String(result.account), String(userId));
  assert.equal(result.identityKey, expectedTransfer);
  assert.equal(result.pending, false);
  assert.equal(result.pendingHosting, false);
  assert.notEqual(new URL('https://' + result.domain).hostname, 'dc.example.org');
  if(expectedTransfer) assert.equal(result.publisher, origin + '/publish');
  return result;
}
