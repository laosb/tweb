import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import '@helpers/peerIdPolyfill';
import deferredPromise from '@helpers/cancellablePromise';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), support: vi.fn(), bootstrap: vi.fn(), open: vi.fn(), logout: vi.fn(),
  account: vi.fn(), save: vi.fn(), restrict: vi.fn(), theme: vi.fn(), pack: vi.fn(), language: vi.fn(), prefetch: vi.fn()
}));
vi.mock('@config/blah', () => ({default: {widget: {param: 'pins', lang: undefined as string}}}));
vi.mock('@lib/rootScope', async(importOriginal) => {
  const {default: rootScope} = await importOriginal<typeof import('@lib/rootScope')>();
  Object.assign(rootScope, {managers: {
    appAccountManager: {importManagedAccountAuthorization: mocks.authorize},
    appUsersManager: {saveApiUser: mocks.save},
    apiManager: {logOut: mocks.logout, invokeApi: mocks.support, getConfig: () => mocks.prefetch('getConfig'),
      getAppConfig: () => mocks.prefetch('getAppConfig'), getPeerColors: () => mocks.prefetch('getPeerColors'),
      getPeerProfileColors: () => mocks.prefetch('getPeerProfileColors')},
    appLangPackManager: {getLangPack: mocks.pack, getLanguage: mocks.language}
  }});
  return {default: rootScope};
});
vi.mock('@lib/accounts/bindManagersToAccount', () => ({bindManagersToSession: (managers: unknown) => managers}));
vi.mock('@lib/accounts/accountController', () => ({default: {get: mocks.account}}));
vi.mock('@lib/accounts/getCurrentAccount', () => ({getCurrentAccount: () => 1}));
vi.mock('@components/appNavigationController', () => ({default: {reload: vi.fn()}}));
vi.mock('@/widget/restrictions', () => ({restrictToSupport: mocks.restrict}));
vi.mock('@/widget/theme', () => ({applyWidgetTheme: mocks.theme}));
vi.mock('@/pages/bootstrapIm', () => ({bootstrapIm: mocks.bootstrap}));
import {startWidget} from '@/widget/index';
import blah from '@config/blah';
import rootScope from '@lib/rootScope';
import {applyWidgetLanguage} from '@/widget/langPack';
import I18n from '@lib/langPack';

