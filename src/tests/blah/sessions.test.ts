import {describe, expect, it, vi} from 'vitest';
import type {ApiManager} from '@appManagers/apiManager';
const mock = vi.hoisted(() => ({identity: vi.fn(), remove: vi.fn(), binding: undefined as string}));
vi.mock('@lib/blah/identity', () => ({identityAction: mock.identity, removeSessionDevices: mock.remove}));
vi.mock('@lib/blah/vault', () => ({stored: async() => mock.binding}));
import {resetIdentitySessions, retrySessionReset} from '@lib/blah/sessions';

function api() {
  return {invokeApi: vi.fn().mockResolvedValue({sessions: [{hash: 0, device: new Uint8Array([1])},
    {hash: '123', device: new Uint8Array([2])}, {hash: '456', device: new Uint8Array([3])}], retired: []})};
}
describe('holder session termination', () => {
  it('maps one authorization hash to its device before reset', async() => {
    mock.binding = undefined; mock.identity.mockResolvedValue({identity: {holder: true}}); mock.remove.mockClear();
    const manager = api();
    await resetIdentitySessions(2, manager as unknown as ApiManager, '123');
    expect(manager.invokeApi).toHaveBeenCalledExactlyOnceWith('blah.getSessionDevices');
    expect(mock.remove).toHaveBeenCalledExactlyOnceWith(2, [new Uint8Array([2])]);
  });
  it('keeps the calling device when terminating every other session', async() => {
    mock.identity.mockResolvedValue({identity: {holder: true}}); mock.remove.mockClear();
    await resetIdentitySessions(1, api() as unknown as ApiManager);
    expect(mock.remove).toHaveBeenCalledExactlyOnceWith(1, [new Uint8Array([2]), new Uint8Array([3])]);
  });
  it('refuses a non-holder before fetching or editing the device set', async() => {
    mock.identity.mockResolvedValue({identity: {holder: false}}); mock.remove.mockClear(); const manager = api();
    await expect(resetIdentitySessions(1, manager as unknown as ApiManager)).rejects.toThrow('recovery words');
    expect(manager.invokeApi).not.toHaveBeenCalled(); expect(mock.remove).not.toHaveBeenCalled();
  });
  it('keeps managed-account termination on the ordinary path', async() => {
    mock.binding = 'managed-account'; mock.identity.mockClear(); const manager = api();
    await resetIdentitySessions(1, manager as unknown as ApiManager);
    expect(mock.identity).not.toHaveBeenCalled(); expect(manager.invokeApi).not.toHaveBeenCalled();
  });
  it('retries only DEVICE_STILL_LISTED, once after propagation delay', async() => {
    vi.useFakeTimers();
    const reset = vi.fn().mockRejectedValueOnce({type: 'DEVICE_STILL_LISTED'}).mockResolvedValue(true);
    const result = retrySessionReset(reset);
    await vi.advanceTimersByTimeAsync(499); expect(reset).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(await result).toBe(true); expect(reset).toHaveBeenCalledTimes(2);
    const failure = vi.fn().mockRejectedValue({type: 'DEVICE_STILL_LISTED'});
    const failed = expect(retrySessionReset(failure)).rejects.toMatchObject({type: 'DEVICE_STILL_LISTED'});
    await vi.advanceTimersByTimeAsync(500); await failed; expect(failure).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    const ordinary = vi.fn().mockRejectedValue({type: 'AUTH_KEY_INVALID'});
    await expect(retrySessionReset(ordinary)).rejects.toMatchObject({type: 'AUTH_KEY_INVALID'});
    expect(ordinary).toHaveBeenCalledOnce();
  });
});
