import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import '@helpers/peerIdPolyfill';
import deferredPromise from '@helpers/cancellablePromise';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), support: vi.fn(), bootstrap: vi.fn(), open: vi.fn(), logout: vi.fn(),
  account: vi.fn(), save: vi.fn(), restrict: vi.fn(), theme: vi.fn()
}));
vi.mock('@config/blah', () => ({default: {widget: {param: true}}}));
vi.mock('@lib/rootScope', () => ({default: {managers: {
  appAccountManager: {importManagedAccountAuthorization: mocks.authorize},
  appUsersManager: {saveApiUser: mocks.save},
  apiManager: {logOut: mocks.logout, invokeApi: mocks.support}
}}}));
vi.mock('@lib/accounts/bindManagersToAccount', () => ({bindManagersToSession: (managers: unknown) => managers}));
vi.mock('@lib/accounts/accountController', () => ({default: {get: mocks.account}}));
vi.mock('@lib/accounts/getCurrentAccount', () => ({getCurrentAccount: () => 1}));
vi.mock('@components/appNavigationController', () => ({default: {reload: vi.fn()}}));
vi.mock('@/widget/restrictions', () => ({restrictToSupport: mocks.restrict}));
vi.mock('@/widget/theme', () => ({applyWidgetTheme: mocks.theme}));
vi.mock('@/pages/bootstrapIm', () => ({bootstrapIm: mocks.bootstrap}));
import {startWidget} from '@/widget/index';

const signedIn = {_: 'authStateSignedIn'} as const;
const deferred = () => {
  const promise = deferredPromise<void>();
  return {promise, resolve: () => promise.resolve(), reject: (error: unknown) => promise.reject(error)};
};
beforeEach(() => {
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
  await vi.advanceTimersByTimeAsync(45_000);
  await started;
  expect(document.querySelector('[role="alert"]').textContent).toContain('took too long');
  expect(document.querySelector('#widget button').textContent).toBe('Reconnect');
  expect(document.querySelector<HTMLElement>('#page-chats').inert).toBe(true);
  pending.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(document.body.classList.contains('widget-starting')).toBe(true);
  expect(document.querySelector('[role="alert"]').textContent).toContain('took too long');
  expect(mocks.logout).not.toHaveBeenCalled();
  expect(mocks.authorize).toHaveBeenCalledTimes(stage === 'account' ? 0 : 1);
  if(stage === 'authorize') expect(mocks.support).not.toHaveBeenCalled();
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
  expect(mocks.support).toHaveBeenCalledExactlyOnceWith('help.getSupport', {});
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
