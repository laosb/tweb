import rootScope from '@lib/rootScope';
import {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import PopupElementTsx from '@components/popups/indexTsx';
import appDownloadManager from '@lib/appDownloadManager';
import appMediaPlaybackController from '@components/appMediaPlaybackController';
import {appSettings} from '@stores/appSettings';
import * as tabs from '@components/solidJsTabs/tabs';
import * as registry from '@components/solidJsTabs';
import showMyQrCodePopup from '@components/popups/myQrCode';
import showStarsRatingPopup from '@components/popups/starsRating';
import showPeerProfilePopup from '@components/popups/peerProfile';
import showStarReactionPopup from '@components/popups/starReaction';
import showDeleteMegagroupMessagesPopup from '@components/popups/deleteMegagroupMessages';
import AppSharedMediaTab from '@components/sidebarRight/tabs/sharedMediaTab';
import showReactedListPopup from '@components/popups/reactedList';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {startWidgetDialogs} from '@/widget/dialogsBootstrap';

// Harness-only access to the real replacements and the retained reaction popup.
export function bootstrapSnapshot() {
  const {appSidebarLeft: left, appSidebarRight: right, appDialogsManager: dialogs, appImManager: im} = hotReloadGuard;
  const playback = appMediaPlaybackController as any;
  const count = playback.listeners.playbackParams?.size;
  startWidgetDialogs();
  const before = playback.volume;
  playback.volume = 0.37;
  const persisted = appSettings.playbackParams.volume === 0.37;
  playback.volume = before;
  return {
    managers: PopupElementTsx.MANAGERS === rootScope.managers && im.managers === rootScope.managers,
    downloads: !!(appDownloadManager as any).managers,
    persisted,
    listenerStable: count === playback.listeners.playbackParams?.size,
    noDialogs: !(dialogs as any).xd && !(dialogs as any).folders && !(dialogs as any).contextMenu,
    noColumns: !left.sidebarEl.querySelector('.chatlist-chat, .chatlist-overlay, .topics-slider') &&
      !right.sidebarEl.querySelector('.profile-content, .search-super'),
    registryIdentity: registry.AppSettingsTab === tabs.AppSettingsTab && registry.AppEditProfileTab === tabs.AppEditProfileTab,
    registryDistinct: tabs.AppSettingsTab !== (tabs.AppEditProfileTab as any),
    perChatIdentity: im.chat.sharedMediaTab instanceof AppSharedMediaTab
  };
}

export async function hiddenEntries() {
  const managers = rootScope.managers;
  let calls = 0;
  rootScope.managers = new Proxy({} as typeof managers, {get() { ++calls; throw new Error('hidden entry accessed managers'); }});
  try {
    await Promise.all([
      showMyQrCodePopup(), showStarsRatingPopup({} as any), showPeerProfilePopup({peerId: rootScope.myId}),
      showStarReactionPopup(undefined, undefined, undefined),
      showDeleteMegagroupMessagesPopup({} as any), AppSharedMediaTab.open(undefined, rootScope.myId),
      hotReloadGuard.appSidebarRight.toggleSidebar(true), Promise.resolve(tabs.getEditProfileInitArgs()),
      Promise.resolve((tabs.AppMyStoriesTab.getInitArgs as any)())
    ]);
    return {calls, popups: document.querySelectorAll('.popup.active').length};
  } finally {
    rootScope.managers = managers;
  }
}

let restoreManagers: () => void;
export function restoreReactionManagers() { restoreManagers?.(); restoreManagers = undefined; }

export async function openReactionParticipants() {
  const original = rootScope.managers;
  const managers = bindManagersToSession(original);
  const {chat} = hotReloadGuard.appImManager;
  const base = chat.getMessage(+document.querySelector<HTMLElement>('.bubble[data-mid]:not(.service)').dataset.mid);
  const message = {...base, pFlags: {out: true}, reactions: {
    _: 'messageReactions', pFlags: {}, results: [{_: 'reactionCount', count: 7, reaction: {_: 'reactionEmoji', emoticon: '👍'}}]
  }} as any;
  const fixtures = Object.create(managers);
  fixtures.appMessagesManager = new Proxy(managers.appMessagesManager, {get(target, key) {
    if(key === 'getGroupsFirstMessage') return async() => message;
    if(key === 'canViewMessageReadParticipants') return async() => false;
    if(key === 'getMessageReactionsListAndReadParticipants') return async() => ({combined: Array.from({length: 7}, (_, index) => ({
      peerId: index % 2 ? rootScope.myId : chat.peerId, date: Math.floor(Date.now() / 1000)
    }))});
    return target[key as keyof typeof target];
  }});
  fixtures.appReactionsManager = new Proxy(managers.appReactionsManager, {get(target, key) {
    if(key === 'canDeleteParticipantReactions') return async() => false;
    return target[key as keyof typeof target];
  }});
  rootScope.managers = fixtures;
  restoreManagers = () => { rootScope.managers = original; };
  try {
    await showReactedListPopup(message);
  } catch(error) {
    restoreReactionManagers();
    throw error;
  }
}
