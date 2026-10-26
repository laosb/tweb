import {render} from 'solid-js/web';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import appNavigationController from '@components/appNavigationController';
import {detailsSession} from '@lib/blah/detailsSession';

const mock = vi.hoisted(() => ({link: vi.fn(), identity: vi.fn(), toast: vi.fn(), mount: undefined as any,
  close: undefined as (() => void), hide: vi.fn(), linked: vi.fn()}));
vi.mock('@lib/langPack', () => ({default: {format: (key: string) => key},
  i18n: (key: string, args: (string | Node)[] = []) => {
    const fragment = document.createDocumentFragment();
    fragment.append(key, ...args);
    return fragment;
  }}));
vi.mock('@environment/touchSupport', () => ({default: false}));
vi.mock('@helpers/dom/focusWhenSettled', () => ({default: vi.fn()}));
vi.mock('@lib/calls/helpers/getStream', () => ({default: vi.fn()}));
vi.mock('@lib/blah/identityFiles', () => ({exportIdentityFile: vi.fn()}));
vi.mock('@components/toast', () => ({toastNew: mock.toast}));
vi.mock('@components/buttonTsx', () => ({default: (props: any) =>
  <button ref={props.ref} type="button" disabled={props.disabled} onClick={props.onClick}>{props.text}</button>}));
vi.mock('@lib/blah/IdentityInput', () => ({default: (props: any) =>
  <input ref={props.ref} aria-label={props.label} type={props.type} value={props.value || ''} disabled={props.disabled}
    onInput={(event) => props.onInput?.(event.currentTarget.value)} />}));
vi.mock('@components/checkboxFieldTsx', () => ({default: (props: any) =>
  <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={event => props.onChange(event.currentTarget.checked)} />}));
vi.mock('@components/rowTsx', () => {
  const Content = (props: any) => <div>{props.children}</div>;
  return {default: Object.assign(Content, {Title: Content, CheckboxField: Content})};
});
vi.mock('@components/popups/indexTsx', () => {
  const Content = (props: any) => <div>{props.children}</div>;
  const Popup = (props: any) => { mock.close = props.onClose; return <div role="dialog">{props.children}</div>; };
  return {default: Object.assign(Popup, {Header: Content, Body: Content, Scrollable: Content,
    CloseButton: (): null => null, Title: (): null => null}),
  createPopup: (factory: () => any) => mock.mount(factory), usePopupContext: () => ({hide: mock.hide})};
});
import showDeviceLinkPopup from '@lib/blah/DeviceLinkPopup';

let host: HTMLDivElement;
let dispose: () => void;
const settle = async() => { for(let i = 0; i < 20; ++i) await Promise.resolve(); };
function button(text: string) {
  const found = [...host.querySelectorAll('button')].find(value => value.textContent === text);
  expect(found, 'Missing button ' + text).toBeDefined();
  return found;
}
async function inspect() {
  const input = host.querySelector<HTMLInputElement>('[aria-label=BlahLinkPaste]');
  input.value = 'tg://login?token=token&blah=secret';
  input.dispatchEvent(new Event('input', {bubbles: true}));
  button('Continue').click();
  await settle();
}
function mount() {
  showDeviceLinkPopup({managers: {appAccountManager: {blahDeviceLink: mock.link, blahIdentity: mock.identity}} as any,
    id: 'alice', onLinked: mock.linked});
}

beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement('div'); document.body.append(host);
  mock.mount = (factory: () => any) => dispose = render(factory, host);
  mock.hide.mockImplementation(() => mock.close());
  mock.link.mockImplementation(async(request) => request.action === 'inspect' ?
    {id: 'alice', domain: 'alice.example.org', label: 'New browser', unlocked: true} : {});
});
afterEach(async() => {
  mock.close?.();
  await settle();
  dispose?.();
  host.remove();
  mock.close = undefined;
});

