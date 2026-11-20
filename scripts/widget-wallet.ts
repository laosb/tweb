import MagicString from 'magic-string';
import type {Plugin} from 'vite';
import {pruneWidgetSchema} from './widget-schema';

const TARGETS = [
  'src/lib/mtproto/schema.ts',
  'src/lib/appManagers/appMessagesManager.ts',
  'src/lib/internalLinkProcessor.ts',
  'src/lib/internalLink.ts',
  'src/lib/uiNotificationsManager.ts',
  'src/lib/appManagers/appPromoManager.ts',
  'src/lib/richTextProcessor/wrapUrl.ts',
  'src/lib/richTextProcessor/wrapRichText.ts',
  'src/lib/richTextProcessor/wrapTelegramRichText.ts',
  'src/components/wrappers/messageActionTextNewUnsafe.ts',
  'src/components/wrappers/messagePreviewIcon.ts',
  'src/components/chat/bubbles.ts',
  'src/components/dialogElement.ts',
  'src/icons.ts',
  'src/components/chat/messageRender.ts',
  'src/helpers/rowIconBackground.ts',
  'src/lib/appManagers/utils/payments/starsTransaction.ts'
];

export function pruneWidgetWallet(source: string, path: string, parse: (source: string) => any) {
  if(path === TARGETS[0]) return pruneWidgetSchema(source);
  const result = new MagicString(source);
  const fail = (detail: string) => { throw new Error('WIDGET_WALLET_TARGET_CHANGED: ' + path + ': ' + detail); };
  const replace = (before: string, after = '') => {
    if(source.split(before).length !== 2) fail(before);
    const start = source.indexOf(before);
    result.overwrite(start, start + before.length, after);
  };
  const program = parse(source);
  const cases = path.endsWith('/messageActionTextNewUnsafe.ts') ? ['messageActionGramTransfer', 'messageActionWalletTonConnectRequest', 'messageActionNoPaidMessagesTokenUsed'] :
    path.endsWith('/messagePreviewIcon.ts') ? ['messageActionGramTransfer'] :
    path.endsWith('/wrapRichText.ts') ? ['messageEntityTonAddress'] :
    path.endsWith('/wrapTelegramRichText.ts') ? ['textTonAddress'] : [];
  const members = path.endsWith('/appMessagesManager.ts') ? [
    'createGramTransferDraft', 'failGramTransferDraft', 'dropGramTransferDraft',
    'getSendingGramTransferDraft', 'adoptGramTransferDraft', 'dispatchTonConnectRequest', 'gramTransferDrafts'
  ] : path.endsWith('/internalLinkProcessor.ts') ? ['processWalletSendLink', 'processTonConnectLink'] : path.endsWith('/dialogElement.ts') ? ['createGramBadge'] : path.endsWith('/appPromoManager.ts') ? ['invalidateSuggestion'] : [];
  const found = new Set<string>();
  const visit = (node: any) => {
    if(!node || typeof(node) !== 'object') return;
    if(node.type === 'SwitchCase' && cases.includes(node.test?.value)) {
      found.add(node.test.value);
      result.remove(node.start, node.end);
      return;
    }
    if(['MethodDefinition', 'PropertyDefinition'].includes(node.type) && members.includes(node.key?.name)) {
      found.add(node.key.name);
      result.remove(node.start, node.end);
      return;
    }
    // Removing release-disabled branches here also lets their lazy imports leave
    // the graph before resolution, rather than paying for a runtime false check.
    if(!path.endsWith('/bubbles.ts') && node.type === 'CallExpression' && node.callee?.name === 'isWalletReleased') result.overwrite(node.start, node.end, 'false');
    for(const value of Object.values(node)) {
      if(Array.isArray(value)) value.forEach(visit);
      else if(value && typeof(value) === 'object') visit(value);
    }
  };
  visit(program);
  for(const name of [...cases, ...members]) if(!found.has(name)) fail(name);

  if(path.endsWith('/messageActionTextNewUnsafe.ts')) {
    replace('const UNSUPPORTED_ACTIONS = new Set<string>([\'messageActionGramTransfer\', \'messageActionWalletTonConnectRequest\']);');
    replace('(UNSUPPORTED_ACTIONS.has(_) ? UNSUPPORTED_LANG_PACK_KEY : `[${action._}]`)', '`[${action._}]`');
  }
  if(path.endsWith('/appMessagesManager.ts')) {
    replace('import GramTransferDrafts, {GramTransferDraftContent, WALLET_FIRST_GRAMS_SUGGESTION} from \'@lib/wallet/transferMessages\';');
    replace('    this.gramTransferDrafts.clear();');
    replace('this.pendingByMessageId[message.mid] ?? this.adoptGramTransferDraft(message)', 'this.pendingByMessageId[message.mid]');
    replace('      this.gramTransferDrafts.settle(randomId, message.mid);');
    replace('\n    this.dispatchTonConnectRequest(message);');
    replace(`      if(!isLocalThreadUpdate) {
        this.dispatchTonConnectRequest(message);
      }`);
    replace(`      if(action._ === 'messageActionGramTransfer' && !isLocalThreadUpdate) {
        this.appPromoManager.invalidateSuggestion(WALLET_FIRST_GRAMS_SUGGESTION);
      }`);
    replace(`    const pairing = this.gramTransferDrafts.getPairing(randomId, mid, !!this.getMessageFromStorage(pendingData.storage, mid));
    if(pairing !== 'pair') {
      if(pairing === 'drop') {
        this.dropGramTransferDraft(String(randomId));
      }

      return;
    }`);
  }
  if(path.endsWith('/uiNotificationsManager.ts')) {
    const start = source.indexOf('        if(emoticon && message._ === \'messageService\' && message.action._ === \'messageActionGramTransfer\')');
    const end = source.indexOf('if(emoticon) {', start);
    if(start < 0 || end < start) fail('transfer reaction notification');
    result.remove(start, end);
  }
  if(path.endsWith('/dialogElement.ts')) {
    for(const line of [
      '      gramBadge: !!this.dom.gramBadge,',
      '      [\'gramBadge\', !!options.gram],',
      '    if(options.gram) this.createGramBadge();',
      '      gramBadge: !!options.gram,'
    ]) replace(line);
  }
  if(path.endsWith('/icons.ts')) {
    for(const entry of ['  gram_filled: \'eaa7\',', '  gram_refund: \'eaa8\',', '  gram: \'eaa9\',', '  wallet: \'eb00\',']) replace(entry);
  }
  if(path.endsWith('/rowIconBackground.ts')) replace('  gram_filled: \'blue\',');
  if(path.endsWith('/messageRender.ts') || path.endsWith('/starsTransaction.ts')) replace('\'gram_filled\'', '\'ton\'');
  if(path.endsWith('/internalLinkProcessor.ts')) {
    replace(',\n      [INTERNAL_LINK_TYPE.WALLET_SEND]: this.processWalletSendLink,\n      [INTERNAL_LINK_TYPE.TON_CONNECT]: this.processTonConnectLink');
  }
  if(path.endsWith('/internalLink.ts')) replace(',\n  WALLET_SEND,\n  TON_CONNECT');
  if(path.endsWith('/wrapUrl.ts')) {
    const start = source.indexOf(' else if(/^ton:');
    const end = source.indexOf(' else if((tgMatch', start);
    if(start < 0 || end < start || !source.slice(start, end).includes('getAnchorHandlerName(\'tonconnect\', \'tc\')')) fail('link protocols');
    result.remove(start, end);
    const sendStart = source.indexOf(' else if(\n      // * the wallet');
    const sendEnd = source.indexOf(' else if(path[0])', sendStart);
    if(sendStart < 0 || sendEnd < sendStart) fail('sendgrams');
    result.remove(sendStart, sendEnd);
  }
  if(path.endsWith('/bubbles.ts')) {
    const start = source.indexOf(' else if(action._ === \'messageActionGramTransfer\')');
    const end = source.indexOf(' else if(action._ === \'messageActionChannelJoined\')', start);
    if(start < 0 || end < start) fail('service bubbles');
    result.remove(start, end);
    // The other use is the old paid-media amount glyph, outside Widget content.
    // Keep its pre-Wallet icon instead of adding the new wallet gem to the font.
    replace('Icon(\'gram_filled\', \'inline-icon\', \'text-text-bottom\')', 'Icon(\'ton\', \'inline-icon\', \'text-text-bottom\')');
  }
  return result;
}

const workerTargets = new Set<string>();

export default function widgetWallet(requireTargets = true): Plugin {
  const found = new Set<string>();
  return {
    name: 'widget-wallet',
    enforce: 'pre',
    apply: config => !config.build?.lib,
    buildStart() {
      found.clear();
      if(requireTargets) workerTargets.clear();
    },
    transform(source, id) {
      const path = TARGETS.find(path => id.split('?')[0].endsWith('/' + path));
      if(!path || path.endsWith('/wrapUrl.ts') && !id.endsWith('?widget-original')) return;
      found.add(path);
      if(!requireTargets) workerTargets.add(path);
      const result = pruneWidgetWallet(source, path, source => this.parse(source, {lang: 'ts'}));
      return {code: result.toString(), map: result.generateMap({hires: true})};
    },
    buildEnd(error) {
      // The worker sees a subset; the page owns the complete target audit.
      if(!error && requireTargets && TARGETS.some(path => !found.has(path) && !workerTargets.has(path))) {
        this.error('WIDGET_WALLET_TARGET_MISSING: ' + TARGETS.filter(path => !found.has(path) && !workerTargets.has(path)).join(', '));
      }
    }
  };
}
