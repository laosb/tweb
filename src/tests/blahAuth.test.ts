import {describe, expect, it, vi} from 'vitest';
import App from '@config/app';
import AppAccountManager from '@appManagers/appAccountManager';
import type {AuthSentCode, AuthSentCodeType} from '@layer';
import {isManagedAccountToken} from '@lib/blah/managedAccount';
import requestLoginCode from '@/pages/requestLoginCode';

const bindManagedAccount = vi.hoisted(() => vi.fn());
vi.mock('@lib/blah/accountStorage', () => ({bindManagedAccount}));

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
    expect(await manager.sendCode('me+login@example.org')).toBe(result);
    expect(apiManager.invokeApi).toHaveBeenCalledWith('auth.sendCode', {
      phone_number: 'me+login@example.org',
      api_id: App.id,
      api_hash: App.hash,
      settings: {_: 'codeSettings', pFlags: {}}
    });
    expect(apiManager.setUser).not.toHaveBeenCalled();
  });

  it('propagates errors for the existing password/error flow', async() => {
    const {manager, apiManager} = makeManager(undefined);
    const error = {type: 'SESSION_PASSWORD_NEEDED'};
    apiManager.invokeApi.mockRejectedValue(error);
    await expect(manager.signIn({phone_number: 'email@example.org', phone_code_hash: 'hash', email_verification: {_: 'emailVerificationCode', code: '12345678'}})).rejects.toBe(error);
    expect(apiManager.setUser).not.toHaveBeenCalled();
  });

  it('binds the slot to a managed account before saving its user', async() => {
    const user = {_: 'user', id: 42, pFlags: {}};
    const {manager, apiManager} = makeManager({_: 'auth.authorization', user});
    const order: string[] = [];
    bindManagedAccount.mockImplementationOnce(async() => { order.push('bind'); });
    apiManager.setUser.mockImplementationOnce(async() => { order.push('user'); });
    await manager.importManagedAccountAuthorization('42:' + 'a'.repeat(32));
    expect(apiManager.invokeApi).toHaveBeenCalledWith('auth.importBotAuthorization', {
      api_id: App.id,
      api_hash: App.hash,
      bot_auth_token: '42:' + 'a'.repeat(32)
    }, {ignoreErrors: true});
    expect(order).toEqual(['bind', 'user']);
  });

  it('logs a bot out instead of signing it in', async() => {
    const {manager, apiManager} = makeManager({_: 'auth.authorization', user: {_: 'user', id: 7, pFlags: {bot: true}}});
    bindManagedAccount.mockClear();
    await expect(manager.importManagedAccountAuthorization('7:' + 'a'.repeat(32))).rejects.toThrow('MANAGED_ACCOUNT_REQUIRED');
    expect(apiManager.invokeApi).toHaveBeenLastCalledWith('auth.logOut', {}, {ignoreErrors: true});
    expect(bindManagedAccount).not.toHaveBeenCalled();
    expect(apiManager.setUser).not.toHaveBeenCalled();
  });

  it('accepts only bot-shaped managed account tokens', () => {
    expect(isManagedAccountToken('42:' + 'a'.repeat(16))).toBe(true);
    for(const token of ['', '42', '0:' + 'a'.repeat(16), '42:' + 'a'.repeat(15), '42:' + 'a'.repeat(15) + '/', ' 42:' + 'a'.repeat(16)]) {
      expect(isManagedAccountToken(token)).toBe(false);
    }
  });
});

function makeFlow(result: unknown) {
  const sendCode = vi.fn().mockResolvedValue(result);
  const navigate = vi.fn();
  const toIm = vi.fn().mockResolvedValue(undefined);
  const flow = {
    managers: {appAccountManager: {sendCode}, apiManager: {setUser: vi.fn()}},
    navigate,
    toIm
  } as unknown as Parameters<typeof requestLoginCode>[0];
  return {flow, sendCode, navigate, toIm};
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

  it('waits for account persistence before allowing navigation to IM', async() => {
    const user = {_: 'user', id: 42};
    const {flow, toIm} = makeFlow({_: 'auth.sentCodeSuccess', authorization: {_: 'auth.authorization', user}});
    let finishPersistence: () => void;
    vi.mocked(flow.managers.apiManager.setUser).mockReturnValue(new Promise<void>((resolve) => {
      finishPersistence = resolve;
    }));
    const promise = requestLoginCode(flow, '+999123', () => true);
    await Promise.resolve();
    expect(flow.managers.apiManager.setUser).toHaveBeenCalledWith(user);
    expect(toIm).not.toHaveBeenCalled();
    finishPersistence();
    await promise;
    expect(toIm).toHaveBeenCalledOnce();
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
