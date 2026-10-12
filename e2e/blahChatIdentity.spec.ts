import {expect, test} from '@playwright/test';
import {preparePopupSandbox} from './popupSandbox.helpers';
import {expectNoA11yViolations} from './accessibility.helpers';

async function prepare(page: import('@playwright/test').Page, delayed = false) {
  await preparePopupSandbox(page, false, {a11y: true});
  await page.evaluate(async(delayed) => {
    const load = (path: string) => import('/src/' + path);
    const {default: showChatIdentitySetup} = await load('lib/blah/ChatIdentitySetup.tsx');
    const state = (window as any).chatIdentityTest = {calls: [] as string[], result: undefined as unknown, cancelled: false, finish: undefined as (() => void), pending: true};
    const identity = {
      kind: 'channel', id: 'abcdef'.padEnd(64, '0'), domain: 'news.alice.example.org', domains: ['news.alice.example.org'],
      publisher: '', renewal: {profileDays: 180, deviceDays: 180, autoRenew: true}, publicationPending: true,
      notBefore: 1877904000, namespace: '', profile: [1], account: '', expiresAt: 1893456000, devices: [] as unknown[]
    };
    const trigger = document.createElement('button');
    trigger.textContent = 'Open chat identity';
    trigger.onclick = () => {
      void showChatIdentitySetup({domain: identity.domain, attempt: 'test',
        change: {action: 'createChannel', options: {title: 'News', about: '', broadcast: true}},
        action: async(request: {action: string}) => {
          state.calls.push(request.action);
          if(request.action === 'prepare') {
            if(delayed) await new Promise<void>((resolve) => { state.finish = resolve; });
            return {identity, paperKey: {phrase: Array(24).fill('example').join(' '), device: '12345678'}};
          }
          return {identity: {...identity, account: '25'}, result: {chatId: 25, missingInvitees: [] as unknown[]}};
        },
        identityAction: async(request: {action: string}) => {
          state.calls.push(request.action);
          return request.action === 'publication' ? {publication: {profile: [1], pending: state.pending}} : {backup: [1]};
        }
      }).then((result: unknown) => { state.result = result; }, () => { state.cancelled = true; });
    };
    document.body.append(trigger);
  }, delayed);
  await page.getByRole('button', {name: 'Open chat identity', exact: true}).press('Enter');
}

test('chat identity dialog saves backups, binds, checks publication and restores keyboard focus', async({page}) => {
  await prepare(page);
  const dialog = page.getByRole('dialog', {name: 'Cross-server', exact: true});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', {name: 'Create identity', exact: true})).toBeDisabled();
  await dialog.getByLabel('Identity password', {exact: true}).fill('x');
  await dialog.getByLabel('Identity password', {exact: true}).press('Enter');
  await expect(dialog.locator('ol li')).toHaveCount(24);
  await expect(dialog.getByRole('button', {name: 'Save identity file'})).toBeFocused();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', {name: 'Save identity file'}).press('Enter');
  expect((await download).suggestedFilename()).toBe('news.alice.example.org-identity.cbor');
  for(const key of ['Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await expect(dialog).toContainText('https://news.alice.example.org/.well-known/blah/profile.cbor');
  await dialog.getByRole('button', {name: 'New Channel', exact: true}).press('Enter');
  await expect(dialog).toContainText('chat is now bound');
  await expect(dialog.locator('ol li')).toHaveCount(0);
  await dialog.getByRole('button', {name: 'Check publication', exact: true}).press('Enter');
  await expect(dialog.getByRole('status')).toContainText('needs publishing');
  await expectNoA11yViolations(page, '.popup.active');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Open chat identity', exact: true})).toBeFocused();
  expect(await page.evaluate(() => (window as any).chatIdentityTest.result)).toEqual({chatId: 25, missingInvitees: []});
  expect(await page.evaluate(() => (window as any).chatIdentityTest.calls)).toEqual(['prepare', 'backup', 'bind', 'publication', 'lock']);
});

test('cancelling during generation locks late custody without binding or navigating', async({page}) => {
  await prepare(page, true);
  const dialog = page.getByRole('dialog', {name: 'Cross-server', exact: true});
  await dialog.getByLabel('Identity password', {exact: true}).fill('x');
  await dialog.getByRole('button', {name: 'Create identity', exact: true}).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as any).chatIdentityTest.finish());
  await expect.poll(() => page.evaluate(() => (window as any).chatIdentityTest.cancelled)).toBe(true);
  expect(await page.evaluate(() => (window as any).chatIdentityTest.calls)).toEqual(['prepare', 'lock']);
});

test('backup and numbered steps fit a narrow viewport', async({page}) => {
  await page.setViewportSize({width: 320, height: 640});
  await preparePopupSandbox(page, false, {a11y: true});
  for(const step of ['backups', 'numbered']) {
    await page.evaluate((id) => window.popupSandbox.open(id), `blah/cross-server-${step}`);
    const dialog = page.getByRole('dialog', {name: 'Cross-server', exact: true});
    await expect(dialog).toBeVisible();
    const overflow = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({path: `tmp/cross-server-${step}.png`});
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
});
