import {expect, test} from '@playwright/test';
import {preparePopupSandbox} from './popupSandbox.helpers';
import {expectNoA11yViolations, setIncreasedContrast} from './accessibility.helpers';

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

async function prepareDeletion(page: import('@playwright/test').Page, delayed = false) {
  await preparePopupSandbox(page, false, {a11y: true});
  await page.evaluate(async(delayed) => {
    const load = (path: string) => import('/src/' + path);
    const {default: deleteChat} = await load('lib/blah/chatDeletion.tsx');
    const state = (window as any).deletionTest = {calls: [] as string[], result: undefined as unknown, finish: undefined as (() => void)};
    const trigger = document.createElement('button');
    trigger.textContent = 'Delete fixture chat';
    trigger.onclick = () => {
      void deleteChat({
        appChatsManager: {delete: async() => {
          state.calls.push('delete');
          if(state.calls.filter((call) => call === 'delete').length === 1) throw {type: 'BLAH_CHAT_IDENTITY_LOCKED', id: 'chat', domain: 'news.example.org'};
        }},
        appAccountManager: {blahIdentity: async(request: {action: string, password?: string}) => {
          state.calls.push(request.action);
          if(request.action === 'unlock') {
            if(delayed) await new Promise<void>((resolve) => { state.finish = resolve; });
            if(request.password !== 'correct') throw new Error('Wrong password');
          }
          return {};
        }}
      }, 25).then((result: boolean) => { state.result = result; }, (error: Error) => { state.result = error.message; });
    };
    document.body.append(trigger);
  }, delayed);
  await page.getByRole('button', {name: 'Delete fixture chat', exact: true}).press('Enter');
  return page.getByRole('dialog', {name: 'Unlock chat identity', exact: true});
}

