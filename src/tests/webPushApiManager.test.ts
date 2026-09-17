import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {WebPushApiManager} from '@lib/webPushApiManager';

const config = vi.hoisted(() => ({blah: {} as object | undefined, pushServerKey: '-_8'}));
vi.mock('@config/blah', () => ({get default() { return config.blah; }}));
vi.mock('@config/app', () => ({default: config}));
vi.mock('@config/debug', () => ({default: false, MOUNT_CLASS_TO: {}}));
vi.mock('@config/modes', () => ({default: {}}));
vi.mock('@lib/langPack', () => ({default: {format: (key: string) => key}}));
vi.mock('@lib/singleInstance', () => ({default: {}}));
vi.mock('@lib/accounts/accountController', () => ({
  default: {getUserIds: vi.fn().mockResolvedValue([])}
}));
vi.mock('@lib/apiManagerProxy', () => ({
  default: {pushSingleManager: {getKeysIdsBase64: vi.fn().mockResolvedValue([])}}
}));
vi.mock('@components/appNavigationController', () => ({default: {}}));

function subscription(key: number[] | null, endpoint = 'https://push.invalid/current') {
  return {
    options: {applicationServerKey: key && new Uint8Array(key).buffer},
    unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: vi.fn(() => ({endpoint, keys: {p256dh: 'test', auth: 'test'}}))
  };
}

describe('Blah Web Push subscriptions', () => {
  let current: ReturnType<typeof subscription>;
  let pushManager: {getSubscription: ReturnType<typeof vi.fn>, subscribe: ReturnType<typeof vi.fn>};
  let manager: WebPushApiManager;

  beforeEach(() => {
    config.blah = {};
    config.pushServerKey = '-_8';
    current = subscription([251, 255]);
    pushManager = {
      getSubscription: vi.fn().mockResolvedValue(current),
      subscribe: vi.fn().mockResolvedValue(current)
    };
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', {permission: 'granted'});
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      serviceWorker: {ready: Promise.resolve({pushManager})}
    });
    manager = new WebPushApiManager();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('disables remote push without a VAPID key but retains local notification plumbing', async() => {
    vi.useFakeTimers();
    config.pushServerKey = '';
    const invokeVoid = vi.fn();
    const addEventListener = vi.fn();
    manager.serviceMessagePort = {invokeVoid, addEventListener} as any;

    expect(await manager.getSubscription()).toBeUndefined();
    expect(current.unsubscribe).toHaveBeenCalledOnce();
    pushManager.getSubscription.mockResolvedValue(null);
    expect(await manager.subscribe()).toBeUndefined();
    expect(pushManager.getSubscription).toHaveBeenCalledTimes(2);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(manager.isAvailable).toBe(true);
    manager.setUpServiceWorkerChannel();
    await vi.advanceTimersByTimeAsync(0);
    expect(addEventListener).toHaveBeenCalledWith('pushClick', expect.any(Function));
    expect(invokeVoid).toHaveBeenCalledWith('pushPing', expect.objectContaining({localNotifications: true}));
    manager.hidePushNotifications();
    expect(invokeVoid).toHaveBeenCalledWith('notificationsClear', undefined);
  });

  it('removes an existing subscription on direct subscribe when the build key is removed', async() => {
    config.pushServerKey = '';
    expect(await manager.subscribe()).toBeUndefined();
    expect(current.unsubscribe).toHaveBeenCalledOnce();
    expect(current.toJSON).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('reuses a matching key decoded from unpadded URL-safe base64', async() => {
    const token = await manager.getSubscription();
    expect(token).toEqual({
      tokenType: 10,
      tokenValue: JSON.stringify({...current.toJSON(), vapid: true})
    });
    expect(await manager.subscribe()).toEqual(token);
    expect(current.unsubscribe).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it.each([{key: [1, 2]}, {key: null}])('does not return an old or keyless subscription ($key)', async({key}) => {
    const old = subscription(key);
    pushManager.getSubscription.mockResolvedValue(old);
    expect(await manager.getSubscription()).toBeUndefined();
    expect(old.unsubscribe).toHaveBeenCalledOnce();
    expect(old.toJSON).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('waits for old subscription removal before subscribing with the build key', async() => {
    const old = subscription([1, 2]);
    let finish: (value: boolean) => void;
    old.unsubscribe.mockReturnValue(new Promise<boolean>((resolve) => finish = resolve));
    pushManager.getSubscription.mockResolvedValue(old);

    const pending = manager.subscribe();
    await vi.waitFor(() => expect(old.unsubscribe).toHaveBeenCalledOnce());
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    finish(true);
    const token = await pending;
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: '-_8'
    });
    expect(token).toEqual(expect.objectContaining({tokenType: 10}));
    expect(old.toJSON).not.toHaveBeenCalled();
  });

  it('subscribes normally when there is no existing subscription', async() => {
    pushManager.getSubscription.mockResolvedValue(null);
    expect(await manager.getSubscription()).toBeUndefined();
    expect(await manager.subscribe()).toEqual(expect.objectContaining({tokenType: 10}));
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
  });

  it('does not expose the stale token or subscribe if removal fails', async() => {
    const old = subscription([1, 2]);
    old.unsubscribe.mockRejectedValue(new Error('unsubscribe failed'));
    pushManager.getSubscription.mockResolvedValue(old);
    expect(await manager.getSubscription()).toBeUndefined();
    expect(await manager.subscribe()).toBeUndefined();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(old.toJSON).not.toHaveBeenCalled();
  });

  it('preserves Telegram subscription behavior outside Blah mode', async() => {
    config.blah = undefined;
    const old = subscription([1, 2]);
    pushManager.getSubscription.mockResolvedValue(old);
    expect(await manager.getSubscription()).toEqual(expect.objectContaining({tokenType: 10}));
    await manager.subscribe();
    expect(old.unsubscribe).not.toHaveBeenCalled();
    expect(pushManager.getSubscription).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
  });
});
