import {expect, it, vi} from 'vitest';
import '@helpers/peerIdPolyfill';
import {parseSync} from '@babel/core';
import {assertWidgetManagerCalls} from '../../scripts/widget-manager-contracts';
import {AppManager} from '@appManagers/manager';
import {AiTonesManager} from '@/widget/managers/aiTones';
import AppAttachMenuBotsManager from '@/widget/managers/attachMenuBots';
import AppChatInvitesManager from '@/widget/managers/chatInvites';
import {AppCommunitiesManager} from '@/widget/managers/communities';
import AppGiftsManager from '@/widget/managers/gifts';
import {PasswordManager} from '@/widget/managers/password';
import AppPaymentsManager from '@/widget/managers/payments';
import AppPromoManager from '@/widget/managers/promo';
import AppSavedMusicManager from '@/widget/managers/savedMusic';
import AppStoriesManager from '@/widget/managers/stories';
import AppTranslationsManager from '@/widget/managers/translations';

const trap = new Proxy({}, {get(_target, key) { throw new Error('unexpected dependency ' + String(key)); }});
function wire<T extends {setManagersAndAccountNumber: Function}>(Manager: new() => T, managers: object = {}) {
  const manager = new Manager();
  manager.setManagersAndAccountNumber({rootScope: trap, apiManager: trap, apiUpdatesManager: trap, appStateManager: trap, ...managers}, 4);
  return manager;
}
const unavailable = {type: 'METHOD_NOT_FOUND'};

it.each(Object.entries({
  AiTonesManager, AppAttachMenuBotsManager, AppChatInvitesManager, AppCommunitiesManager, AppGiftsManager, PasswordManager,
  AppPaymentsManager, AppPromoManager, AppSavedMusicManager, AppStoriesManager, AppTranslationsManager
} as Record<string, new() => any>))('wires %s to the account without lifecycle, listeners, timers or state', (_name, Manager) => {
  const interval = vi.spyOn(globalThis, 'setInterval');
  const manager = wire(Manager);
  expect(manager.getAccountNumber()).toBe(4);
  expect(manager.after).toBeUndefined();
  expect(manager.clear).toBeUndefined();
  expect(Object.keys(manager).sort()).toEqual(Object.keys(wire(AppManager)).sort());
  expect(interval).not.toHaveBeenCalled();
  interval.mockRestore();
});

it('settles feature entry points with the DC\'s unknown-method answer before any request', async() => {
  const calls: Array<() => unknown> = [
    () => wire(AppStoriesManager).getPeerStories(1),
    () => wire(AppStoriesManager).report(1, [1], new Uint8Array()),
    () => wire(AppGiftsManager).getGiftBySlug('slug'),
    () => wire(AppGiftsManager).wrapGiftFromMessage({} as any),
    () => wire(AppGiftsManager).wrapGiftFromWebPage({} as any),
    () => wire(AppTranslationsManager).translateText({peerId: 1, mid: 1, lang: 'en'}),
    () => wire(AppTranslationsManager).translateRichMessage({peerId: 1, mid: 1, lang: 'en'} as any),
    () => wire(AppTranslationsManager).summarizeText({peerId: 1, mid: 1}),
    () => wire(AppTranslationsManager).refreshRichMessageTranslation(1, 1, 'en'),
    () => wire(AppPaymentsManager).getStarsStatus(true),
    () => wire(AppPaymentsManager).getStarsStatusTon(true),
    () => wire(AppPaymentsManager).getPremiumGiftCodeOptions(),
    () => wire(AppPaymentsManager).getPremiumPromo(),
    () => wire(AppPaymentsManager).getPaymentForm({} as any),
    () => wire(AppPaymentsManager).getBankCardData('4242'),
    () => wire(AppAttachMenuBotsManager).getAttachMenuBot(1),
    () => wire(AppAttachMenuBotsManager).getBotApp(1, 'app'),
    () => wire(AppAttachMenuBotsManager).requestWebView({} as any),
    () => wire(AppAttachMenuBotsManager).toggleBotInAttachMenu(1, true),
    () => wire(AiTonesManager).composeMessageWithAi({} as any),
    () => wire(AiTonesManager).getTones(),
    () => wire(AiTonesManager).getToneBySlug('tone'),
    () => wire(AppChatInvitesManager).checkChatInvite('hash'),
    () => wire(AppChatInvitesManager).requestChatJoinWebView('1'),
    () => wire(AppSavedMusicManager).getSavedMusicByIds(1, ['1']),
    () => wire(AppSavedMusicManager).saveMusic('1'),
    () => wire(AppSavedMusicManager).removeMusic('1'),
    () => wire(PasswordManager).getState()
  ];
  for(const call of calls) await expect(call()).rejects.toMatchObject(unavailable);
  expect(() => wire(AppPaymentsManager).getInputInvoiceBySlug('slug')).toThrow();
  expect(() => wire(AppPaymentsManager).getInputInvoiceByPeerId(1, 1)).toThrow();
});