test('locked deletion asks for the chat password, retries once, locks and restores focus', async({page}) => {
  await page.setViewportSize({width: 320, height: 640});
  const dialog = await prepareDeletion(page);
  const password = dialog.getByLabel('Identity password', {exact: true});
  await expect(password).toBeFocused();
  await password.fill('wrong');
  await password.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText('Wrong password');
  await setIncreasedContrast(page, true);
  await expectNoA11yViolations(page, '.popup.active');
  for(const key of ['Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await password.fill('correct');
  await dialog.getByRole('button', {name: 'Unlock identity', exact: true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Delete fixture chat', exact: true})).toBeFocused();
  await expect.poll(() => page.evaluate(() => (window as any).deletionTest.result)).toBe(true);
  expect(await page.evaluate(() => (window as any).deletionTest.calls)).toEqual(['delete', 'unlock', 'unlock', 'delete', 'lock']);
});

test('Escape during chat unlock aborts deletion and locks the late result', async({page}) => {
  const dialog = await prepareDeletion(page, true);
  await dialog.getByLabel('Identity password', {exact: true}).fill('correct');
  await dialog.getByRole('button', {name: 'Unlock identity', exact: true}).press('Enter');
  await expect.poll(() => page.evaluate(() => !!(window as any).deletionTest.finish)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as any).deletionTest.finish());
  await expect.poll(() => page.evaluate(() => (window as any).deletionTest.result)).toBe('BLAH_CHAT_CANCELLED');
  expect(await page.evaluate(() => (window as any).deletionTest.calls)).toEqual(['delete', 'unlock', 'lock']);
  await expect(page.getByRole('button', {name: 'Delete fixture chat', exact: true})).toBeFocused();
});

test('closing chat unlock rejects deletion without a success or failure toast', async({page}) => {
  const dialog = await prepareDeletion(page);
  await expect(dialog.getByLabel('Identity password', {exact: true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).deletionTest.result)).toBe('BLAH_CHAT_CANCELLED');
  expect(await page.evaluate(() => (window as any).deletionTest.calls)).toEqual(['delete']);
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Delete fixture chat', exact: true})).toBeFocused();
});

test('deletion explains missing custody and preserves other errors', async({page}) => {
  await preparePopupSandbox(page, false, {a11y: true});
  const results = await page.evaluate(async() => {
    const load = (path: string) => import('/src/' + path);
    const {default: deleteChat} = await load('lib/blah/chatDeletion.tsx');
    const results = [];
    for(const type of ['CHAT_IDENTITY_REQUIRED', 'IDENTITY_PROOF_REQUIRED', 'CHAT_ADMIN_REQUIRED']) {
      const error = {type};
      try {
        results.push(await deleteChat({appChatsManager: {delete: async() => { throw error; }}}, 25));
      } catch(caught) { results.push(caught === error ? true : (caught as Error).message); }
    }
    return results;
  });
  expect(results).toEqual(['BLAH_CHAT_CANCELLED', 'BLAH_CHAT_CANCELLED', true]);
  await expect(page.locator('.toast').last()).toContainText('Import its identity file or use its paper key');
});

for(const direction of ['ltr', 'rtl'] as const) test(`hosted chat keeps backups, paper, claim retries and numbered publication (${direction})`, async({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await preparePopupSandbox(page, false, {a11y: true});
  await page.evaluate((dir) => window.popupSandbox.setDirection(dir), direction);
  await page.evaluate(() => window.popupSandbox.open('blah/hosted-chat'));
  const dialog = page.getByRole('dialog', {name: 'Cross-server', exact: true});
  await dialog.getByLabel('Identity password', {exact: true}).fill('x');
  await dialog.getByRole('textbox', {name: 'Hosting domain', exact: true}).fill('id.example');
  const name = dialog.getByRole('textbox', {name: 'Name', exact: true});
  await name.fill('lost');
  const claim = dialog.getByRole('button', {name: 'Claim and publish', exact: true});
  await expect(claim).toBeEnabled();
  await claim.press('Enter');
  await expect(dialog.getByText('This name is taken. Choose another name.', {exact: true})).toBeVisible();
  await expect(dialog.locator('ol li')).toHaveCount(24);
  await dialog.getByRole('button', {name: 'New Channel', exact: true}).click();
  await expect(dialog.getByText(/needs publishing/)).toBeVisible();
  await name.fill('proof');
  await expect(claim).toBeEnabled();
  await claim.press('Space');
  await expect(claim).toHaveCount(0);
  const backup = dialog.getByRole('button', {name: 'Save identity file', exact: true});
  await expect(backup).toBeFocused();
  const download = page.waitForEvent('download');
  await backup.press('Enter');
  expect((await download).suggestedFilename()).toBe('proof.id.example-identity.cbor');
  for(const key of ['Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await setIncreasedContrast(page, true);
  await expectNoA11yViolations(page, '.popup.active');
  await page.screenshot({path: `test-results/blah-chat-hosting-${direction}.png`});
  await dialog.getByRole('button', {name: 'New Channel', exact: true}).press('Enter');
  await expect(dialog.locator('ol li')).toHaveCount(0);
  await expect(dialog.getByText(/chat is now bound/)).toBeVisible();
  await dialog.getByRole('button', {name: 'Retry publication', exact: true}).click();
  await dialog.getByRole('button', {name: 'Check publication', exact: true}).click();
  await expect(dialog).toHaveCount(0);
});

test('closing hosted chat proof search stops workers and keeps resource backup controls', async({page}) => {
  await preparePopupSandbox(page, false, {a11y: true});
  await page.evaluate(() => {
    const OriginalWorker = window.Worker;
    (window as any).chatProofWorkers = {started: 0, stopped: 0};
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if(String(url).includes('hostingPow')) {
          (window as any).chatProofWorkers.started++;
          const terminate = this.terminate.bind(this);
          this.terminate = () => { (window as any).chatProofWorkers.stopped++; terminate(); };
        }
      }
    };
    void window.popupSandbox.open('blah/hosted-chat');
  });
  const dialog = page.getByRole('dialog', {name: 'Cross-server', exact: true});
  await dialog.getByLabel('Identity password', {exact: true}).fill('x');
  await dialog.getByRole('textbox', {name: 'Hosting domain', exact: true}).fill('id.example');
  await dialog.getByRole('textbox', {name: 'Name', exact: true}).fill('slow');
  await dialog.getByRole('button', {name: 'Claim and publish', exact: true}).click();
  await expect(dialog.getByText(/Finding a proof:/)).toBeVisible();
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(dialog.getByRole('button', {name: 'Save identity file', exact: true})).toBeEnabled();
  await expect(dialog.locator('ol li')).toHaveCount(24);
  await dialog.getByRole('button', {name: 'Claim and publish', exact: true}).click();
  await expect(dialog.getByText(/Finding a proof:/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const {started, stopped} = (window as any).chatProofWorkers;
    return started > 0 && started === stopped;
  })).toBe(true);
});

test('Cross-server form offers hosted names without requiring an own domain', async({page}) => {
  await preparePopupSandbox(page, false, {a11y: true});
  await page.evaluate(async() => {
    const load = (path: string) => import('/src/' + path);
    const {default: rootScope} = await load('lib/rootScope.ts');
    const {default: useCrossServer} = await load('lib/blah/CrossServer.tsx');
    const {render} = await load('vendor/solid/web/dist/web.js');
    rootScope.managers = {...rootScope.managers, appAccountManager: {
      blahIdentity: async(request: {action: string}) => request.action === 'hostingCapability' ? {hostingAvailable: true} : {}
    }};
    const container = document.createElement('div');
    container.id = 'cross-server-form';
    document.body.append(container);
    render(() => {
      const form = useCrossServer();
      const button = document.createElement('button');
      button.textContent = 'Create fixture channel';
      button.onclick = () => { void form.createChannel({title: 'News', about: ''}).catch(() => {}); };
      return [form.row, button];
    }, container);
  });
  const form = page.locator('#cross-server-form');
  await form.getByRole('checkbox').check();
  const choice = form.getByRole('combobox', {name: 'Profile address', exact: true});
  await expect(choice).toBeVisible();
  await expect(form.getByRole('textbox', {name: 'Profile domain', exact: true})).toBeVisible();
  await choice.selectOption('hosted');
  await expect(form.getByRole('textbox', {name: 'Profile domain', exact: true})).toHaveCount(0);
  await form.getByRole('button', {name: 'Create fixture channel', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Cross-server', exact: true});
  await expect(dialog.getByRole('textbox', {name: 'Hosting domain', exact: true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