describe('O device-link confirmation UI', () => {
  it('keeps paste available without a camera and checks identity transfer by default', async() => {
    mount();
    await inspect();
    expect(host.textContent).toContain('New browser');
    expect(host.querySelector<HTMLInputElement>('input[type=checkbox]').checked).toBe(true);
    button('BlahLinkApprove').click();
    await settle();
    expect(mock.link.mock.calls.map(([request]) => request.action)).toEqual(['inspect', 'prepare', 'accept', 'cancel']);
    expect(mock.link.mock.calls[1][0]).toMatchObject({transferIdentity: true});
    expect(mock.linked).toHaveBeenCalledOnce();
    expect(mock.hide).toHaveBeenCalledOnce();
  });

  it('sends an explicit false when identity transfer is unchecked', async() => {
    mount(); await inspect();
    host.querySelector<HTMLInputElement>('input[type=checkbox]').click();
    button('BlahLinkApprove').click();
    await settle();
    expect(mock.link.mock.calls[1][0]).toMatchObject({action: 'prepare', transferIdentity: false});
  });

  it.each([
    ['ltr', false, 'Escape'], ['ltr', true, 'Escape'],
    ['ltr', false, 'Back'], ['ltr', true, 'Back'],
    ['rtl', false, 'Escape'], ['rtl', true, 'Escape'],
    ['rtl', false, 'Back'], ['rtl', true, 'Back']
  ] as const)('closes details in %s after approval (transfer: %s) on the first %s', async(direction, transferIdentity, navigation) => {
    const realToast = await vi.importActual<typeof import('@components/toast')>('@components/toast');
    vi.useFakeTimers();
    // Exercise the actual toast/navigation capture: a mocked success toast hid this bug.
    mock.toast.mockImplementation(realToast.toastNew);
    mock.identity.mockResolvedValue({});
    const session = detailsSession(mock.identity, 'alice', () => {});
    await session.action({action: 'unlock'});
    mock.linked.mockImplementation(() => session.action({action: 'inspect'}));
    const details = document.createElement('div');
    details.dir = direction;
    const back = document.createElement('button');
    details.append(back);
    document.body.append(details);
    let closing: Promise<unknown>;
    const item = {type: 'left' as const, onPop: () => {
      closing = session.close();
      details.remove();
    }};
    appNavigationController.pushItem(item);
    back.addEventListener('click', () => appNavigationController.back('left'));
    try {
      mount(); await inspect();
      if(!transferIdentity) host.querySelector<HTMLInputElement>('input[type=checkbox]').click();
      button('BlahLinkApprove').click();
      await settle();
      expect(mock.link.mock.calls[1][0]).toMatchObject({transferIdentity});
      expect(mock.hide).toHaveBeenCalledOnce();
      // Navigate while the old success toast would still be visible (before its 3 s timeout).
      if(navigation === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
      else back.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, detail: 1}));
      expect(details.isConnected).toBe(false);
      expect(session.isClosed()).toBe(true);
      await closing;
      expect(mock.identity).toHaveBeenLastCalledWith({action: 'lock', id: 'alice'});
    } finally {
      appNavigationController.removeItem(item);
      realToast.hideToast();
      await session.close();
      details.remove();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('prompts to unlock before preparation and relocks custody opened by this popup', async() => {
    mock.link.mockImplementation(async(request) => request.action === 'inspect' ?
      {id: 'alice', domain: 'alice.example.org', label: 'New browser', unlocked: false} : {});
    mount(); await inspect();
    button('BlahLinkApprove').click();
    await settle();
    expect(mock.link).toHaveBeenCalledOnce();
    const password = host.querySelector<HTMLInputElement>('input[type=password]');
    expect(password).not.toBeNull();
    password.value = 'custody password';
    button('BlahUnlockIdentity').click();
    await settle();
    expect(password.value).toBe('');
    expect(mock.identity.mock.calls).toEqual([
      [{action: 'unlock', id: 'alice', password: 'custody password'}], [{action: 'lock', id: 'alice'}]
    ]);
    expect(mock.link.mock.calls.map(([request]) => request.action)).toEqual(['inspect', 'prepare', 'accept', 'cancel']);
  });

  it('does not accept when certification or publication fails', async() => {
    mount(); await inspect();
    mock.link.mockRejectedValueOnce(new Error('Profile publication failed: HTTP 503'));
    button('BlahLinkApprove').click();
    await settle();
    expect(mock.link.mock.calls.map(([request]) => request.action)).toEqual(['inspect', 'prepare']);
    expect(mock.toast).not.toHaveBeenCalled();
    expect(host.querySelector('[role=status]').textContent).toBe('BlahLinkPublicationFailed');
  });

  it('requires a manual publish continuation before calling accept', async() => {
    mount(); await inspect();
    mock.link.mockResolvedValueOnce({manualPublication: true, identity: {domain: 'alice.example.org', profile: [1]}});
    button('BlahLinkApprove').click();
    await settle();
    expect(mock.link.mock.calls.map(([request]) => request.action)).toEqual(['inspect', 'prepare']);
    expect(host.textContent).toContain('https://alice.example.org/.well-known/blah/profile.cbor');
    button('Continue').click();
    await settle();
    expect(mock.link.mock.calls[2][0].action).toBe('accept');
  });

  it.each([
    ['BLAH_LINK_REQUIRED', 'BlahLinkRequired'],
    ['BLAH_LINK_ALGORITHM', 'BlahLinkAlgorithm'],
    ['DEVICE_LINK_PROFILE_STALE', 'BlahLinkProfileStale'],
    ['LOGIN_TOKEN_EXPIRED', 'BlahLinkExpired'],
    ['LOGIN_TOKEN_INVALID', 'BlahLinkExpired']
  ])('explains %s using its specific actionable message', async(type, message) => {
    mount();
    mock.link.mockRejectedValueOnce({type});
    await inspect();
    expect(host.querySelector('[role=status]').textContent).toBe(message);
    expect(mock.toast).not.toHaveBeenCalled();
    expect(mock.linked).not.toHaveBeenCalled();
  });

  it('closing while unlock is in flight prevents approval and relocks a late unlock', async() => {
    mock.link.mockResolvedValueOnce({id: 'alice', domain: 'alice.example.org', label: 'New browser', unlocked: false});
    mount(); await inspect();
    button('BlahLinkApprove').click(); await settle();
    let unlock: () => void;
    mock.identity.mockReturnValueOnce(new Promise<void>(resolve => unlock = resolve));
    host.querySelector<HTMLInputElement>('input[type=password]').value = 'password';
    button('BlahUnlockIdentity').click(); await settle();
    mock.close();
    unlock(); await settle();
    expect(mock.identity.mock.lastCall[0]).toEqual({action: 'lock', id: 'alice'});
    expect(mock.link.mock.calls.map(([request]) => request.action)).toEqual(['inspect', 'cancel']);
    expect(mock.toast).not.toHaveBeenCalled();
  });
});
