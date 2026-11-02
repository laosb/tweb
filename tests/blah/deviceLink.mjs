import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function checkDeviceLink({browser, page, origin, signedDC, identityID, userId}) {
  for(const transferIdentity of [false, true]) {
    const context = await browser.newContext({ignoreHTTPSErrors: true});
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await context.route('https://dc.example.org/.well-known/blah/profile.cbor', (route) => route.fulfill({
        contentType: 'application/cbor', body: Buffer.from(signedDC.profile)}));
      const next = await context.newPage();
      await next.goto(origin + '/?noServiceWorker=1&a11y=1');
      await next.getByRole('textbox', {name: 'DC domain', exact: true}).fill('dc.example.org');
      await next.getByRole('button', {name: 'Connect to Blah', exact: true}).click();
      await next.getByRole('button', {name: 'Sign In with QR Code', exact: true}).click();
      await next.getByRole('button', {name: 'Copy Link', exact: true}).waitFor();
      await next.getByRole('button', {name: 'Copy Link', exact: true}).click();
      const link = await next.evaluate(() => navigator.clipboard.readText());
      await page.locator('.sidebar-tools-button').click();
      await page.getByRole('menuitem', {name: 'Settings', exact: true}).click();
      await page.getByText('Devices', {exact: true}).click();
      await page.getByRole('button', {name: 'Link device by QR code', exact: true}).click();
      const dialog = page.getByRole('dialog', {name: 'Link device by QR code', exact: true});
      await dialog.getByRole('textbox', {name: 'Login link', exact: true}).fill(link);
      await dialog.getByRole('button', {name: 'Continue', exact: true}).click();
      const checkbox = dialog.getByRole('checkbox', {name: 'Allow this device to approve sign-ins', exact: true});
      await expect(checkbox).not.toBeChecked();
      await checkbox.setChecked(transferIdentity);
      await dialog.getByRole('button', {name: 'Log in', exact: true}).click();
      // Manual publishers export the updated public profile before continuing.
      if(await dialog.getByRole('button', {name: 'Export public profile', exact: true}).count()) {
        throw new Error('The device-link fixture requires a configured hosted-name publisher.');
      }
      await next.locator('#page-chats').waitFor();
      await next.reload(); await next.locator('#page-chats').waitFor();
      const result = await next.evaluate(() => window.rootScope.managers.appAccountManager.blahIdentity({action: 'inspect'}));
      assert.equal(result.identity.id, identityID);
      assert.equal(result.identity.account, String(userId));
      assert.equal(result.identity.holder, transferIdentity);
      if(!transferIdentity) {
        await next.locator('.sidebar-tools-button').click();
        await next.getByRole('menuitem', {name: 'Settings', exact: true}).click();
        await next.getByText('Devices', {exact: true}).click();
        await expect(next.getByText('Only devices with the recovery words can manage other sessions.', {exact: false})).toBeVisible();
        await expect(next.getByRole('button', {name: 'Link device by QR code', exact: true})).toHaveCount(0);
        await expect(next.getByRole('button', {name: 'Terminate All Other Sessions', exact: true})).toHaveCount(0);
        const failure = await next.evaluate(async() => {
          try { await window.rootScope.managers.appAccountManager.resetAuthorizations(); return ''; }
          catch(error) { return error.message || String(error); }
        });
        assert.match(failure, /recovery words/);
      }
      console.log('PASS QR sign-in, transfer=' + transferIdentity + (transferIdentity ? '' : ', non-holder gating'));
      await page.reload();
      await page.locator('#page-chats').waitFor();
    } finally { await context.close(); }
  }
}
