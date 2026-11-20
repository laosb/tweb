import type {AppCommunitiesManager as Original} from '@appManagers/appCommunitiesManager';
import {AppManager} from '@appManagers/manager';

type Contract = Pick<Original, 'isCommunity' | 'getJoinedCommunities' | 'getCommunityDialogsCount' |
  'getCommunityDialogsMirror' | 'getCommunityPeerLinkRequestsMirror' | 'getCollapsedCommunityPeerIds' |
  'saveCommunityDialog' | 'saveCommunityNotifySettings' | 'captureCommunityPinState' | 'getChangedCommunityIds' |
  'restoreCommunityPinPositions' | 'sanitizePinnedDialogsOrder' | 'handlePinnedDialogsOrder' |
  'handleCommunityDialogPinned' | 'handleCommunityUpdate' | 'handlePeerLinkedCommunityUpdate' | 'handleAdminEdited' |
  'captureFullCommunityRequest' | 'isFullCommunityRequestCurrent' | 'prepareFullCommunity' | 'handleFullCommunityUpdate'>;

// The widget has no chat list and opens only the private support chat, so it
// keeps no Community rows, pins, linked peers or join requests and refreshes no
// joined list after sign-in. A Community chat object is still recognized by its
// type (appChatsManager), so it is never mistaken for an ordinary channel.
export class AppCommunitiesManager extends AppManager implements Contract {
  public isCommunity(...[communityId]: Parameters<Contract['isCommunity']>) {
    return this.appChatsManager.isCommunity(communityId.toChatId());
  }

  public getJoinedCommunities(..._args: Parameters<Contract['getJoinedCommunities']>): ReturnType<Contract['getJoinedCommunities']> {
    return Promise.resolve([]);
  }

  public getCommunityDialogsCount() {
    return 0;
  }

  public getCommunityDialogsMirror(): ReturnType<Contract['getCommunityDialogsMirror']> {
    return {};
  }

  public getCommunityPeerLinkRequestsMirror(): ReturnType<Contract['getCommunityPeerLinkRequestsMirror']> {
    return {};
  }

  public getCollapsedCommunityPeerIds(..._args: Parameters<Contract['getCollapsedCommunityPeerIds']>): PeerId[] {
    return [];
  }

  public saveCommunityDialog(..._args: Parameters<Contract['saveCommunityDialog']>) {}

  public saveCommunityNotifySettings(..._args: Parameters<Contract['saveCommunityNotifySettings']>) {}

  // No Community pin state, so none changes while pinned dialogs load.
  public captureCommunityPinState() {
    return new Map<ChatId, string>();
  }

  public getChangedCommunityIds(..._args: Parameters<Contract['getChangedCommunityIds']>) {
    return new Set<ChatId>();
  }

  public restoreCommunityPinPositions(...[order]: Parameters<Contract['restoreCommunityPinPositions']>) {
    return order.slice();
  }

  // Without Community rows a Community is never pinned in the main list.
  public sanitizePinnedDialogsOrder(...[order]: Parameters<Contract['sanitizePinnedDialogsOrder']>) {
    return order.filter((peerId) => peerId.isUser() || !this.isCommunity(peerId.toChatId()));
  }

  public handlePinnedDialogsOrder(..._args: Parameters<Contract['handlePinnedDialogsOrder']>) {}

  public handleCommunityDialogPinned(..._args: Parameters<Contract['handleCommunityDialogPinned']>) {}

  public handleCommunityUpdate(..._args: Parameters<Contract['handleCommunityUpdate']>) {}

  public handlePeerLinkedCommunityUpdate(..._args: Parameters<Contract['handlePeerLinkedCommunityUpdate']>) {}

  public handleAdminEdited(..._args: Parameters<Contract['handleAdminEdited']>) {}

  // A full Community is saved as received (appProfileManager); there is no local
  // Community data for it to be stale against.
  public captureFullCommunityRequest(...[communityId]: Parameters<Contract['captureFullCommunityRequest']>): ReturnType<Contract['captureFullCommunityRequest']> {
    return {communityId: communityId.toChatId(), generation: 0};
  }

  public isFullCommunityRequestCurrent(..._args: Parameters<Contract['isFullCommunityRequestCurrent']>) {
    return true;
  }

  public prepareFullCommunity(..._args: Parameters<Contract['prepareFullCommunity']>) {}

  public handleFullCommunityUpdate(..._args: Parameters<Contract['handleFullCommunityUpdate']>) {}
}
