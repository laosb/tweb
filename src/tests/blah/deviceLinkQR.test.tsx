import {render} from 'solid-js/web';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mock = vi.hoisted(() => ({link: vi.fn(), paint: vi.fn(), navigate: vi.fn(), toIm: vi.fn(), setUser: vi.fn(),
  listeners: new Map<string, Set<(...args: any[]) => void>>(), pushState: vi.fn()}));
vi.mock('@config/blah', () => ({default: {defaultDcId: 1}}));
vi.mock('@lib/accounts/accountController', () => ({default: {getUserIds: async(): Promise<UserId[]> => []}}));
vi.mock('@lib/rootScope', () => ({default: {
  addEventListener: (name: string, listener: (...args: any[]) => void) => {
    if(!mock.listeners.has(name)) mock.listeners.set(name, new Set());
    mock.listeners.get(name).add(listener);
  },
  removeEventListener: (name: string, listener: (...args: any[]) => void) => mock.listeners.get(name)?.delete(listener)
}}));
vi.mock('@/pages/authFlow', () => ({useAuthFlow: () => ({accountNumber: 1,
  managers: {appAccountManager: {blahDeviceLink: mock.link}, apiManager: {setUser: mock.setUser},
    appStateManager: {pushToState: mock.pushState}}, navigate: mock.navigate, toIm: mock.toIm})}));
vi.mock('@lib/langPack', () => ({default: {format: (key: string) => key}, i18n: (key: string) => key}));
vi.mock('@helpers/dom/focusWhenSettled', () => ({default: vi.fn()}));
vi.mock('@helpers/qrCode/paintQrCode', () => ({paintQrCode: mock.paint}));
vi.mock('qr-code-styling', () => ({default: class {}}));
vi.mock('@components/putPreloader', () => ({putPreloader: (): undefined => undefined}));
vi.mock('@components/languageChangeButton', () => ({default: (): null => null}));
vi.mock('@components/passkeyLoginButton', () => ({default: (): null => null}));
vi.mock('@components/buttonTsx', () => ({default: (props: any) =>
  <button type="button" disabled={props.disabled} onClick={props.onClick}>{props.text}</button>}));
vi.mock('@lib/blah/IdentityInput', () => ({default: (props: any) =>
  <input ref={props.ref} aria-label={props.label} type={props.type} disabled={props.disabled} />}));
vi.mock('@/pages/AuthCard', () => ({default: (props: any) => <div>{props.header}{props.children}</div>}));
vi.mock('@components/mediaHeader', () => {
  const Content = (props: any) => <div>{props.children}</div>;
  return {default: Object.assign(Content, {Subtitle: Content, Sticker: (props: any) => <div ref={props.ref} />})};
});
import SignQRCard from '@/pages/cards/SignQRCard';

const token = new Uint8Array([255, 254, 253]);
const next = {loginToken: {_: 'auth.loginToken', token, expires: 30}, parameter: 'private-qr-code'};
let host: HTMLDivElement;
let dispose: (() => void) | undefined;
const settle = async() => { for(let i = 0; i < 15; ++i) await Promise.resolve(); };

async function mount() {
  host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <SignQRCard spec={{name: 'signQR'}} />, host);
  await vi.dynamicImportSettled();
  await settle();
}
function emit(name: string, ...args: unknown[]) {
  mock.listeners.get(name)?.forEach(listener => listener(...args));
}
function button(text: string) {
  return [...host.querySelectorAll('button')].find(value => value.textContent === text);
}
async function showPassword() {
  mock.link.mockImplementation(async(request) => request.action === 'begin' ? next :
    request.action === 'poll' ? {needsPassword: true} : {});
  await mount();
  await vi.advanceTimersByTimeAsync(3000);
  await vi.dynamicImportSettled();
  await settle();
  expect(host.querySelector('input[type=password]')).not.toBeNull();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mock.listeners.clear();
  mock.link.mockImplementation(async(request) => ['begin', 'poll'].includes(request.action) ? next : {});
  mock.paint.mockImplementation(async({host}: {host: HTMLElement}) => {
    const canvas = document.createElement('canvas');
    host.append(canvas);
    return {canvas};
  });
});
afterEach(() => {
  dispose?.(); dispose = undefined;
  host?.remove();
  vi.useRealTimers();
});

describe('Blah SignQRCard lifecycle', () => {
  it('paints the token and blah parameter and polls every three seconds', async() => {
    await mount();
    expect(mock.paint.mock.calls[0][0].data).toBe('tg://login?token=__79&blah=private-qr-code');
    expect(mock.link).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2999);
    expect(mock.link).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.link.mock.calls[1][0]).toMatchObject({action: 'poll', attempt: mock.link.mock.calls[0][0].attempt});
    await vi.advanceTimersByTimeAsync(3000);
    expect(mock.link).toHaveBeenCalledTimes(3);
    expect(mock.paint).toHaveBeenCalledOnce();
  });

  it('wakes early only for this account login-token update', async() => {
    await mount();
    emit('blah_login_token', 2);
    await settle();
    expect(mock.link).toHaveBeenCalledOnce();
    emit('blah_login_token', 1);
    await settle();
    expect(mock.link).toHaveBeenCalledTimes(2);
  });

  it('stops polling on fatal open failure and shows an actionable failure', async() => {
    await mount();
    mock.link.mockRejectedValueOnce(new Error('wrongHome'));
    await vi.advanceTimersByTimeAsync(3000);
    await vi.dynamicImportSettled();
    expect(host.querySelector('[role=alert]').textContent).toBe('BlahLinkFailed');
    await vi.advanceTimersByTimeAsync(30000);
    expect(mock.link).toHaveBeenCalledTimes(2);
    expect(mock.toIm).not.toHaveBeenCalled();
  });

  it('submits the new local password and enters chats only after loginTokenSuccess', async() => {
    await showPassword();
    const user = {_: 'user', id: 42};
    mock.link.mockResolvedValueOnce({loginToken: {_: 'auth.loginTokenSuccess', authorization: {_: 'auth.authorization', user}}});
    const input = host.querySelector<HTMLInputElement>('input[type=password]');
    input.value = 'new local password';
    button('BlahSignIn').click();
    await settle();
    expect(mock.link.mock.lastCall[0]).toMatchObject({action: 'complete', password: 'new local password'});
    expect(input.value).toBe('');
    expect(mock.setUser).toHaveBeenCalledExactlyOnceWith(user);
    expect(mock.toIm).toHaveBeenCalledOnce();
  });

  it('continues SESSION_PASSWORD_NEEDED through the existing password card', async() => {
    await showPassword();
    mock.link.mockRejectedValueOnce({type: 'SESSION_PASSWORD_NEEDED'});
    host.querySelector<HTMLInputElement>('input[type=password]').value = 'new local password';
    button('BlahSignIn').click();
    await settle();
    expect(mock.navigate).toHaveBeenCalledExactlyOnceWith({name: 'password'});
    expect(mock.toIm).not.toHaveBeenCalled();
    expect(mock.setUser).not.toHaveBeenCalled();
  });

  it('cancel and unmount release the worker attempt, polling timer and subscriptions', async() => {
    await mount();
    const attempt = mock.link.mock.calls[0][0].attempt;
    button('BlahUseIdentity').click();
    expect(mock.navigate).toHaveBeenCalledExactlyOnceWith({name: 'signIn'});
    dispose(); dispose = undefined;
    await settle();
    expect(mock.link.mock.lastCall[0]).toEqual({action: 'cancel', attempt});
    expect([...mock.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30000);
    expect(mock.link).toHaveBeenCalledTimes(2);
  });
});
