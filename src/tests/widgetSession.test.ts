import bytesToHex from '@helpers/bytes/bytesToHex';
import deferred from '@/tests/helpers/deferred';
import {WidgetSessionController, readSnapshot, type SessionSnapshot} from '@/widget/session';
import type {WidgetConfig} from '@/widget/config';

const config: WidgetConfig = {dcId: 1, url: 'wss://dc.example/apiws', rsaKey: {modulus: 'ab'.repeat(256), exponent: '010001'}, apiId: 1, apiHash: 'aa'.repeat(16)};
const digest = async(token: string) => bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
const snapshot = async(token: string): Promise<SessionSnapshot> => ({version: 1, config, tokenDigest: await digest(token), authKey: 'ab'.repeat(256), salt: 'ab'.repeat(8), timeOffset: 0});

function fixture(saved?: SessionSnapshot, options: {
  authFailure?: boolean,
  logoutFailure?: boolean,
  authenticating?: Promise<void>,
  loggingOut?: Promise<void>
} = {}) {
  const calls: string[] = [];
  const persist = vi.fn();
  const create = vi.fn((home: WidgetConfig, tokenDigest: string, previous: SessionSnapshot | undefined,
    save: (snapshot: SessionSnapshot) => void) => ({
    authenticate: vi.fn(async(token: string) => {
      calls.push('auth:' + token);
      save({...previous, version: 1, config: home, tokenDigest, authKey: 'bc'.repeat(256), salt: 'ab'.repeat(8), timeOffset: 0});
      await options.authenticating;
      if(options.authFailure) throw new Error('ACCESS_TOKEN_INVALID');
    }),
    logout: vi.fn(async() => {
      calls.push('logout');
      await options.loggingOut;
      if(options.logoutFailure) throw new Error('offline');
    }),
    destroy: vi.fn(() => { calls.push('destroy'); })
  }));
  const controller = new WidgetSessionController(saved, persist, create);
  return {controller, calls, persist, create};
}

it('revalidates the same token on a restored session and never stores its plaintext', async() => {
  const saved = await snapshot('old'), {controller, calls, persist} = fixture(saved);
  await controller.replace(config, 'old');
  expect(calls).toEqual(['auth:old']);
  expect(controller.active).toBeDefined();
  expect(JSON.stringify(persist.mock.calls)).not.toContain('old');
});

it('revokes the old authorization before authenticating a different token, even for the same user', async() => {
  const {controller, calls} = fixture(await snapshot('123:old'));
  await controller.replace(config, '123:new');
  expect(calls).toEqual(['logout', 'destroy', 'auth:123:new']);
  const transition = controller.replace(config, '456:new');
  expect(controller.active).toBeUndefined();
  await transition;
  expect(calls.slice(-3)).toEqual(['logout', 'destroy', 'auth:456:new']);
});

it.each([undefined, {...config, url: 'wss://other.example/apiws'}, {...config, rsaKey: {...config.rsaKey, modulus: 'cd'.repeat(256)}}])('retires the stored session when configuration changes', async(home) => {
  const {controller, calls} = fixture(await snapshot('old'));
  await controller.replace(home, 'old');
  expect(calls.slice(0, 2)).toEqual(['logout', 'destroy']);
});

it('missing or removed tokens log out and never expose a restored account', async() => {
  const {controller, calls, persist} = fixture(await snapshot('old'));
  await controller.replace(config, undefined);
  expect(calls).toEqual(['logout', 'destroy']);
  expect(persist).toHaveBeenLastCalledWith(undefined);
  expect(controller.active).toBeUndefined();
});

it('keeps a failed logout retryable and does not start the replacement login', async() => {
  const options = {logoutFailure: true};
  const {controller, calls, persist} = fixture(await snapshot('old'), options);
  await expect(controller.replace(config, 'new')).rejects.toThrow('offline');
  expect(calls).toEqual(['logout', 'destroy']);
  expect(persist).not.toHaveBeenCalled();
  expect(controller.active).toBeUndefined();

  options.logoutFailure = false;
  expect(await controller.replace(config, 'new')).toBeDefined();
  expect(calls).toEqual(['logout', 'destroy', 'logout', 'destroy', 'auth:new']);
});

it('failed token validation never falls back to the restored key', async() => {
  const {controller, calls, persist} = fixture(await snapshot('old'), {authFailure: true});
  await expect(controller.replace(config, 'old')).rejects.toThrow('ACCESS_TOKEN_INVALID');
  expect(calls).toEqual(['auth:old', 'logout', 'destroy']);
  expect(persist).toHaveBeenLastCalledWith(undefined);
  expect(controller.active).toBeUndefined();
});

