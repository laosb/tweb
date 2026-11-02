import {render} from 'solid-js/web';
import {afterEach, expect, it, vi} from 'vitest';
import {phrase, otherPhrase} from './identityFixture';
import {identityAction} from '@lib/blah/identity';
const popup = vi.hoisted(() => ({close: undefined as () => void, dispose: undefined as () => void}));
vi.mock('@lib/langPack', () => ({i18n: (key: string) => key}));
vi.mock('@lib/blah/HostedNameChooser', () => ({HostedNameChooser: (): null => null}));
vi.mock('@components/buttonTsx', () => ({default: (props: any) =>
  <button type="button" ref={props.ref} disabled={props.disabled} onClick={props.onClick}>{props.text}</button>}));
vi.mock('@components/inputFieldTsx', () => ({InputFieldTsx: (props: any) => {
  const input = document.createElement('input');
  input.addEventListener('input', () => props.onRawInput(input.value));
  props.instanceRef({input});
  return input;
}}));
vi.mock('@components/confirmationPopup', () => ({default: vi.fn()}));
vi.mock('@components/popups/indexTsx', () => {
  const Content = (props: any) => <div>{props.children}</div>;
  const Popup = (props: any) => { popup.close = props.onClose; return <div>{props.children}</div>; };
  return {default: Object.assign(Popup, {Header: Content, Title: Content, CloseButton: Content,
    Scrollable: Content, Body: Content}), usePopupContext: () => ({hide: () => popup.close()}),
  createPopup: (content: () => any) => { popup.dispose = render(content, document.body); }};
});
import showChatIdentitySetup from '@lib/blah/ChatIdentitySetup';
const settle = async() => { for(let i = 0; i < 30; i++) await Promise.resolve(); };
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find((element) => element.textContent === text);
  expect(button).toBeDefined(); button.click(); await settle();
}
afterEach(() => { popup.dispose?.(); document.body.replaceChildren(); });

it('resolves a cancelled durable chat attempt before displaying or accepting replacement words', async() => {
  const action = vi.fn(async(request) => identityAction(1, {...request, action: 'create', kind: 'channel'}));
  const identity = vi.fn((request) => identityAction(1, request));
  const props = {domain: 'news.example.org', attempt: 'cancelled', change: {action: 'createChannel',
    options: {title: 'News', about: '', broadcast: true}} as const, action, identityAction: identity};
  const first = showChatIdentitySetup(props);
  const cancelled = first.catch((error) => error.message);
  await vi.waitFor(() => expect(document.querySelectorAll('ol li')).toHaveLength(24));
  await vi.advanceTimersByTimeAsync(3000); await click('Done');
  for(const input of document.querySelectorAll('input')) {
    input.value = 'abandon'; input.dispatchEvent(new Event('input', {bubbles: true}));
  }
  await click('Continue');
  await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(document.body.textContent).toContain('BlahExportProfile'));
  popup.close(); expect(await cancelled).toBe('BLAH_CHAT_CANCELLED'); popup.dispose(); document.body.replaceChildren();
  identity.mockClear();
  const second = showChatIdentitySetup(props);
  const cancelledAgain = second.catch((error) => error.message);
  await vi.waitFor(() => expect(document.body.textContent).toContain('BlahExportProfile'));
  expect(document.querySelector('ol')).toBeNull();
  expect(identity.mock.calls.map(([request]) => request.action)).toEqual(['attempt']);
  await expect(identityAction(1, {action: 'create', kind: 'channel', attempt: props.attempt,
    domain: props.domain, phrase: otherPhrase})).rejects.toThrow('different recovery words');
  expect((await identityAction(1, {action: 'words', kind: 'channel', id: '01'.repeat(32)})).words.join(' ')).toBe(phrase);
  popup.close(); expect(await cancelledAgain).toBe('BLAH_CHAT_CANCELLED');
});
