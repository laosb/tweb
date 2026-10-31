import '@helpers/peerIdPolyfill';
import SharedMedia from '@/widget/omitted/sharedMedia';
import WidgetTab from '@/widget/omitted/tab';
import * as tabs from '@/widget/omitted/tabs';
import SendAs from '@/widget/omitted/sendAs';
import LockScreen from '@/widget/omitted/lockScreen';
import useLockScreenShortcut from '@/widget/omitted/lockScreenShortcut';
import currencyAmount from '@/widget/omitted/currencyAmount';
import paidServiceMessage from '@/widget/omitted/paidServiceMessage';
import {AppSidebarLeft} from '@/widget/omitted/sidebarLeft';
import {AppSidebarRight} from '@/widget/omitted/sidebarRight';
import {AppDialogsManager} from '@/widget/omitted/dialogs';
import {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';

vi.mock('@/widget/dialogsBootstrap', () => ({startWidgetDialogs: vi.fn()}));
vi.mock('@components/sidebarRight/tabs/sharedMediaTab', async() => ({default: (await import('@/widget/omitted/sharedMedia')).default}));
vi.mock('@lib/solidjs/hotReloadGuardProvider', () => ({hotReloadGuard: {appImManager: {setPeer: vi.fn(), setInnerPeer: vi.fn()}}, registerHotReloadGuard() {}}));
vi.mock('@components/dialogElement', () => ({DialogElement: class {
  container = document.createElement('a');
  constructor(public options: unknown) {}
}}));
vi.mock('@lib/langPack', () => ({i18n: (key: string) => Object.assign(document.createElement('span'), {textContent: key})}));

it('settles hidden profile work and rejects stale apply callbacks after a peer change or destroy', async() => {
  const tab = new SharedMedia();
  expect(tab.setPeer(1 as PeerId)).toBe(true);
  expect(tab.setPeer(1 as PeerId)).toBe(false);
  const oldApply = await tab.fillProfileElements();
  expect(tab.setPeer(1 as PeerId, 2)).toBe(true);
  oldApply();
  expect(tab.isLoaded).toBe(false);
  await tab.ensureLoaded();
  await tab.whenLoaded();
  await tab.loadSidebarMedia();
  expect(tab.isLoaded).toBe(true);
  expect(tab.noProfile).toBe(true);
  tab.setPeer(2 as PeerId);
  const apply = await tab.fillProfileElements();
  tab.destroy();
  apply();
  expect(tab.isLoaded).toBe(false);
  await tab.ensureLoaded();
  await tab.whenLoaded();
});

it('keeps only read tab identities and inert payload contracts', async() => {
  const constructors = [tabs.AppEditProfileTab, tabs.AppSettingsTab, tabs.AppContactsTab,
    tabs.AppNewChannelTab, tabs.AppChatFoldersTab, tabs.AppEditFolderTab, tabs.AppMyStoriesTab, tabs.AppPrivateSearchTab];
  expect(Object.values(tabs).filter(value => value.prototype instanceof WidgetTab)).toEqual(expect.arrayContaining(constructors));
  expect(Object.values(tabs).filter(value => value.prototype instanceof WidgetTab)).toHaveLength(8);
  expect(new Set(constructors).size).toBe(8);
  expect(new tabs.AppSettingsTab()).not.toBeInstanceOf(tabs.AppContactsTab);
  const poison = new Proxy({}, {get() { throw new Error('hidden settings touched managers'); }});
  expect((tabs.AppMyStoriesTab.getInitArgs as any)(poison)).toEqual({});
  expect((tabs.getEditProfileInitArgs as any)(poison)).toEqual({});
  const tab = new tabs.AppPrivateSearchTab();
  await tab.init(poison);
  expect(tab.getPayload()).toBe(poison);
  await tab.open();
  await tab.close();
  tab.destroy();
});

it('retains sidebar peer ownership and account-switch teardown without mounting columns', async() => {
  document.body.innerHTML = '<aside id="column-left"></aside><aside id="column-right"></aside>';
  const left = new AppSidebarLeft(), right = new AppSidebarRight();
  left.construct();
  right.construct();
  const tab = right.createSharedMediaTab();
  right.replaceSharedMediaTab(tab);
  expect(right.sharedMediaTab).toBe(tab);
  right.destroySharedMediaTab(tab);
  expect(right.sharedMediaTab).toBeUndefined();
  right.replaceSharedMediaTab(right.createSharedMediaTab());
  right.closeAllTabs();
  await right.toggleSidebar();
  await left.closeEverythingInside();
  await left.closeEverythingInsideNaturally();
  expect(right.sharedMediaTab).toBeUndefined();
  expect(right.isShownOrOpening()).toBe(false);
  expect(left.hasSomethingOpenInside()).toBe(false);
  expect(document.querySelector('#column-left').childNodes.length).toBe(0);
  expect(document.querySelector('#column-right').childNodes.length).toBe(0);
});

it('keeps reacted-list row creation and close callbacks, including cancelled navigation', () => {
  const dialogs = new AppDialogsManager();
  const list = dialogs.createChatList({dialogSize: 72});
  const middleware = (() => true) as any;
  const row = dialogs.addDialogNew({peerId: 1 as PeerId, container: list, wrapOptions: {middleware}}) as any;
  expect(row.options.wrapOptions.middleware).toBe(middleware);
  expect(row.container.parentElement).toBe(list);
  expect((row.container as any).dialogElement).toBe(row);
  expect(list.getAttribute('role')).toBe('presentation');
  expect(dialogs.getTextColor(false)).toBe('secondary-text-color');
  expect(dialogs.getPrimaryColor(false)).toBe('primary-color');
  row.container.dataset.peerId = '1';
  const onFound = vi.fn(() => false);
  dialogs.setListClickListener({list, onFound});
  row.container.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, button: 0}));
  expect(onFound).toHaveBeenCalledWith(row.container);
  expect(hotReloadGuard.appImManager.setPeer).not.toHaveBeenCalled();
});

it('keeps ordinary sends undecorated and hidden numeric/identity entry points inert', async() => {
  const sendAs = new SendAs();
  const apply = await sendAs.updateManual();
  apply();
  expect(sendAs.getSendAsPeerId()).toBeUndefined();
  expect(LockScreen.getIsLocked()).toBe(false);
  await LockScreen.waitForUnlock();
  useLockScreenShortcut().dispose();
  expect(currencyAmount(0)).toBe('0');
  expect(currencyAmount('123')).toBe('123');
  const bubble = document.createElement('div');
  expect(paidServiceMessage({bubble, message: {_: 'message'} as any})).toBeUndefined();
  expect(bubble.childNodes.length).toBe(0);
  await paidServiceMessage({bubble, message: {_: 'message', paid_message_stars: 1} as any});
  expect(bubble.querySelector('.bubble-unsupported')).not.toBeNull();
});