it('serializes token changes during login and discards intermediate tokens', async() => {
  const pending = deferred();
  const {controller, calls} = fixture(undefined, {authenticating: pending.promise});
  const first = controller.replace(config, 'first');
  await vi.waitFor(() => expect(calls).toEqual(['auth:first']));
  const second = controller.replace(config, 'second');
  const third = controller.replace(config, 'third');
  pending.resolve();
  expect(await first).toBeUndefined();
  expect(await second).toBeUndefined();
  expect(await third).toBeDefined();
  expect(calls).toEqual(['auth:first', 'logout', 'destroy', 'auth:third']);
});

it('abandons token changes superseded during hashing before revoking the saved authorization', async() => {
  const saved = await snapshot('old');
  const tokenDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('discarded'));
  const pending = deferred<ArrayBuffer>();
  const hashing = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => pending.promise);
  try {
    const {controller, calls} = fixture(saved);
    const first = controller.replace(config, 'discarded');
    await vi.waitFor(() => expect(hashing).toHaveBeenCalledOnce());
    const latest = controller.replace(config, 'old');
    pending.resolve(tokenDigest);
    expect(await first).toBeUndefined();
    expect(await latest).toBeDefined();
    expect(calls).toEqual(['auth:old']);
  } finally {
    hashing.mockRestore();
  }
});

it('preserves the saved key when suspension cancels a pending authentication', async() => {
  const pending = deferred();
  const {controller, calls, persist} = fixture(undefined, {authenticating: pending.promise});
  const login = controller.replace(config, 'old');
  await vi.waitFor(() => expect(calls).toEqual(['auth:old']));
  const saved = persist.mock.lastCall[0];
  controller.suspend();
  pending.reject(new Error('WIDGET_CLOSED'));
  expect(await login).toBeUndefined();
  expect(calls).toEqual(['auth:old', 'destroy']);
  expect(persist).toHaveBeenLastCalledWith(saved);
  expect(controller.active).toBeUndefined();
});

it('revalidates a suspended login after its pending authentication finishes', async() => {
  const pending = deferred();
  const {controller, calls} = fixture(undefined, {authenticating: pending.promise});
  const login = controller.replace(config, 'old');
  await vi.waitFor(() => expect(calls).toEqual(['auth:old']));
  controller.suspend();
  const resumed = controller.replace(config, 'new');
  pending.resolve();
  expect(await login).toBeUndefined();
  expect(await resumed).toBeDefined();
  expect(calls).toEqual(['auth:old', 'destroy', 'logout', 'destroy', 'auth:new']);
});

it('retries revocation after suspension interrupts logout', async() => {
  const pending = deferred();
  const {controller, calls, persist} = fixture(await snapshot('old'), {loggingOut: pending.promise});
  const replacement = controller.replace(config, 'new');
  await vi.waitFor(() => expect(calls).toEqual(['logout']));
  controller.suspend();
  pending.resolve();
  expect(await replacement).toBeUndefined();
  expect(persist).not.toHaveBeenCalled();
  expect(controller.active).toBeUndefined();
  expect(await controller.replace(config, 'new')).toBeDefined();
  expect(calls).toEqual(['logout', 'destroy', 'logout', 'destroy', 'auth:new']);
});

it('ignores stale persistence from replaced or suspended transports', async() => {
  const {controller, create, persist} = fixture();
  await controller.replace(config, 'old');
  const saveOld = create.mock.calls[0][3];
  const oldSnapshot = persist.mock.lastCall[0];
  await controller.replace(config, 'new');
  const saveNew = create.mock.calls[1][3];
  const newSnapshot = persist.mock.lastCall[0];
  persist.mockClear();
  saveOld(oldSnapshot);
  expect(persist).not.toHaveBeenCalled();
  controller.suspend();
  saveNew(newSnapshot);
  expect(persist).not.toHaveBeenCalled();
  expect(controller.active).toBeUndefined();
});

it('rejects malformed stored sessions rather than restoring arbitrary state', async() => {
  expect(readSnapshot(null)).toBeUndefined();
  const saved = await snapshot('old');
  expect(readSnapshot(JSON.stringify(saved))).toEqual(saved);
  expect(() => readSnapshot(JSON.stringify({...saved, authKey: 'short'}))).toThrow();
});
