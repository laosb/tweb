import {render} from 'solid-js/web';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

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
vi.mock('@lib/blah/profileFiles', () => ({exportProfile: vi.fn()}));
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
    {id: 'alice', domain: 'alice.example.org', label: 'New browser'} : {});
});
afterEach(async() => {
  mock.close?.();
  await settle();
  dispose?.();
  host.remove();
  mock.close = undefined;
});

describe('holder QR approval UI', () => {
  it('keeps paste available and defaults seed transfer to off', async() => {
    mount(); await inspect();
    expect(host.textContent).toContain('New browser');
    expect(host.querySelector<HTMLInputElement>('input[type=checkbox]').checked).toBe(false);
    button('BlahLinkApprove').click(); await settle();
    expect(mock.link.mock.calls.map(([request]) => request.action)).toEqual(['inspect', 'prepare', 'accept', 'cancel']);
    expect(mock.link.mock.calls[1][0]).toMatchObject({transferIdentity: false});
    expect(mock.identity).not.toHaveBeenCalled();
    expect(mock.linked).toHaveBeenCalledOnce();
  });
  it('transfers the seed only after explicit selection', async() => {
    mount(); await inspect();
    host.querySelector<HTMLInputElement>('input[type=checkbox]').click();
    button('BlahLinkApprove').click(); await settle();
    expect(mock.link.mock.calls[1][0]).toMatchObject({transferIdentity: true});
  });
  it('offers publication before accepting a manually hosted revision', async() => {
    mock.link.mockImplementation(async(request) => request.action === 'inspect' ?
      {label: 'New browser', id: 'alice'} : request.action === 'prepare' ?
        {manualPublication: true, identity: {domain: 'alice.example.org', profile: [1]}} : {});
    mount(); await inspect(); button('BlahLinkApprove').click(); await settle();
    expect(mock.link.mock.calls.map(([request]) => request.action)).toEqual(['inspect', 'prepare']);
    expect(button('BlahExportProfile')).toBeDefined();
    button('Continue').click(); await settle();
    expect(mock.linked).toHaveBeenCalledOnce();
  });
  it('shows a non-holder error without requesting a custody password', async() => {
    mock.link.mockRejectedValue({type: 'BLAH_LINK_APPROVAL_REQUIRED'});
    mount(); await inspect();
    expect(host.textContent).toContain('BlahLinkApprovalRequired');
    expect(host.querySelector('input[type=password]')).toBeNull();
  });
});
