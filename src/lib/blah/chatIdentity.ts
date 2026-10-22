import type {ApiManager} from '@appManagers/apiManager';
import type {ApiUpdatesManager} from '@appManagers/apiUpdatesManager';
import type {AppChatsManager} from '@appManagers/appChatsManager';
import type {AppUsersManager} from '@appManagers/appUsersManager';
import type {AppPeersManager} from '@appManagers/appPeersManager';
import type {AppProfileManager} from '@appManagers/appProfileManager';
import type {ChannelsCreateChannel, InputFile, MissingInvitee, Updates} from '@layer';
import {getBlahConfig} from '@config/blah';
import {identityAction, IdentityMetadata, IdentityRequest, IdentityResponse, numberIdentity, publicationPending, withResourceIdentity} from '@lib/blah/identity';
import type {BlahInvokeOptions} from '@lib/blah/invoke';
import {diemClient, verifySignature} from '@lib/blah/runtime';
import {stored} from '@lib/blah/vault';
import '@lib/blah/resourceProfileTypes';

export type ChatIdentityChange = {action: 'createChannel', options: ChannelsCreateChannel} |
  {action: 'createChat', title: string, userIds: UserId[]} |
  {action: 'edit', chatId: ChatId, title: string, changedTitle?: string, about?: string, photo?: InputFile};
export type ChatIdentityRequest = {action: 'prepare', domain: string, password: string, attempt: string, hosted?: IdentityRequest['hosted']} |
  {action: 'claim', id: string} |
  {action: 'bind', id: string, change: ChatIdentityChange};
export type ChatIdentityResult = {chatId: ChatId, missingInvitees: MissingInvitee[]};
export type ChatIdentityResponse = IdentityResponse & {result?: ChatIdentityResult};
type Managers = {apiManager: ApiManager, apiUpdatesManager: ApiUpdatesManager, appChatsManager: AppChatsManager,
  appUsersManager: AppUsersManager, appPeersManager: AppPeersManager, appProfileManager: AppProfileManager};
type Attachment = IdentityMetadata & {result?: ChatIdentityResult};
const pending = new Map<string, Promise<ChatIdentityResponse>>();

/** The migrated basic chat is only a compatibility shell; custody belongs to its supergroup. */
export function createdIdentityChat(updates: Updates) {
  if(updates._ !== 'updates' && updates._ !== 'updatesCombined') throw new Error('The server returned no chat.');
  const migrated = updates.chats.find((chat) => chat._ === 'chat' && chat.migrated_to);
  const id = migrated?._ === 'chat' && migrated.migrated_to._ === 'inputChannel' ? migrated.migrated_to.channel_id : undefined;
  const channel = updates.chats.find((chat) => chat._ === 'channel' && (!id || chat.id === id));
  if(!channel || channel._ !== 'channel') throw new Error('The server returned no channel identity target.');
  return channel;
}

export function chatIdentityAction(slot: number, managers: Managers, request: ChatIdentityRequest): Promise<ChatIdentityResponse> {
  if(request.action === 'prepare') {
    return identityAction(slot, {...request, action: 'create', kind: 'channel'});
  }
  const key = `${slot}:${request.id}:${request.action}`;
  const existing = pending.get(key);
  if(existing) return existing;
  const operation = (request.action === 'claim' ? claimChat(slot, managers, request.id) :
    bindChat(slot, managers, request.id, request.change)).finally(() => pending.delete(key));
  pending.set(key, operation);
  return operation;
}

async function claimChat(slot: number, managers: Managers, id: string): Promise<ChatIdentityResponse> {
  const attachment = await stored<IdentityMetadata>('metadata:' + id);
  if(attachment?.kind !== 'channel' || !attachment.chatId) throw new Error('Select a bound chat identity.');
  const updates = await managers.apiManager.invokeApi('messages.editChatCreator', {
    peer: managers.appChatsManager.getChannelInputPeer(attachment.chatId),
    user_id: {_: 'inputUserSelf'}, password: {_: 'inputCheckPasswordEmpty'}
  }, {blahResourceIdentity: id, ignoreErrors: true, rawError: true} as BlahInvokeOptions);
  managers.apiUpdatesManager.processUpdateMessage(updates);
  return {};
}