const signedIn = {_: 'authStateSignedIn'} as const;
const deferred = () => {
  const promise = deferredPromise<void>();
  return {promise, resolve: () => promise.resolve(), reject: (error: unknown) => promise.reject(error)};
};
beforeEach(async() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  document.body.className = '';
  document.body.innerHTML = '<div id="widget"></div><div id="page-chats"><button>Chat control</button></div>';
  location.hash = '#token=123:fixture_secret_12345678901234567890';
  mocks.account.mockResolvedValue({userId: 123});
  mocks.authorize.mockResolvedValue(undefined);
  mocks.support.mockResolvedValue({user: {_: 'user', id: 456}});
  mocks.save.mockResolvedValue(undefined);
  mocks.bootstrap.mockResolvedValue(undefined);
  mocks.open.mockResolvedValue(undefined);
  mocks.restrict.mockReturnValue({setInnerPeer: mocks.open, chat: {bubbles: {scrollable: {container: document.createElement('div')}}}});
  vi.spyOn(rootScope, 'dispatchEvent').mockImplementation(() => {});
  blah.widget.lang = undefined;
  await applyWidgetLanguage();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(['account', 'authorize', 'support', 'save', 'bootstrap', 'open'] as const)('bounds pending %s and ignores its late completion', async(stage) => {
  const pending = deferred();
  mocks[stage].mockReturnValue(pending.promise);
  const started = startWidget(signedIn);
  await vi.advanceTimersByTimeAsync(0);
  // The connecting status keeps the page's pre-script spinner; an error drops it.
  expect(document.querySelector('#widget .widget-spinner + [role="status"]')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(45_000);
  await started;
  expect(document.querySelector('[role="alert"]').textContent).toContain('took too long');
  expect(document.querySelector('#widget .widget-spinner')).toBeNull();
  expect(document.querySelector('#widget button').textContent).toBe('Reconnect');
  expect(document.querySelector<HTMLElement>('#page-chats').inert).toBe(true);
  pending.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(document.body.classList.contains('widget-starting')).toBe(true);
  expect(document.querySelector('[role="alert"]').textContent).toContain('took too long');
  expect(mocks.logout).not.toHaveBeenCalled();
  expect(mocks.authorize).toHaveBeenCalledTimes(stage === 'account' ? 0 : 1);
  // A restored session asks for support alongside revalidation, but never uses the answer first.
  if(stage === 'authorize') expect(mocks.save).not.toHaveBeenCalled();
  if(stage === 'support') expect(mocks.save).not.toHaveBeenCalled();
  if(stage === 'save') expect(mocks.restrict).not.toHaveBeenCalled();
  if(stage === 'bootstrap') expect(mocks.open).not.toHaveBeenCalled();
});

it.each(['support', 'save', 'bootstrap', 'open'] as const)('catches rejected %s without showing RPC arguments', async(stage) => {
  mocks[stage].mockRejectedValue(new Error('RPC fixture-secret params should stay private'));
  await startWidget(signedIn);
  expect(document.querySelector('[role="alert"]').textContent).toBe('Could not connect to support. Please try again.');
  expect(document.body.textContent).not.toContain('fixture-secret');
  expect(document.querySelector('#widget button').textContent).toBe('Reconnect');
  expect(document.querySelector<HTMLElement>('#page-chats').inert).toBe(true);
  expect(mocks.logout).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('ignores a late invalid-token failure after timing out a restored session', async() => {
  const pending = deferred();
  mocks.authorize.mockReturnValue(pending.promise);
  const started = startWidget(signedIn);
  await vi.advanceTimersByTimeAsync(45_000);
  await started;
  pending.reject({type: 'ACCESS_TOKEN_INVALID'});
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.logout).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]').textContent).toContain('took too long');
});

it('opens the chat on success and clears its timeout', async() => {
  await startWidget(signedIn);
  expect(mocks.support).toHaveBeenCalledExactlyOnceWith('help.getSupport', {}, {ignoreErrors: true});
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({_: 'user', id: 456});
  expect(mocks.open).toHaveBeenCalledWith({peerId: 456});
  expect(document.querySelector('#widget').childElementCount).toBe(0);
  expect(document.querySelector<HTMLElement>('#page-chats').inert).toBe(false);
  expect(document.body.classList.contains('widget-starting')).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(mocks.logout).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  {_: 'userEmpty', id: 456},
  {_: 'user', id: 456, pFlags: {deleted: true}},
  {_: 'user', id: 123}
])('rejects unavailable support %j', async(user) => {
  mocks.support.mockResolvedValue({user});
  await startWidget(signedIn);
  expect(document.querySelector('[role="alert"]').textContent).toBe('Support is currently unavailable.');
  expect(mocks.restrict).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
});

it.each(['reject', 'pending'] as const)('opens support despite a %s language pack', async(mode) => {
  blah.widget.lang = 'zh-hans';
  mocks.pack.mockImplementation(() => mode === 'reject' ? Promise.reject({type: 'LANG_PACK_INVALID'}) : new Promise(() => {}));
  mocks.language.mockResolvedValue({lang_code: 'zh-hans', pFlags: {}});
  const started = startWidget(signedIn);
  await vi.advanceTimersByTimeAsync(5_000);
  await started;
  expect(mocks.pack).toHaveBeenCalledWith('zh-hans', 'webk_bfb', 'no-store');
  expect(mocks.open).toHaveBeenCalledWith({peerId: 456});
  expect(document.querySelector('#widget').childElementCount).toBe(0);
  expect(document.body.classList.contains('widget-starting')).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('renders startup errors and the retry button in the fetched language', async() => {
  blah.widget.lang = 'de';
  mocks.pack.mockResolvedValue({_: 'langPackDifference', lang_code: 'de', from_version: 0, version: 1, strings: [
    {_: 'langPackString', key: 'BfbConnectionFailed', value: 'Verbindung fehlgeschlagen.'},
    {_: 'langPackString', key: 'BfbReconnect', value: 'Erneut verbinden'}
  ]});
  mocks.language.mockResolvedValue({lang_code: 'de', pFlags: {}});
  mocks.support.mockRejectedValue(new Error('offline'));
  await startWidget(signedIn);
  expect(document.querySelector('[role="alert"]').textContent).toBe('Verbindung fehlgeschlagen.');
  expect(document.querySelector('#widget button').textContent).toBe('Erneut verbinden');
});

const german = (key: string, value: string) => ({_: 'langPackDifference', lang_code: 'de', from_version: 0, version: 1, strings: [
  {_: 'langPackString', key, value}
]});

it('revalidates the token and asks for support while the language pack loads, then renders in that language', async() => {
  blah.widget.lang = 'de';
  const pack = deferredPromise<unknown>(), authorized = deferred();
  mocks.pack.mockReturnValue(pack);
  mocks.language.mockResolvedValue({lang_code: 'de', pFlags: {}});
  mocks.authorize.mockReturnValue(authorized.promise);
  let rendered: string;
  mocks.bootstrap.mockImplementation(async() => { rendered = I18n.format('BfbSupport', true); });
  const started = startWidget(signedIn);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.pack).toHaveBeenCalled();
  expect(mocks.authorize).toHaveBeenCalledOnce();
  expect(mocks.support).toHaveBeenCalledExactlyOnceWith('help.getSupport', {}, {ignoreErrors: true});
  // Nothing from the restored session is used before the token succeeds.
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.prefetch).not.toHaveBeenCalled();
  authorized.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.prefetch.mock.calls.flat()).toEqual(['getConfig', 'getAppConfig', 'getPeerColors', 'getPeerProfileColors']);
  // The chat is built only once the language is applied.
  expect(mocks.restrict).not.toHaveBeenCalled();
  expect(mocks.bootstrap).not.toHaveBeenCalled();
  pack.resolve(german('BfbSupport', 'Kundendienst'));
  await started;
  expect(rendered).toBe('Kundendienst');
  expect(mocks.open).toHaveBeenCalledWith({peerId: 456});
  expect(mocks.support).toHaveBeenCalledOnce();
  expect(document.body.classList.contains('widget-starting')).toBe(false);
});

it('asks a new session for support only after it signs in', async() => {
  const authorized = deferred();
  mocks.authorize.mockReturnValue(authorized.promise);
  const started = startWidget({_: 'authStateSignIn'});
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.authorize).toHaveBeenCalledOnce();
  expect(mocks.support).not.toHaveBeenCalled();
  expect(mocks.prefetch).not.toHaveBeenCalled();
  authorized.resolve();
  await started;
  expect(mocks.support).toHaveBeenCalledExactlyOnceWith('help.getSupport', {});
  expect(mocks.authorize.mock.invocationCallOrder[0]).toBeLessThan(mocks.support.mock.invocationCallOrder[0]);
  expect(mocks.open).toHaveBeenCalledWith({peerId: 456});
});

