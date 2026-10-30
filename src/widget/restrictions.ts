import type {ChatRights} from '@appManagers/appChatsManager';
import appImManager from '@lib/appImManager';
import appNavigationController from '@components/appNavigationController';
import appSidebarRight from '@components/sidebarRight';
import AppSharedMediaTab from '@components/sidebarRight/tabs/sharedMediaTab';
import Chat from '@components/chat/chat';
import ChatInput from '@components/chat/input';
import {ChatType} from '@components/chat/chatType';
import ChatRecording from '@components/chat/recording/chatRecording';
import {ChatReactionsMenu} from '@components/chat/reactionsMenu';
import {restrictChatPresentation} from '@/widget/chatRestrictions';
import {applyWidgetInsets} from '@/widget/insets';
import {useWidgetSelfTitle} from '@/widget/selfTitle';
import {restrictMediaViewer} from '@/widget/mediaViewerRestrictions';
import {restrictChatStatus} from '@/widget/statusRestrictions';
import {restrictMessageSelection} from '@/widget/selectionRestrictions';

// Kept out of the support conversation.
const DENIED_RIGHTS = new Set<ChatRights>(['send_stickers', 'send_gifs', 'send_inline', 'send_polls', 'send_voices', 'send_roundvideos']);
const ATTACH_ICONS = new Set(['image', 'document']);

/**
 * Narrows the full client to one conversation by wrapping a few upstream entry points
 * instead of editing them, which keeps this branch cheap to rebase. Every wrapped member
 * is checked first, so an upstream rename fails loudly instead of silently reopening a feature.
 */
export function restrictToSupport(supportPeerId: PeerId) {
  const chatInput = ChatInput.prototype as any;
  const targets = [
    [appImManager, 'setPeer'], [appImManager, 'setInnerPeer'], [appNavigationController, 'overrideHash'],
    [appSidebarRight, 'toggleSidebar'], [AppSharedMediaTab.prototype, 'setPeer'], [Chat.prototype, 'canSend'], [chatInput, 'constructPeerHelpers'],
    [ChatReactionsMenu.prototype, 'init'], [chatInput, 'checkInlineAutocomplete'],
    [ChatRecording.prototype, 'hasVoiceRecorder'], [ChatRecording.prototype, 'hasAnyRecorder']
  ] as const;
  for(const [object, key] of targets) {
    if(typeof((object as any)[key]) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: ' + key);
  }

  restrictMessageSelection();
  restrictChatStatus();
  restrictChatPresentation();
  useWidgetSelfTitle();
  applyWidgetInsets();
  restrictMediaViewer();

  // Every way into another chat, a profile or the chat list ends in these two.
  const isSupportChat = (options: {peerId?: PeerId, type?: ChatType}) => {
    return options.peerId === supportPeerId && (!options.type || options.type === ChatType.Chat);
  };
  const setPeer = appImManager.setPeer.bind(appImManager);
  appImManager.setPeer = (options = {}, animate) => isSupportChat(options) ? setPeer(options, animate) : Promise.resolve(false);
  const setInnerPeer = appImManager.setInnerPeer.bind(appImManager);
  appImManager.setInnerPeer = async(options) => { if(isSupportChat(options)) return setInnerPeer(options); };
  appSidebarRight.toggleSidebar = () => Promise.resolve();

  // Keep shared media's layout without rendering the profile omitted from this build.
  const setMediaPeer = AppSharedMediaTab.prototype.setPeer;
  AppSharedMediaTab.prototype.setPeer = function(...args) {
    this.noProfile = true;
    return setMediaPeer.apply(this, args);
  };

  // The fragment carries the customer token; opening the chat must not replace it.
  const overrideHash = appNavigationController.overrideHash.bind(appNavigationController);
  appNavigationController.overrideHash = (hash, forceReplace) => overrideHash(location.hash, forceReplace);

  const canSend = Chat.prototype.canSend;
  Chat.prototype.canSend = function(this: Chat, action?: ChatRights) {
    return DENIED_RIGHTS.has(action) ? Promise.resolve(false) : canSend.call(this, action);
  };

  // No voice or round-video messages: the send button never turns into a recorder.
  ChatRecording.prototype.hasVoiceRecorder = ChatRecording.prototype.hasAnyRecorder = () => false;

  // Photos, videos and files only.
  const constructPeerHelpers = chatInput.constructPeerHelpers;
  chatInput.constructPeerHelpers = function(this: any) {
    if(!this.excludeParts) throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: excludeParts');
    this.excludeParts.emoticons = true;
    const result = constructPeerHelpers.call(this);
    for(const button of this.attachMenuButtons as {icon: string, verify: () => boolean}[]) {
      if(!ATTACH_ICONS.has(button.icon)) button.verify = () => false;
    }
    return result;
  };

  // The helper stubs do not search or render; do not start inline bot lookups either.
  chatInput.checkInlineAutocomplete = (): undefined => undefined;

  // Keep the quick row, without an entry into the omitted expanded picker.
  const initReactions = ChatReactionsMenu.prototype.init;
  ChatReactionsMenu.prototype.init = function(...args) {
    if(!('noMoreButton' in this)) throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: noMoreButton');
    (this as any).noMoreButton = true;
    return initReactions.apply(this, args);
  };

  return appImManager;
}
