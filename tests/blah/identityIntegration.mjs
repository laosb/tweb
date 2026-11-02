import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {pasteWords} from './recoveryWords.mjs';
import {checkIdentityLayout} from './identityLayout.mjs';

export const inspectIdentity = (page) => page.evaluate(() => window.rootScope.managers.appAccountManager.blahIdentity({action: 'inspect'}));
export const sessionDevices = (page) => page.evaluate(async() => (await window.rootScope.managers.apiManager.invokeApi('blah.getSessionDevices')).sessions);

export async function signInWords({browser, origin, domain, words, http = false}) {
  const context = await browser.newContext({ignoreHTTPSErrors: true});
  const page = await context.newPage();
  await page.goto(origin + '/?noServiceWorker=1&a11y=1' + (http ? '&http=1' : ''));
  await page.getByRole('textbox', {name: 'DC domain', exact: true}).fill('dc.example.org');
  await page.getByRole('button', {name: 'Connect to Blah', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Blah', exact: true, level: 1})).toBeFocused();
  await page.getByRole('button', {name: 'Sign In with Recovery Words', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Your Blah address', exact: true, level: 1})).toBeVisible();
  await expect(page.getByRole('textbox', {name: 'Profile domain', exact: true})).toBeFocused();
  await page.getByRole('textbox', {name: 'Profile domain', exact: true}).fill(domain);
  await page.getByRole('button', {name: 'Continue', exact: true}).click();
  await expect(page.locator('input[list]')).toHaveCount(24);
  await expect(page.getByRole('heading', {name: 'Enter Recovery Words', exact: true, level: 1})).toBeVisible();
  await expect(page.locator('input[list]').first()).toBeFocused();
  await checkIdentityLayout(page);
  await pasteWords(page, words);
  await page.getByRole('button', {name: 'Continue', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Sign in to Blah', exact: true, level: 1})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Export public profile', exact: true})).toBeFocused();
  await page.getByRole('button', {name: 'Sign in to Blah', exact: true}).click();
  await page.locator('#page-chats').waitFor();
  return {context, page};
}

export async function checkSessionTermination(page) {
  const before = await sessionDevices(page);
  assert.equal(before.length, 3);
  const victim = before.find((entry) => String(entry.hash) !== '0');
  const refusal = await page.evaluate(async(hash) => {
    try { await window.rootScope.managers.apiManager.invokeApi('account.resetAuthorization', {hash}, {ignoreErrors: true, rawError: true}); return ''; }
    catch(error) { return error.type; }
  }, victim.hash);
  assert.equal(refusal, 'DEVICE_STILL_LISTED');
  assert.equal(await page.evaluate((hash) => window.rootScope.managers.appAccountManager.resetAuthorization(hash), victim.hash), true);
  const after = await sessionDevices(page);
  assert.equal(after.length, 2);
  assert(!after.some((entry) => String(entry.hash) === String(victim.hash)));
  assert.equal(await page.evaluate(() => window.rootScope.managers.appAccountManager.resetAuthorizations()), true);
  assert.equal((await sessionDevices(page)).length, 1);
  assert.equal((await inspectIdentity(page)).identity.devices.length, 1);
  console.log('PASS holder publish-then-reset for one and all other sessions.');
}

export async function logoutAndCheck(page) {
  // The manager follows the same ordinary logout path as Settings.
  await page.evaluate(() => { void window.rootScope.managers.apiManager.logOut(); });
  await expect.poll(() => page.evaluate(async() => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('blah-device-custody-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve) => {
        const request = db.transaction('vault').objectStore('vault').get('custody:slot:1');
        request.onsuccess = () => resolve(!!request.result);
      });
    } finally { db.close(); }
  }).catch(() => true)).toBe(false);
}

export async function checkChatIdentity({page, recovery, publishProfile}) {
  const chat = await page.evaluate(async() => {
    const manager = window.rootScope.managers.appAccountManager;
    const {words} = await manager.blahIdentity({action: 'generateWords'});
    const result = await manager.blahChatIdentity({action: 'prepare', domain: 'news.alice.example.org', phrase: words.join(' '), attempt: 'real-chat'});
    return {...result, words};
  });
  await publishProfile(chat.identity.domain, Buffer.from(chat.identity.profile));
  const bound = await page.evaluate((id) => window.rootScope.managers.appAccountManager.blahChatIdentity({action: 'bind', id,
    change: {action: 'createChannel', options: {title: 'Recovery words chat', about: '', broadcast: true}}}), chat.identity.id);
  await publishProfile(bound.identity.domain, Buffer.from(bound.identity.profile));
  const restored = await recovery.evaluate(({domain, words}) => window.rootScope.managers.appAccountManager.blahIdentity({
    action: 'restore', kind: 'channel', domain, phrase: words.join(' ')}), {domain: bound.identity.domain, words: chat.words});
  assert.equal(restored.identity.id, chat.identity.id);
  assert.equal(restored.identity.account, String(bound.result.chatId));
  assert.equal(restored.identity.devices.length, 2);
  await publishProfile(restored.identity.domain, Buffer.from(restored.identity.profile));
  const shown = await recovery.evaluate((id) => window.rootScope.managers.appAccountManager.blahIdentity({action: 'words', id}), chat.identity.id);
  assert.deepEqual(shown.words, chat.words);
  console.log('PASS chat identity creation, server binding, restore and showing recovery words.');
}