async function bindChat(slot: number, managers: Managers, id: string, change: ChatIdentityChange): Promise<ChatIdentityResponse> {
  const {apiManager, apiUpdatesManager, appChatsManager, appUsersManager, appPeersManager, appProfileManager} = managers;
  let attachment = await stored<Attachment>('metadata:' + id);
  if(attachment?.kind !== 'channel') throw new Error('Select a chat identity.');
  const info = await withResourceIdentity(slot, id, async(_secret, info) => info, true, false);
  if(attachment.chatId && change.action === 'edit' && attachment.chatId !== change.chatId) throw new Error('This identity belongs to another chat.');
  const resuming = !!attachment.chatId;
  if(!resuming) {
    try {
      if(await publicationPending(info.domains, info.profile)) throw new Error('BLAH_PROFILE_NOT_PUBLISHED');
    } catch(error) {
      if((error as Error).message === 'BLAH_PROFILE_NOT_PUBLISHED') throw error;
      throw new Error('BLAH_PUBLICATION_CHECK_FAILED');
    }
    const options: BlahInvokeOptions = {blahResourceIdentity: id, ignoreErrors: true, rawError: true};
    let result: ChatIdentityResult;
    let title: string;
    if(change.action === 'createChannel' || change.action === 'createChat') {
      const invited = change.action === 'createChat' ? await apiManager.invokeApi('messages.createChat', {
        title: change.title, users: change.userIds.map((userId) => appUsersManager.getUserInput(userId))
      }, options) : undefined;
      const updates = invited?.updates || await apiManager.invokeApi('channels.createChannel', (change as Extract<ChatIdentityChange, {action: 'createChannel'}>).options, options);
      apiUpdatesManager.processUpdateMessage(updates);
      const chat = createdIdentityChat(updates);
      result = {chatId: chat.id, missingInvitees: invited?.missing_invitees || []};
      title = chat.title;
    } else {
      const {chatId} = change;
      const chat = appChatsManager.getChat(chatId);
      if(chat?._ !== 'channel' || !chat.pFlags.creator || chat.pFlags.monoforum) throw new Error('CHAT_ADMIN_REQUIRED');
      const channel = appChatsManager.getChannelInput(chatId);
      try {
        if(change.changedTitle !== undefined || (change.about === undefined && !change.photo)) {
          const updates = await apiManager.invokeApi('channels.editTitle', {channel, title: change.changedTitle ?? change.title}, options);
          appChatsManager.onChatUpdated(chatId, updates);
        } else if(change.about !== undefined) {
          await apiManager.invokeApi('messages.editChatAbout', {peer: appPeersManager.getInputPeerById(chatId.toPeerId(true)), about: change.about}, options);
          appProfileManager.modifyCachedFullChat(chatId, (full) => { full.about = change.about; });
        } else {
          const updates = await apiManager.invokeApi('channels.editPhoto', {channel, photo: {_: 'inputChatUploadedPhoto', file: change.photo}}, options);
          appChatsManager.onChatUpdated(chatId, updates);
        }
      } catch(error) {
        if((error as {type?: string}).type !== 'CHAT_NOT_MODIFIED') throw error;
        // Binding precedes the no-op check. Verify the exact proposed identity, not just presence.
        const profiles = await apiManager.invokeApi('blah.getChannelProfile', {id: [channel]}, {ignoreErrors: true});
        const profile = profiles.find((entry) => String(entry.id) === String(chatId));
        const verified = profile && await (await diemClient()).verifyProfile(profile.profile, Math.floor(Date.now() / 1000), {verify: verifySignature});
        if(verified?.kind !== 'channel' || verified.id !== id || verified.home?.dc !== getBlahConfig(slot).home.identity ||
          (verified.home.account && verified.home.account !== String(chatId))) throw error;
      }
      result = {chatId, missingInvitees: []};
      title = change.changedTitle ?? change.title;
    }
    // Persist the committed RPC before numbering: retries must never create another chat.
    attachment = {...attachment, chatId: result.chatId, title, result};
    await stored('metadata:' + id, attachment);
  }
  await numberIdentity(slot, String(attachment.chatId), id);
  if(change.action === 'edit') {
    const edit = async(operation: Promise<unknown>) => {
      try { await operation; } catch(error) { if((error as {type?: string}).type !== 'CHAT_NOT_MODIFIED') throw error; }
    };
    // Replays after a partial save are harmless; upstream caches/updates stay authoritative.
    if(change.changedTitle !== undefined && resuming) await edit(appChatsManager.editTitle(change.chatId, change.changedTitle));
    if(change.about !== undefined && (change.changedTitle !== undefined || resuming)) await edit(appChatsManager.editAbout(change.chatId, change.about));
    if(change.photo && (change.changedTitle !== undefined || change.about !== undefined || resuming)) await edit(appChatsManager.editPhoto(change.chatId, change.photo));
    attachment.title = change.changedTitle ?? change.title;
    await stored('metadata:' + id, attachment);
  }
  const response = await identityAction(slot, {action: 'inspect', id});
  return {...response, result: attachment.result || {chatId: attachment.chatId, missingInvitees: []}};
}
