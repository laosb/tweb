import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ApiManager} from '@appManagers/apiManager';
import type {DeviceLinkRequest} from '@lib/blah/deviceLinkTypes';

const mock = vi.hoisted(() => ({begin: vi.fn(), open: vi.fn(), inspect: vi.fn(), respond: vi.fn(), destroy: vi.fn(),
  install: vi.fn(), certify: vi.fn(), identity: vi.fn(), publication: vi.fn(), save: vi.fn(),
  use: vi.fn()}));
vi.mock('@config/blah', () => ({default: {defaultDcId: 1}, ensureBlahConfig: async() => {},
  getBlahConfig: () => ({home: {identity: '0a0b', generation: '1'}})}));
vi.mock('@lib/blah/runtime', () => ({diemClient: async() => ({deviceLink: {
  begin: mock.begin, open: mock.open, inspect: mock.inspect
}})}));
vi.mock('@lib/blah/identity', () => ({respondToLinkedDevice: mock.respond, installLinkedIdentity: mock.install, certifyLinkedDevice: mock.certify,
  linkedAccountIdentity: mock.identity, publicationPending: mock.publication, withIdentity: mock.use}));
import {deviceLinkAction, parseDeviceLink} from '@lib/blah/deviceLink';

const requestBytes = new Uint8Array([17, 1, 7]);
const responseBytes = new Uint8Array([19, 1, 8]);
const token = new Uint8Array(32).fill(255);
const parameter = 'cXVpZXQtc2VjcmV0';
const link = 'tg://login?token=' + btoa(String.fromCharCode(...token)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '&blah=' + parameter;
const profile = [3, 4];
const info = {id: 'alice', profile, domains: ['alice.example.org']};
const secret = {domain: 'alice.example.org', profile: 'AwQ=', publicationPending: true,
  identity: {privateKey: 'identity-private', publicKey: 'identity-public'},
  device: {privateKey: 'O-private', publicKey: 'O-public'},
  publisher: 'https://publisher.example.org/alice', token: 'publisher-token',
  renewal: {profileDays: 60, deviceDays: 90, autoRenew: false}};
let serial = 0;
let attempts: {slot: number, attempt: string, api: ApiManager}[];
let contents: Uint8Array;

function harness(slot = 1, serverTimeOffset = 0) {
  const invokeApi = vi.fn(async(method: string, _params?: unknown, _options?: unknown): Promise<any> => {
    if(method === 'auth.exportLoginToken') return {_: 'auth.loginToken', token, expires: Date.now() / 1000 + 30};
    if(method === 'blah.getDeviceLink') return {_: 'blah.deviceLink', request: requestBytes};
    if(method === 'auth.acceptLoginToken') return {_: 'authorization'};
    throw new Error('Unexpected RPC: ' + method);
  });
  const api = {invokeApi} as unknown as ApiManager;
  const attempt = 'test-' + ++serial;
  attempts.push({slot, attempt, api});
  const run = (request: Omit<DeviceLinkRequest, 'attempt'> | Record<string, unknown>) =>
    deviceLinkAction(slot, api, {...request, attempt} as DeviceLinkRequest, serverTimeOffset);
  return {run, invokeApi, api, attempt};
}

async function begin(h: ReturnType<typeof harness>) {
  return h.run({action: 'begin', label: 'New browser', exceptIds: [42]});
}

async function approved(h: ReturnType<typeof harness>) {
  await begin(h);
  h.invokeApi.mockResolvedValueOnce({_: 'blah.deviceLink', request: requestBytes, response: responseBytes});
  await h.run({action: 'poll'});
}

async function prepare(h: ReturnType<typeof harness>, transferIdentity = true) {
  await h.run({action: 'inspect', link});
  await h.run({action: 'prepare', transferIdentity});
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T00:00:00Z'));
  vi.resetAllMocks();
  attempts = [];
  contents = new Uint8Array([9, 10]);
  mock.begin.mockResolvedValue({request: requestBytes, parameter, session: {destroy: mock.destroy}});
  mock.open.mockResolvedValue({keyFileContents: contents});
  mock.inspect.mockResolvedValue({device: new Uint8Array([5]), label: 'New browser', verifies: [1]});
  mock.identity.mockResolvedValue({id: 'alice', domain: 'alice.example.org', unlocked: true});
  mock.certify.mockResolvedValue({identity: info, manualPublication: false});
  mock.use.mockImplementation((_slot, action) => action(secret, info, mock.save));
  mock.publication.mockResolvedValue(false);
  mock.respond.mockResolvedValue(responseBytes);
});

afterEach(async() => {
  for(const {slot, api, attempt} of attempts) await deviceLinkAction(slot, api, {action: 'cancel', attempt});
  vi.useRealTimers();
});

