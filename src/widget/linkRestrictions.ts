import internalLinkProcessor from '@lib/internalLinkProcessor';
import appImManager from '@lib/appImManager';
import {INTERNAL_LINK_TYPE, InternalLink} from '@lib/internalLink';
import {restrictRenderedLinks} from '@/widget/renderedLinkRestrictions';

export function restrictInternalLinks(supportPeerId: PeerId, usernames: readonly string[]) {
  const processor = internalLinkProcessor as any;
  const denied = [
    'processStickerSetLink', 'processJoinChatLink', 'processVoiceChatLink', 'processConferenceCallLink',
    'processAddAiStyleLink', 'processUserPhoneNumberLink', 'processInvoiceLink', 'processAttachMenuBotLink',
    'processWebAppLink', 'processListLink', 'processStoryLink', 'processBoostLink', 'processPremiumFeaturesLink',
    'processGiftCodeLink', 'processBusinessChatLink', 'processStarsTopupLink', 'processShareLink',
    'processUniqueStarGiftLink', 'processStarGiftCollectionLink', 'processStoryAlbumLink', 'processInstantViewLink'
  ];
  const targets = [
    ...denied.map(key => [processor, key]),
    ...['processInternalLink', 'processMessageLink', 'processPrivatePostLink'].map(key => [processor, key]),
    ...['openUsername', 'open', 'op', 'openThread', 'openComment'].map(key => [appImManager, key])
  ];
  for(const [object, key] of targets) {
    if(typeof(object[key]) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: ' + key);
  }
  const checked = new Set(['processInternalLink', 'processMessageLink', 'processPrivatePostLink', ...denied]);
  for(const key of [...Object.keys(processor), ...Object.getOwnPropertyNames(Object.getPrototypeOf(processor))]) {
    if(key.startsWith('process') && typeof(processor[key]) === 'function' && !checked.has(key)) {
      throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: unchecked link handler ' + key);
    }
  }

  restrictRenderedLinks(document);

  const names = new Set(usernames.map(name => name.toLowerCase()));
  const positiveId = (value: string | number) => /^\d+$/.test(String(value)) && Number.isSafeInteger(+value) && +value > 0;
  const jump = (link: InternalLink) => {
    if(!link || !('post' in link) || !positiveId(link.post)) return Promise.resolve();
    const keys = ['_', 'domain', 'channel', 'post', 'stack', 'single', 't', 'option'];
    if(Object.keys(link).some(key => (link as any)[key] !== undefined && !keys.includes(key))) return Promise.resolve();
    const isSupport = link._ === INTERNAL_LINK_TYPE.MESSAGE ? names.has(link.domain?.toLowerCase()) :
      link._ === INTERNAL_LINK_TYPE.PRIVATE_POST && link.channel === String(supportPeerId);
    if(!isSupport) return Promise.resolve();
    return appImManager.open({peerId: supportPeerId, lastMsgId: +link.post, stack: link.stack,
      mediaTimestamp: link.t && +link.t, wholeAlbum: link.single === undefined, pollOption: link.option});
  };
  processor.processInternalLink = processor.processMessageLink = processor.processPrivatePostLink = jump;
  for(const key of denied) processor[key] = () => Promise.resolve();

  // Direct callers must not resolve an unrelated username or peer before setInnerPeer refuses it.
  const jumpKeys = new Set(['peerId', 'peer', 'userName', 'lastMsgId', 'stack', 'wholeAlbum', 'mediaTimestamp', 'pollOption']);
  const isJump = (options: {lastMsgId?: number}) =>
    positiveId(options.lastMsgId) && Object.keys(options).every(key => (options as any)[key] === undefined || jumpKeys.has(key));
  appImManager.openUsername = (options) => {
    if(!isJump(options) || !names.has(options.userName?.toLowerCase())) return Promise.resolve();
    const {userName, ...jumpOptions} = options;
    return appImManager.open({peerId: supportPeerId, ...jumpOptions});
  };
  const open = appImManager.open;
  appImManager.open = function(options) {
    return options.peerId === supportPeerId && isJump(options) ? open.call(this, options) : Promise.resolve(false);
  };
  const op = appImManager.op;
  appImManager.op = function(options) {
    return options.peer?._ === 'user' && options.peer.id === supportPeerId && isJump(options) ? op.call(this, options) : Promise.resolve();
  };
  appImManager.openThread = appImManager.openComment = () => Promise.resolve(false);
}