it('repeats a failed overlapped support lookup after the token succeeds', async() => {
  mocks.support.mockRejectedValueOnce({type: 'AUTH_KEY_UNREGISTERED', code: 401});
  await startWidget(signedIn);
  expect(mocks.support).toHaveBeenNthCalledWith(1, 'help.getSupport', {}, {ignoreErrors: true});
  expect(mocks.support).toHaveBeenNthCalledWith(2, 'help.getSupport', {});
  expect(mocks.authorize.mock.invocationCallOrder[0]).toBeLessThan(mocks.support.mock.invocationCallOrder[1]);
  expect(mocks.open).toHaveBeenCalledWith({peerId: 456});
  expect(mocks.logout).not.toHaveBeenCalled();
});

it('discards an overlapped support answer when the token is revoked', async() => {
  mocks.authorize.mockRejectedValue({type: 'ACCESS_TOKEN_INVALID'});
  await startWidget(signedIn);
  expect(mocks.support).toHaveBeenCalledOnce();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.restrict).not.toHaveBeenCalled();
  expect(mocks.bootstrap).not.toHaveBeenCalled();
  expect(mocks.logout).toHaveBeenCalledOnce();
  expect(document.querySelector<HTMLElement>('#page-chats').inert).toBe(true);
});

it('signs out another account before importing the token or asking for support', async() => {
  mocks.account.mockResolvedValue({userId: 999});
  await startWidget(signedIn);
  expect(mocks.logout).toHaveBeenCalledOnce();
  expect(mocks.authorize).not.toHaveBeenCalled();
  expect(mocks.support).not.toHaveBeenCalled();
});

it('shows a failure that precedes the language pack in that language', async() => {
  blah.widget.lang = 'de';
  const pack = deferredPromise<unknown>();
  mocks.pack.mockReturnValue(pack);
  mocks.language.mockResolvedValue({lang_code: 'de', pFlags: {}});
  mocks.authorize.mockRejectedValue(new Error('offline'));
  const started = startWidget({_: 'authStateSignIn'});
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  pack.resolve(german('BfbConnectionFailed', 'Verbindung fehlgeschlagen.'));
  await started;
  expect(document.querySelector('[role="alert"]').textContent).toBe('Verbindung fehlgeschlagen.');
});
