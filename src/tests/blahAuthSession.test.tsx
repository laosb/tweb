import {render} from 'solid-js/web';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import BlahSignInCard from '@/pages/cards/BlahSignInCard';

const mocks = vi.hoisted(() => ({
  slot: 2,
  leaving: false,
  config: vi.fn(),
  connect: vi.fn(),
  saved: vi.fn(),
  reload: vi.fn()
}));

vi.mock('@config/blah', () => ({
  default: {discovery: true},
  getBlahConfig: mocks.config,
  blahStartupErrors: new Map()
}));
vi.mock('@/pages/authFlow', () => ({
  useAuthFlow: () => ({accountNumber: mocks.slot, isLeaving: () => mocks.leaving})
}));
vi.mock('@lib/blah/discovery', () => ({connectDC: mocks.connect, savedDC: mocks.saved}));
vi.mock('@lib/apiManagerProxy', () => ({default: {reloadEveryTab: mocks.reload}}));
vi.mock('@lib/blah/IdentityPanel', () => ({default: () => <div data-identity-panel />}));
vi.mock('@lib/langPack', () => ({default: {format: (key: string) => key}, i18n: (key: string) => key}));
vi.mock('@helpers/dom/focusWhenSettled', () => ({default: () => () => {}}));
vi.mock('@components/inputField', () => ({
  InputState: {Neutral: 0, Error: 1},
  default: class {
    input = document.createElement('input');
    container = this.input;
    set value(value: string) { this.input.value = value }
    get value() { return this.input.value }
    setState() {}
  }
}));
vi.mock('@components/buttonTsx', () => ({default: () => <button type="submit" />}));
vi.mock('@/pages/AuthCard', () => ({default: (props: any) => <div>{props.children}</div>}));
vi.mock('@components/mediaHeader', () => {
  const Content = (props: any) => <div>{props.children}</div>;
  return {default: Object.assign(Content, {Title: Content, Subtitle: Content})};
});

let dispose: () => void;
let container: HTMLDivElement;
const settle = async() => { for(let i = 0; i < 8; ++i) await Promise.resolve() };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.slot = 2;
  mocks.leaving = false;
  // The displayed account is configured; the separate sign-in slot is new.
  mocks.config.mockImplementation((slot: number) => slot === 1 ? {home: {}} : undefined);
  mocks.saved.mockResolvedValue(undefined);
  mocks.connect.mockResolvedValue({});
  history.replaceState(null, '', '/?account=1');
  container = document.createElement('div');
  document.body.append(container);
  dispose = render(() => <BlahSignInCard />, container);
});

afterEach(() => {
  dispose();
  container.remove();
});

it('selects the home for the auth-flow slot rather than the account underneath', async() => {
  await settle();
  expect(mocks.config).toHaveBeenCalledWith(2);
  expect(mocks.saved).toHaveBeenCalledWith(2);
  expect(container.querySelector('form')).not.toBeNull();
  expect(container.querySelector('[data-identity-panel]')).toBeNull();
});

it('connects and reloads into the slot being added', async() => {
  await settle();
  container.querySelector('input').value = 'second.example.org';
  container.querySelector('form').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
  await settle();
  expect(mocks.connect).toHaveBeenCalledWith('second.example.org', 2);
  expect(mocks.reload).toHaveBeenCalledExactlyOnceWith([], expect.any(URL));
  expect(mocks.reload.mock.calls[0][1].searchParams.get('account')).toBe('2');
});

it('does not reload when the sign-in starts leaving during DC discovery', async() => {
  await settle();
  let finish: (value: unknown) => void;
  mocks.connect.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  container.querySelector('form').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
  mocks.leaving = true;
  finish({});
  await settle();
  expect(mocks.reload).not.toHaveBeenCalled();
});