it('answers state queries as having nothing: no story, stars balance, attach bot, saved track or translation', async() => {
  const stories = wire(AppStoriesManager);
  const user = {_: 'user', id: 1, stories_max_id: 5, pFlags: {}} as any;
  expect(stories.saveApiPeerStories(user, {...user, stories_max_id: 2})).toBeUndefined();
  expect(user.stories_max_id).toBe(5);
  expect(stories.getPeerStoriesCache(1)).toBeUndefined();
  expect(stories.getStoryById(1, 1)).toBeUndefined();
  expect(stories.getPeerStoriesSegments(1)).toBeUndefined();
  expect(stories.getUnreadType(1, 1)).toBeUndefined();
  const item = {_: 'storyItemSkipped', id: 1} as any;
  expect(stories.saveStoryItems([item, {_: 'storyItemDeleted', id: 2}], undefined)).toEqual([item]);
  expect(stories.saveStoryItem(item, undefined)).toBe(item);
  expect(stories.saveStoryItem({_: 'storyItemDeleted', id: 2}, undefined)).toBeUndefined();

  const payments = wire(AppPaymentsManager);
  expect(payments.getCachedStarsStatus()).toBeUndefined();
  expect(payments.updateLocalStarsBalance({_: 'starsAmount', amount: 1, nanos: 0} as any)).toBeUndefined();
  expect(wire(AppAttachMenuBotsManager).getAttachMenuBots()).toEqual([]);
  expect(wire(AppAttachMenuBotsManager).onLanguageChange()).toBeUndefined();
  const music = wire(AppSavedMusicManager);
  expect(music.applyTopSavedMusic(1, {_: 'document', id: '1'} as any)).toBeUndefined();
  expect(music.getMyIds()).toEqual([]);
  await expect(music.isInProfile('1')).resolves.toBe(false);
  const translations = wire(AppTranslationsManager);
  expect(translations.hasTriedToTranslateMessage(1, 1)).toBe(false);
  expect(translations.resetPeerTranslationsByChannelCutoff(1)).toEqual(new Set());
  await expect(wire(AppChatInvitesManager).reloadPendingJoinRequests(1)).resolves.toBeUndefined();
});

it('keeps collectible gift documents ingested with their file references', () => {
  const saveDoc = vi.fn((doc: any) => ({...doc, saved: true}));
  const gifts = wire(AppGiftsManager, {appDocsManager: {saveDoc}});
  const sticker = {_: 'document', id: 's'};
  expect(gifts.wrapGift({_: 'starGift', sticker} as any)).toMatchObject({type: 'stargift', sticker: {id: 's', saved: true}});
  const model = {_: 'starGiftAttributeModel', document: {_: 'document', id: 'm'}};
  const pattern = {_: 'starGiftAttributePattern', document: {_: 'document', id: 'p'}};
  const unique = {_: 'starGiftUnique', attributes: [model, pattern, {_: 'starGiftAttributeBackdrop'}]} as any;
  const wrapped = gifts.wrapGift(unique);
  expect(wrapped).toMatchObject({type: 'stargift', raw: unique, sticker: {id: 'm', saved: true}});
  expect(model.document).toBe(wrapped.sticker);
  expect(pattern.document).toMatchObject({id: 'p', saved: true});
  expect(saveDoc).toHaveBeenCalledTimes(3);
});

it('recognizes Community chats by type while keeping no Community rows, pins or request generations', async() => {
  const isCommunity = vi.fn((chatId: ChatId) => chatId === 7);
  const communities = wire(AppCommunitiesManager, {appChatsManager: {isCommunity}});
  expect(communities.isCommunity(7)).toBe(true);
  expect(communities.isCommunity(8)).toBe(false);
  const community = (7).toPeerId(true), channel = (8).toPeerId(true);
  expect(communities.sanitizePinnedDialogsOrder([1, community, channel])).toEqual([1, channel]);
  const order = [1, channel];
  expect(communities.restoreCommunityPinPositions(order, new Set([7]))).toEqual(order);
  expect(communities.restoreCommunityPinPositions(order, new Set())).not.toBe(order);
  expect(communities.captureCommunityPinState()).toEqual(new Map());
  expect(communities.getChangedCommunityIds(new Map([[7, 'token']]))).toEqual(new Set());
  expect(communities.getCollapsedCommunityPeerIds()).toEqual([]);
  expect(communities.getCommunityDialogsCount()).toBe(0);
  expect(communities.getCommunityDialogsMirror()).toEqual({});
  expect(communities.getCommunityPeerLinkRequestsMirror()).toEqual({});
  await expect(communities.getJoinedCommunities()).resolves.toEqual([]);
  const request = communities.captureFullCommunityRequest(7);
  expect(request).toEqual({communityId: 7, generation: 0});
  expect(communities.isFullCommunityRequestCurrent(request)).toBe(true);
  for(const ignored of [
    communities.saveCommunityDialog({} as any), communities.saveCommunityNotifySettings(7, {} as any),
    communities.handlePinnedDialogsOrder(), communities.handleCommunityDialogPinned(7, true),
    communities.handleCommunityUpdate(7), communities.handlePeerLinkedCommunityUpdate({peerId: 1, communityId: 7}),
    communities.handleAdminEdited({communityId: 7, previousParticipant: 1, participant: {} as any}),
    communities.prepareFullCommunity({} as any), communities.handleFullCommunityUpdate({} as any)
  ]) expect(ignored).toBeUndefined();
});

it('lets only the hash-pinned wiring name a replaced manager in a string', () => {
  const methods = new Map([['appCommunitiesManager', new Set(['isCommunity'])]]);
  const check = (source: string, pinnedWiring?: boolean) =>
    assertWidgetManagerCalls(parseSync(source, {configFile: false}), methods, 'test.ts', pinnedWiring);
  check('names.unshift(\'appCommunitiesManager\', \'appUsersManager\');', true);
  expect(() => check('names.unshift(\'appCommunitiesManager\');')).toThrow('indirect manager name: appCommunitiesManager');
  expect(() => check('this.appCommunitiesManager.refreshJoinedCommunities();', true)).toThrow('missing appCommunitiesManager.refreshJoinedCommunities');
  expect(() => check('consume(managers.appCommunitiesManager);', true)).toThrow('manager escapes');
});
