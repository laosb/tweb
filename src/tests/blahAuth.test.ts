import {describe, expect, it, vi} from 'vitest';
import App from '@config/app';
import AppAccountManager from '@appManagers/appAccountManager';
import type {AuthSentCode, AuthSentCodeType} from '@layer';
import normalizeBlahIdentifier from '@/pages/normalizeBlahIdentifier';
import requestLoginCode from '@/pages/requestLoginCode';

describe('Blah identifiers', () => {
  it.each([
    ['12345', '+99912345'],
    [' 00123 ', '+99900123'],
    ['999123', '999123'],
    ['+999123', '+999123'],
    [' Me+login@Example.org ', 'Me+login@Example.org'],
    ['+1 234-567', '+1 234-567'],
    ['   ', '']
  ])('normalizes %j to %j without rewriting an address', (input, expected) => {
    expect(normalizeBlahIdentifier(input)).toBe(expected);
  });
});

function makeManager(result: unknown) {
  const manager = new AppAccountManager();
  const apiManager = {
    invokeApi: vi.fn().mockResolvedValue(result),
    setUser: vi.fn()
  };
  Object.assign(manager, {apiManager});
  return {manager, apiManager};
}

const emailType: AuthSentCodeType.authSentCodeTypeEmailCode = {
  _: 'auth.sentCodeTypeEmailCode',
  pFlags: {},
  email_pattern: 'm***@example.org',
  length: 8
};

function sentCode(type: AuthSentCodeType = emailType): AuthSentCode.authSentCode {
  return {
    _: 'auth.sentCode',
    phone_code_hash: 'hash',
    timeout: 30,
    type
  };
}

describe('account login wrappers', () => {
  it('sends the identifier unchanged with standard API credentials', async() => {
    const result = sentCode();
    const {manager, apiManager} = makeManager(result);
    expect(await manager.sendLoginCode('me+login@example.org')).toBe(result);
    expect(apiManager.invokeApi).toHaveBeenCalledWith('auth.sendCode', {
      phone_number: 'me+login@example.org',
      api_id: App.id,
      api_hash: App.hash,
      settings: {_: 'codeSettings', pFlags: {}}
    });
    expect(apiManager.setUser).not.toHaveBeenCalled();
  });

  it.each([
    ['auth.sentCodeTypeEmailCode', {email_verification: {_: 'emailVerificationCode', code: '12345678'}}],
    ['auth.sentCodeTypeSms', {phone_code: '12345678'}],
    ['auth.sentCodeTypeFragmentSms', {phone_code: '12345678'}],
    ['auth.sentCodeTypeApp', {phone_code: '12345678'}]
  ] as const)('uses the appropriate verification field for %s', async(type, verification) => {
    const user = {_: 'user', id: 42};
    const result = {_: 'auth.authorization', user};
    const {manager, apiManager} = makeManager(result);
    expect(await manager.signInWithCode('identifier', 'hash', type, '12345678')).toBe(result);
    expect(apiManager.invokeApi).toHaveBeenCalledWith('auth.signIn', {
      phone_number: 'identifier',
      phone_code_hash: 'hash',
      ...verification
    }, {ignoreErrors: true});
    expect(apiManager.setUser).toHaveBeenCalledWith(user);
  });

  it('handles authorization on sendCode and leaves sign-up responses unauthenticated', async() => {
    const user = {_: 'user', id: 42};
    const {manager, apiManager} = makeManager({
      _: 'auth.sentCodeSuccess', authorization: {_: 'auth.authorization', user}
    });
    await manager.sendLoginCode('+999123');
    expect(apiManager.setUser).toHaveBeenCalledWith(user);
    apiManager.setUser.mockClear();
    apiManager.invokeApi.mockResolvedValue({_: 'auth.authorizationSignUpRequired'});
    await manager.signInWithCode('+999123', 'hash', 'auth.sentCodeTypeSms', '12345');
    expect(apiManager.setUser).not.toHaveBeenCalled();
  });

  it('propagates errors for the existing password/error flow', async() => {
    const {manager, apiManager} = makeManager(undefined);
    const error = {type: 'SESSION_PASSWORD_NEEDED'};
    apiManager.invokeApi.mockRejectedValue(error);
    await expect(manager.signInWithCode('email@example.org', 'hash', emailType._, '12345678')).rejects.toBe(error);
    expect(apiManager.setUser).not.toHaveBeenCalled();
  });

  it('waits for account persistence before allowing navigation to IM', async() => {
    const {manager, apiManager} = makeManager({_: 'auth.authorization', user: {id: 42}});
    let finishPersistence: () => void;
    apiManager.setUser.mockReturnValue(new Promise<void>((resolve) => {
      finishPersistence = resolve;
    }));
    const finished = vi.fn();
    const promise = manager.signInWithCode('+999123', 'hash', emailType._, '12345678').then(finished);
    await Promise.resolve();
    expect(apiManager.setUser).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();
    finishPersistence();
    await promise;
    expect(finished).toHaveBeenCalledOnce();
  });
});

function makeFlow(result: unknown) {
  const sendLoginCode = vi.fn().mockResolvedValue(result);
  const navigate = vi.fn();
  const toIm = vi.fn().mockResolvedValue(undefined);
  const flow = {
    managers: {appAccountManager: {sendLoginCode}},
    navigate,
    toIm
  } as unknown as Parameters<typeof requestLoginCode>[0];
  return {flow, sendLoginCode, navigate, toIm};
}

describe('shared login-code navigation', () => {
  it.each([
    emailType,
    {_: 'auth.sentCodeTypeFragmentSms', url: 'https://fragment.com/login/test', length: 6} as const
  ])('preserves the entire $_ response for code rendering and persisted resume', async(type) => {
    const result = sentCode(type);
    const {flow, navigate} = makeFlow(result);
    await requestLoginCode(flow, 'email@example.org', () => true);
    expect(navigate).toHaveBeenCalledWith({
      name: 'authCode',
      payload: {...result, phone_number: 'email@example.org'}
    });
    expect(result).not.toHaveProperty('phone_number');
  });

  it('enters IM on immediate authorization', async() => {
    const {flow, navigate, toIm} = makeFlow({
      _: 'auth.sentCodeSuccess', authorization: {_: 'auth.authorization'}
    });
    await requestLoginCode(flow, '+999123', () => true);
    expect(toIm).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores a response after the entry card is disposed', async() => {
    const {flow, navigate, toIm} = makeFlow(sentCode());
    await requestLoginCode(flow, '+999123', () => false);
    expect(navigate).not.toHaveBeenCalled();
    expect(toIm).not.toHaveBeenCalled();
  });

  it('rejects unsupported responses instead of mounting a broken code card', async() => {
    const {flow, navigate} = makeFlow({_: 'auth.sentCodePaymentRequired'});
    await expect(requestLoginCode(flow, '+999123', () => true)).rejects.toThrow('auth.sentCodePaymentRequired');
    expect(navigate).not.toHaveBeenCalled();
  });
});