describe('N device-link state machine', () => {
  it('begins once with a request-wrapped export and keeps the QR secret out of RPC params', async() => {
    const h = harness();
    const result = await begin(h);
    expect(result).toMatchObject({loginToken: {token}, parameter});
    expect(mock.begin).toHaveBeenCalledExactlyOnceWith('New browser');
    expect(h.invokeApi).toHaveBeenCalledExactlyOnceWith('auth.exportLoginToken',
      expect.objectContaining({except_ids: [42]}), expect.objectContaining({blahDeviceLink: requestBytes}));
    expect(JSON.stringify(h.invokeApi.mock.calls)).not.toContain(parameter);
  });

  it('polls the current token and checks for a grant before re-exporting on expiry', async() => {
    const h = harness();
    await begin(h);
    await h.run({action: 'poll'});
    expect(h.invokeApi.mock.calls.map(([method]) => method)).toEqual(['auth.exportLoginToken', 'blah.getDeviceLink']);
    await vi.advanceTimersByTimeAsync(30000);
    await h.run({action: 'poll'});
    expect(h.invokeApi.mock.calls.map(([method]) => method)).toEqual([
      'auth.exportLoginToken', 'blah.getDeviceLink', 'blah.getDeviceLink', 'auth.exportLoginToken'
    ]);
    expect(h.invokeApi.mock.calls[3][2]).toMatchObject({blahDeviceLink: requestBytes});
    expect(mock.begin).toHaveBeenCalledOnce();
  });

  it('opens an accepted response on an expired token before considering re-export', async() => {
    const h = harness();
    await begin(h);
    await vi.advanceTimersByTimeAsync(30000);
    h.invokeApi.mockResolvedValueOnce({request: requestBytes, response: responseBytes});
    expect(await h.run({action: 'poll'})).toEqual({needsPassword: true});
    expect(mock.open).toHaveBeenCalledWith(expect.anything(), responseBytes, new Uint8Array([10, 11]));
    expect(h.invokeApi).toHaveBeenCalledTimes(2);
    expect(await h.run({action: 'poll'})).toEqual({needsPassword: true});
    expect(mock.open).toHaveBeenCalledOnce();
  });

  it('uses the DC clock offset when deciding whether the displayed token expired', async() => {
    const h = harness(1, 20);
    await begin(h);
    await vi.advanceTimersByTimeAsync(9999);
    await h.run({action: 'poll'});
    expect(h.invokeApi).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await h.run({action: 'poll'});
    expect(h.invokeApi.mock.calls.map(([method]) => method)).toEqual([
      'auth.exportLoginToken', 'blah.getDeviceLink', 'blah.getDeviceLink', 'auth.exportLoginToken'
    ]);
  });

  it('treats a response-opening failure as fatal, destroying the session and refusing further polling', async() => {
    const h = harness();
    await begin(h);
    h.invokeApi.mockResolvedValueOnce({response: responseBytes});
    mock.open.mockRejectedValue(new Error('wrongHome'));
    await expect(h.run({action: 'poll'})).rejects.toThrow('wrongHome');
    expect(mock.destroy).toHaveBeenCalledOnce();
    await expect(h.run({action: 'poll'})).rejects.toMatchObject({type: 'BLAH_LINK_CANCELLED'});
    expect(h.invokeApi).toHaveBeenCalledTimes(2);
    expect(mock.install).not.toHaveBeenCalled();
  });

  it('waits for custody and slot binding before the proof export, then returns loginTokenSuccess', async() => {
    const h = harness();
    await approved(h);
    let finish: () => void;
    const stored = new Promise<void>(resolve => finish = resolve);
    mock.install.mockReturnValue(stored);
    const success = {_: 'auth.loginTokenSuccess', authorization: {_: 'auth.authorization', user: {id: 42}}};
    h.invokeApi.mockResolvedValueOnce(success);
    const completion = h.run({action: 'complete', password: 'local password'});
    await vi.waitFor(() => expect(mock.install).toHaveBeenCalled());
    expect(h.invokeApi).toHaveBeenCalledTimes(2);
    expect(mock.install).toHaveBeenCalledWith(1, contents, 'local password', expect.any(Function));
    finish();
    expect(await completion).toEqual({loginToken: success});
    const [method, , options] = h.invokeApi.mock.calls[2];
    expect(method).toBe('auth.exportLoginToken');
    expect(options).not.toHaveProperty('blahDeviceLink');
    expect(contents).toEqual(new Uint8Array(2));
    expect(mock.destroy).toHaveBeenCalledOnce();
  });

  it('keeps the installed custody when the proof export requires Telegram 2FA', async() => {
    const h = harness();
    await approved(h);
    h.invokeApi.mockRejectedValueOnce({type: 'SESSION_PASSWORD_NEEDED'});
    await expect(h.run({action: 'complete', password: 'local password'})).rejects.toMatchObject({type: 'SESSION_PASSWORD_NEEDED'});
    expect(mock.install).toHaveBeenCalledOnce();
    expect(mock.destroy).toHaveBeenCalledOnce();
    expect(contents).toEqual(new Uint8Array(2));
  });

  it('never exports with proof after custody storage fails', async() => {
    const h = harness();
    await approved(h);
    mock.install.mockRejectedValue(new Error('Storage failed'));
    await expect(h.run({action: 'complete', password: 'local password'})).rejects.toThrow('Storage failed');
    expect(h.invokeApi).toHaveBeenCalledTimes(2);
  });

  it('cancel clears private buffers and timers, and drops a response arriving late', async() => {
    const h = harness();
    await begin(h);
    let finish: (result: unknown) => void;
    h.invokeApi.mockReturnValueOnce(new Promise(resolve => finish = resolve));
    const polling = h.run({action: 'poll'});
    const rejected = expect(polling).rejects.toMatchObject({type: 'BLAH_LINK_CANCELLED'});
    await vi.waitFor(() => expect(h.invokeApi).toHaveBeenCalledTimes(2));
    await h.run({action: 'cancel'});
    finish({response: responseBytes});
    await rejected;
    expect(mock.open).not.toHaveBeenCalled();
    expect(mock.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancel wipes an already opened grant', async() => {
    const h = harness();
    await approved(h);
    await h.run({action: 'cancel'});
    expect(contents).toEqual(new Uint8Array(2));
    expect(mock.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a session when cancelled before async initialization returns', async() => {
    const h = harness();
    const starting = begin(h);
    const rejected = expect(starting).rejects.toMatchObject({type: 'BLAH_LINK_CANCELLED'});
    await h.run({action: 'cancel'});
    await rejected;
    expect(mock.begin).not.toHaveBeenCalled();
    expect(h.invokeApi).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('wipes a grant whose crypto operation finishes after cancellation', async() => {
    const h = harness();
    await begin(h);
    h.invokeApi.mockResolvedValueOnce({response: responseBytes});
    let finish: (value: unknown) => void;
    mock.open.mockReturnValueOnce(new Promise(resolve => finish = resolve));
    const polling = h.run({action: 'poll'});
    const rejected = expect(polling).rejects.toMatchObject({type: 'BLAH_LINK_CANCELLED'});
    await vi.waitFor(() => expect(mock.open).toHaveBeenCalledOnce());
    await h.run({action: 'cancel'});
    finish({keyFileContents: contents});
    await rejected;
    expect(contents).toEqual(new Uint8Array(2));
    expect(mock.install).not.toHaveBeenCalled();
  });
});

describe('O device-link approval', () => {
  it('distinguishes a Telegram link with no blah parameter before any network or custody access', async() => {
    const h = harness();
    await expect(h.run({action: 'inspect', link: link.split('&blah=')[0]})).rejects.toMatchObject({type: 'BLAH_LINK_REQUIRED'});
    expect(h.invokeApi).not.toHaveBeenCalled();
    expect(mock.identity).not.toHaveBeenCalled();
    expect(parseDeviceLink(link)).toEqual({token, parameter});
  });

  it('refuses a digest mismatch before using or certifying the request', async() => {
    const h = harness();
    mock.inspect.mockRejectedValue(new Error('requestDigestMismatch'));
    await expect(h.run({action: 'inspect', link})).rejects.toThrow('requestDigestMismatch');
    expect(mock.inspect).toHaveBeenCalledWith(parameter, requestBytes);
    expect(mock.identity).not.toHaveBeenCalled();
    expect(mock.certify).not.toHaveBeenCalled();
    expect(mock.respond).not.toHaveBeenCalled();
  });

  it('refuses incompatible algorithms before certification', async() => {
    const h = harness();
    mock.inspect.mockResolvedValue({device: [5], label: 'Native browser', verifies: [2]});
    await expect(h.run({action: 'inspect', link})).rejects.toMatchObject({type: 'BLAH_LINK_ALGORITHM'});
    expect(mock.certify).not.toHaveBeenCalled();
    expect(mock.identity).not.toHaveBeenCalled();
  });

  it('reports locked custody for the UI unlock prompt', async() => {
    const h = harness();
    mock.identity.mockResolvedValue({id: 'alice', domain: 'alice.example.org', unlocked: false});
    expect(await h.run({action: 'inspect', link})).toMatchObject({label: 'New browser', id: 'alice', unlocked: false});
    expect(mock.certify).not.toHaveBeenCalled();
    expect(mock.respond).not.toHaveBeenCalled();
  });

  it('cannot accept after publication fails', async() => {
    const h = harness();
    await h.run({action: 'inspect', link});
    mock.certify.mockRejectedValue(new Error('Profile publication failed: HTTP 503'));
    await expect(h.run({action: 'prepare', transferIdentity: true})).rejects.toThrow('503');
    await expect(h.run({action: 'accept'})).rejects.toMatchObject({type: 'DEVICE_LINK_INVALID'});
    expect(mock.respond).not.toHaveBeenCalled();
    expect(h.invokeApi.mock.calls.map(([method]) => method)).toEqual(['blah.getDeviceLink']);
  });

  it('waits for manual publication of the exact revision before sealing and accepting', async() => {
    const h = harness();
    mock.certify.mockResolvedValue({identity: info, manualPublication: true});
    await h.run({action: 'inspect', link});
    expect(await h.run({action: 'prepare', transferIdentity: true})).toMatchObject({manualPublication: true});
    mock.publication.mockResolvedValueOnce(true);
    await expect(h.run({action: 'accept'})).rejects.toMatchObject({type: 'DEVICE_LINK_PROFILE_STALE'});
    expect(mock.respond).not.toHaveBeenCalled();
    expect(h.invokeApi).toHaveBeenCalledOnce();
    await h.run({action: 'accept'});
    expect(mock.respond).toHaveBeenCalledOnce();
    expect(h.invokeApi.mock.calls[1][0]).toBe('auth.acceptLoginToken');
  });

  it.each([false, true])('passes the transfer choice (%s) through custody after saving the published revision', async(transferIdentity) => {
    const h = harness();
    await prepare(h, transferIdentity);
    await h.run({action: 'accept'});
    const payload = mock.respond.mock.calls[0][1];
    expect(payload).toMatchObject({parameter, request: requestBytes, profile: new Uint8Array(profile),
      domain: secret.domain, transferIdentity});
    expect(payload).not.toHaveProperty('metadata');
    expect(mock.save).toHaveBeenCalledWith(info, false);
    expect(mock.save.mock.invocationCallOrder[0]).toBeLessThan(mock.respond.mock.invocationCallOrder[0]);
    expect(h.invokeApi.mock.calls[1][2]).toMatchObject({blahDeviceLink: responseBytes});
  });

  it('retries stale host proofs after 1, 2, 4, 8 and 15 seconds, then returns a terminal clear error', async() => {
    const h = harness();
    await prepare(h);
    const times: number[] = [];
    const start = Date.now();
    h.invokeApi.mockImplementation(async() => { times.push(Date.now() - start); throw {type: 'DEVICE_LINK_PROFILE_STALE'}; });
    const accepting = h.run({action: 'accept'});
    const rejected = expect(accepting).rejects.toMatchObject({type: 'DEVICE_LINK_PROFILE_STALE'});
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(times).toEqual([0, 1000, 3000, 7000, 15000, 30000]);
    expect(mock.respond).toHaveBeenCalledOnce();
  });

  it('reseals the response when a retry changes the identity-transfer choice', async() => {
    const h = harness();
    await prepare(h, true);
    h.invokeApi.mockRejectedValue({type: 'DEVICE_LINK_PROFILE_STALE'});
    const stale = expect(h.run({action: 'accept'})).rejects.toMatchObject({type: 'DEVICE_LINK_PROFILE_STALE'});
    await vi.advanceTimersByTimeAsync(30000);
    await stale;
    const replacement = new Uint8Array([19, 2]);
    mock.respond.mockResolvedValueOnce(replacement);
    await h.run({action: 'prepare', transferIdentity: false});
    h.invokeApi.mockResolvedValue({_: 'authorization'});
    await h.run({action: 'accept'});
    expect(mock.respond.mock.calls.map(([, input]) => input.transferIdentity)).toEqual([true, false]);
    expect(h.invokeApi.mock.lastCall[2]).toMatchObject({blahDeviceLink: replacement});
  });

  it.each(['LOGIN_TOKEN_EXPIRED', 'LOGIN_TOKEN_INVALID'])('does not retry terminal %s', async(type) => {
    const h = harness();
    await prepare(h);
    h.invokeApi.mockRejectedValue({type});
    await expect(h.run({action: 'accept'})).rejects.toMatchObject({type});
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.invokeApi).toHaveBeenCalledTimes(2);
  });

  it('cancels a stale-profile retry without sending another acceptance', async() => {
    const h = harness();
    await prepare(h);
    h.invokeApi.mockRejectedValue({type: 'DEVICE_LINK_PROFILE_STALE'});
    const accepting = h.run({action: 'accept'});
    const rejected = expect(accepting).rejects.toMatchObject({type: 'BLAH_LINK_CANCELLED'});
    await vi.waitFor(() => expect(h.invokeApi).toHaveBeenCalledTimes(2));
    await h.run({action: 'cancel'});
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(h.invokeApi).toHaveBeenCalledTimes(2);
  });
});
