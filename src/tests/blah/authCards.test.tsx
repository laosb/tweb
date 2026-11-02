import {render} from 'solid-js/web';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
vi.mock('@components/confirmationPopup', () => ({default: vi.fn().mockResolvedValue(undefined)}));
const mock = vi.hoisted(() => ({action: vi.fn(), login: vi.fn(), navigate: vi.fn()}));
vi.mock('@lib/blah/HomeDCCard', () => ({default: (): null => null}));
vi.mock('@config/blah', () => ({default: {}, getBlahConfig: () => ({home: {}})}));
vi.mock('@/pages/authFlow', () => ({useAuthFlow: () => ({accountNumber: 2,
  managers: {appAccountManager: {blahIdentity: mock.action}}, navigate: mock.navigate})}));
vi.mock('@/pages/requestLoginCode', () => ({default: mock.login}));
vi.mock('@lib/langPack', () => ({default: {format: (key: string) => key}}));
vi.mock('@components/buttonTsx', () => ({default: (props: any) => <button disabled={props.disabled} onClick={props.onClick}>{props.text}</button>}));
vi.mock('@lib/blah/IdentityInput', () => ({default: (): null => null}));
vi.mock('@/pages/AuthCard', () => ({default: (props: any) => <div>{props.header}{props.children}</div>}));
vi.mock('@components/mediaHeader', () => {
  const Content = (props: any) => <div>{props.children}</div>;
  return {default: Object.assign(Content, {Title: Content, Subtitle: Content})};
});
vi.mock('@/pages/cards/BlahIdentityCards', () => ({
  BlahAddressCard: (props: any) => <button onClick={() => props.onAddress('alice.example.org')}>address</button>,
  BlahWordsDisplayCard: (props: any) => <button onClick={props.onDone}>display {props.words.length}</button>,
  BlahWordsVerifyCard: (props: any) => <button disabled={props.busy} onClick={props.onVerified}>verify {props.words.length}</button>,
  BlahWordsEntryCard: (props: any) => <button onClick={() => props.onPhrase(Array(24).fill('abandon').join(' '))}>enter</button>,
  BlahPublicationCard: (props: any) => <div><button onClick={props.onReady}>publish {props.identity.domain}</button>{props.children}</div>
}));
import BlahSignInCard from '@/pages/cards/BlahSignInCard';
let dispose: () => void;
const settle = async() => { for(let i = 0; i < 20; i++) await Promise.resolve(); };
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find((button) => button.textContent.startsWith(text));
  expect(button).toBeDefined(); button.click(); await settle();
}
beforeEach(async() => {
  vi.clearAllMocks();
  mock.action.mockImplementation(async(request) => {
    if(request.action === 'inspect') throw new Error('BLAH_IDENTITY_REQUIRED');
    if(request.action === 'generateWords') return {words: Array(24).fill('abandon')};
    return {identity: {id: 'alice', domain: request.domain, holder: true}};
  });
  dispose = render(() => <BlahSignInCard />, document.body); await settle();
});
afterEach(() => { dispose(); document.body.replaceChildren(); });
describe('Blah auth cards', () => {
  it('offers the three entry actions and keeps QR on the stock card', async() => {
    expect(document.body.textContent).toContain('BlahCreateAccount');
    expect(document.body.textContent).toContain('BlahSignInWords');
    await click('BlahSignInQR'); expect(mock.navigate).toHaveBeenCalledWith({name: 'signQR'});
  });
  it('does not create custody until address, word display and verification finish', async() => {
    await click('BlahCreateAccount'); await click('address');
    expect(mock.action.mock.calls.map(([request]) => request.action)).toEqual(['inspect', 'generateWords']);
    await click('display'); expect(mock.action).toHaveBeenCalledTimes(2);
    await click('verify');
    expect(mock.action.mock.lastCall[0]).toEqual({action: 'create', domain: 'alice.example.org', hosted: undefined,
      phrase: Array(24).fill('abandon').join(' ')});
    await click('publish'); expect(mock.login.mock.lastCall[1]).toBe('alice.example.org');
  });
  it('restores from address and words without a local password', async() => {
    await click('BlahSignInWords'); await click('address'); await click('enter');
    expect(mock.action.mock.lastCall[0]).toMatchObject({action: 'restore', domain: 'alice.example.org'});
    expect(mock.action.mock.lastCall[0]).not.toHaveProperty('password');
  });
  it('continues saved custody after publication failure and confirms discard before returning to entry', async() => {
    let saved = false;
    mock.action.mockImplementation(async(request) => {
      if(request.action === 'inspect' && !saved) throw new Error('BLAH_IDENTITY_REQUIRED');
      if(request.action === 'restore') { saved = true; throw new Error('Publisher offline'); }
      if(request.action === 'discardEnrollment') { saved = false; return {}; }
      return {identity: {id: 'alice', domain: 'alice.example.org'}, unfinished: true};
    });
    await click('BlahSignInWords'); await click('address'); await click('enter');
    expect(document.body.textContent).toContain('publish alice.example.org');
    expect(document.body.textContent).toContain('Publisher offline');
    await click('BlahDiscardSignIn');
    const {default: confirm} = await import('@components/confirmationPopup');
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({descriptionLangKey: 'BlahDiscardSignInConfirm'}));
    expect(mock.action).toHaveBeenLastCalledWith({action: 'discardEnrollment', id: 'alice'});
    expect(document.body.textContent).toContain('BlahCreateAccount');
  });
});
