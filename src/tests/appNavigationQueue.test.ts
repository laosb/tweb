import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {NavigationItem} from '@components/appNavigationController';

vi.mock('@config/debug', () => ({MOUNT_CLASS_TO: {}}));
vi.mock('@environment/userAgent', () => ({IS_FIREFOX: false, IS_MOBILE_SAFARI: false}));
vi.mock('@helpers/appWindow', () => ({bindActiveWindowListener: vi.fn()}));
vi.mock('@lib/accounts/getCurrentAccount', () => ({getCurrentAccount: () => 1}));
vi.mock('@lib/logger', () => ({
  logger: () => Object.assign(vi.fn(), {warn: vi.fn(), bindPrefix: () => vi.fn()})
}));

function navigationResult() {
  return {committed: Promise.resolve(), finished: Promise.resolve()};
}

function pendingResult() {
  let reject: (reason: Error) => void;
  const result = navigationResult();
  result.finished = new Promise<void>((_resolve, rejectPromise) => reject = rejectPromise);
  return {result, reject: (reason: Error) => reject(reason)};
}

let controller: typeof import('@components/appNavigationController')['default'];
let onNavigate: (event: NavigationEvent) => void;
let fakeNavigation: ReturnType<typeof createNavigation>;
let reload: ReturnType<typeof vi.fn>;

function emitNavigate(navigationType: NavigationEvent['navigationType'], url = location.href, state?: unknown) {
  onNavigate({
    navigationType,
    destination: {
      url,
      index: fakeNavigation.currentEntry.index,
      sameDocument: true,
      getState: () => state
    },
    intercept: vi.fn()
  } as unknown as NavigationEvent);
}

function createNavigation() {
  return {
    canGoBack: false,
    currentEntry: {index: 1},
    addEventListener: vi.fn((_type: string, listener: typeof onNavigate) => onNavigate = listener),
    navigate: vi.fn((url: string | URL, options: NavigationOptions) => {
      emitNavigate(options.history, url.toString(), options.state);
      return navigationResult();
    }),
    back: vi.fn(() => navigationResult())
  };
}

beforeEach(async() => {
  vi.resetModules();
  vi.useFakeTimers();
  reload = vi.fn();
  vi.stubGlobal('location', {href: 'https://example.org/', hash: '', reload});
  fakeNavigation = createNavigation();
  vi.stubGlobal('navigation', fakeNavigation);
  controller = (await import('@components/appNavigationController')).default;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Navigation API history queue', () => {
  it('skips Back without a back entry and still replaces the URL and reloads', async() => {
    const item: NavigationItem = {type: 'popup', onPop: vi.fn()};
    controller.pushItem(item);
    controller.removeItem(item);
    const url = new URL('?account=2', location.href);
    controller.reload(url);

    await vi.runAllTimersAsync();

    expect(fakeNavigation.back).not.toHaveBeenCalled();
    expect(fakeNavigation.navigate).toHaveBeenLastCalledWith(url, {state: expect.any(Number), history: 'replace'});
    expect(reload).toHaveBeenCalledOnce();
    expect(fakeNavigation.navigate.mock.invocationCallOrder[fakeNavigation.navigate.mock.invocationCallOrder.length - 1]).toBeLessThan(reload.mock.invocationCallOrder[0]);

    const onPop = vi.fn();
    controller.pushItem({type: 'popup', noHistory: true, onPop});
    emitNavigate('traverse');
    expect(onPop).toHaveBeenCalledOnce();
  });

  it('continues after Back rejects without an event and leaves the next real Back alone', async() => {
    fakeNavigation.canGoBack = true;
    fakeNavigation.back.mockImplementationOnce(() => ({
      committed: Promise.reject(new Error('no back entry')),
      finished: Promise.reject(new Error('no back entry'))
    }));
    const item: NavigationItem = {type: 'popup', onPop: vi.fn()};
    controller.pushItem(item);
    controller.removeItem(item);
    const url = new URL('?account=2', location.href);
    controller.reload(url);

    await vi.runAllTimersAsync();

    expect(fakeNavigation.back).toHaveBeenCalledOnce();
    expect(fakeNavigation.navigate).toHaveBeenLastCalledWith(url, {state: expect.any(Number), history: 'replace'});
    expect(reload).toHaveBeenCalledOnce();

    const onPop = vi.fn();
    controller.pushItem({type: 'popup', noHistory: true, onPop});
    emitNavigate('traverse');
    expect(onPop).toHaveBeenCalledOnce();
  });

  it('does not let a late rejection resolve the next step or remove its Back ignore', async() => {
    fakeNavigation.canGoBack = true;
    const first = pendingResult();
    fakeNavigation.navigate.mockImplementationOnce((url, options) => {
      emitNavigate(options.history, url.toString(), options.state);
      return first.result;
    });
    const item: NavigationItem = {type: 'popup', onPop: vi.fn()};
    controller.pushItem(item);
    controller.removeItem(item);
    controller.reload(new URL('?account=2', location.href));
    await vi.runAllTimersAsync();
    expect(fakeNavigation.back).toHaveBeenCalledOnce();

    first.reject(new Error('intercepted navigation aborted'));
    await vi.runAllTimersAsync();
    expect(fakeNavigation.navigate).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();

    const onPop = vi.fn();
    controller.pushItem({type: 'popup', noHistory: true, onPop});
    emitNavigate('traverse');
    await vi.runAllTimersAsync();
    expect(onPop).not.toHaveBeenCalled();
    expect(fakeNavigation.navigate).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledOnce();
  });
});
