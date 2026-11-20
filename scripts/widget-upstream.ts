import MagicString from 'magic-string';
import type {Plugin} from 'vite';

// The pinned DC's support account never sends bot HTML widgets. Remove their
// shared entry points before resolving imports, as well as their standalone graph.
// Channel reaction settings are also unreachable; ordinary reactions stay intact.
export const WIDGET_UPSTREAM_TARGETS = [
  'src/config/databases/state.ts',
  'src/config/state.ts',
  'src/lib/serviceWorker/index.service.ts',
  'src/lib/appManagers/createManagers.ts',
  'src/lib/appManagers/appChatsManager.ts',
  'src/lib/appManagers/appProfileManager.ts',
  'src/lib/appManagers/appUsersManager.ts',
  'src/lib/internalLinkProcessor.ts',
  'src/lib/appManagers/appMessagesManager.ts',
  'src/lib/appManagers/appInlineBotsManager.ts',
  'src/lib/appManagers/apiUpdatesManager.ts',
  'src/lib/storages/dialogs.ts',
  'src/lib/appManagers/utils/messages/forwardKeepsAuthor.ts',
  'src/components/chat/bubbles.ts',
  'src/components/chat/contextMenu.ts',
  'src/components/chat/messageRender.ts',
  'src/components/chat/firstScreenHistory.ts',
  'src/components/chat/bubbleParts/solidMessageShell.ts',
  'src/components/wrappers/messageForReply.ts',
  'src/components/wrappers/messagePreviewIcon.ts',
  'src/helpers/outgoingMessageGradient.ts',
  'src/helpers/fastSmoothScroll.ts'
];
const WIRE_NAMES = ['messageMediaWidget', 'botInlineMessageWidget', 'updateMessageWidgetData'];
const MEMBERS = ['watchFirstScreenSight', 'getMessageWidgetKey', 'onUpdateMessageWidgetData', 'setMessagesWidgetData', 'isWidgetTextSelected', 'setChatAvailableReactions', 'applyChatAvailableReactions', 'reactionsSaves',
  'getShareThemeBackdrops', 'getCachedShareTheme', 'setShareTheme', 'replaceCachedShareTheme', 'shareThemeSaves', 'shareThemeWrites',
  'exportContactToken', 'withLocalExpiry', 'exportNoPaidMessagesToken', 'getKeptNoPaidMessagesToken', 'setKeptNoPaidMessagesTokenPermanent',
  'importNoPaidMessagesToken', 'useNoPaidMessagesToken', 'noPaidTokenAsks', 'noPaidTokenKeptAsk', 'noPaidTokenPermanent', 'noPaidTokenWrites'];
const IMPORTS = /^(?:@lib\/widgetSandbox\/|@components\/chat\/bubbleParts\/widgetEdit$|@appManagers\/appWidgetsManager$)/;
const FALSE_CALLS = ['isWidgetRenderingEnabled', 'whenWidgetRenderingEnabled', 'isWidgetHorizontalDragTarget'];
const valueOf = (node: any) => node?.value;

export function pruneWidgetUpstream(source: string, path: string, parse: (source: string) => any) {
  const result = new MagicString(source);
  const fail = (detail: string) => { throw new Error('WIDGET_UPSTREAM_TARGET_CHANGED: ' + path + ': ' + detail); };
  const replace = (before: string, after = '') => {
    if(source.split(before).length !== 2) fail(before);
    const start = source.indexOf(before);
    result.overwrite(start, start + before.length, after);
    changes++;
  };
  const program = parse(source);
  let changes = 0;
  const remove = (node: any) => { result.remove(node.start, node.end); changes++; };
  const overwrite = (node: any, value: string) => { result.overwrite(node.start, node.end, value); changes++; };
  const removeProperty = (node: any) => {
    let end = node.end;
    while(/\s/.test(source[end] || '') && end < source.length) end++;
    if(source[end] !== ',') fail('property separator');
    result.remove(node.start, end + 1);
    changes++;
  };
  const removeListItem = (node: any) => {
    let start = node.start, end = node.end;
    while(/\s/.test(source[end] || '') && end < source.length) end++;
    if(source[end] === ',') end++;
    else {
      start--;
      while(/\s/.test(source[start])) start--;
      start = source[start] === ',' ? start : node.start;
      end = node.end;
    }
    result.remove(start, end);
    changes++;
  };
  const visit = (node: any) => {
    if(!node || typeof node !== 'object') return;
    if(path.endsWith('/bubbles.ts')) {
      // Only bot HTML consumes render sight. Remove its plumbing as well as the
      // height observer, so opening ordinary history does no extra counting.
      if(node.type === 'VariableDeclaration' && node.declarations.length === 1 && ['sight', 'OUT_OF_SIGHT'].includes(node.declarations[0].id?.name)) { remove(node); return; }
      if(node.type === 'IfStatement' && node.test?.name === 'sight') { remove(node); return; }
      if(node.type === 'Property' && ['sight', 'follow'].includes(node.key?.name)) { removeListItem(node); return; }
      for(const param of node.params || []) {
        if(['sight', 'outOfSight'].includes(param.name)) removeListItem(param);
      }
      if(node.type === 'CallExpression') {
        const args = node.arguments;
        const method = node.callee?.property?.name;
        const from = method === 'performHistoryResult' && args.length === 4 ? 3 :
          method === 'getHistory1' && args.length === 8 ? 5 :
          method === 'getHistory' && args.length === 9 ? 8 :
          args.at(-1)?.name === 'sight' ? args.length - 1 : -1;
        if(from !== -1) removeListItem({start: args[from].start, end: args.at(-1).end});
      }
    }
    if(path.endsWith('/internalLinkProcessor.ts') && node.type === 'IfStatement' && node.test?.object?.name === 'link' && node.test?.property?.name === 'free') { remove(node); return; }
    if(node.type === 'ImportDeclaration' && IMPORTS.test(valueOf(node.source))) { remove(node); return; }
    if(node.type === 'SwitchCase' && WIRE_NAMES.includes(valueOf(node.test))) { remove(node); return; }
    if(['MethodDefinition', 'PropertyDefinition'].includes(node.type) && MEMBERS.includes(node.key?.name)) { remove(node); return; }
    if(node.type === 'Property' && ['appWidgetsManager', 'updateMessageWidgetData', 'noPaidMessagesToken'].includes(node.key?.name)) { removeProperty(node); return; }
    if(node.type === 'CallExpression' && FALSE_CALLS.includes(node.callee?.name)) { overwrite(node, 'false'); return; }
    if(node.type === 'CallExpression' && node.callee?.name === 'getWidgetBlockHeight') { overwrite(node, '0'); return; }
    if(node.type === 'BinaryExpression' && WIRE_NAMES.includes(valueOf(node.right)) && ['===', '!=='].includes(node.operator)) {
      overwrite(node, node.operator === '===' ? 'false' : 'true'); return;
    }
    if(node.type === 'ExpressionStatement' && node.expression?.type === 'CallExpression' && node.expression.callee?.object?.property?.name === 'appWidgetsManager') { overwrite(node, ';'); return; }
    if(node.type === 'ExpressionStatement' && node.expression?.type === 'AssignmentExpression' && node.expression.left?.property?.name === 'isWidgetTextSelected') { remove(node); return; }
    if(node.type === 'MemberExpression' && node.property?.name === 'isWidgetTextSelected') { overwrite(node, 'false'); return; }
    if(path.endsWith('/outgoingMessageGradient.ts')) {
      if(node.type === 'FunctionDeclaration' && node.id?.name === 'getSolidColor') { remove(node); return; }
      if(node.type === 'Property' && node.key?.name === 'solid') {
        // Both gradient literals end with this property.
        let start = node.start - 1;
        while(/\s/.test(source[start])) start--;
        if(source[start] !== ',') fail('gradient solid separator');
        result.remove(start, node.end); changes++; return;
      }
      if(node.type === 'ExpressionStatement' && node.expression?.callee?.name === 'set' && node.expression.arguments[0]?.name === 'SOLID_PROPERTY') { remove(node); return; }
    }
    for(const value of Object.values(node)) {
      if(Array.isArray(value)) value.forEach(visit);
      else if(value && typeof value === 'object') visit(value);
    }
  };
  visit(program);
  if(path.endsWith('/fastSmoothScroll.ts')) {
    // The only caller follows delayed HTML-widget height changes. Quote focus
    // measurement and ordinary scrolling keep upstream's fixes.
    replace('const following = options.follow && axis === \'y\';', 'const following = false;');
  }
  if(path.endsWith('/appProfileManager.ts')) {
    replace(`    const shareTheme = (fullPeer as UserFull.userFull | ChatFull.channelFull).share_theme;
    if(shareTheme?._ === 'shareThemeGift' && shareTheme.stargift._ === 'starGiftUnique') {
      this.appGiftsManager.wrapGift(shareTheme.stargift);
    }`);
  }
  if(path.endsWith('/internalLinkProcessor.ts')) {
    replace(',\n          free: uriParams.free');
    replace(',\n            free: uriParams.free');
    replace(',\n            free: (uriParams as K8).free');
    replace(', free: uriParams.free', '');
  }
  if(path.endsWith('/bubbles.ts')) {
    replace(`    const widgetNetwork = findUpClassName(target, 'time-widget-network');
    if(widgetNetwork) {
      showTooltip({
        element: widgetNetwork,
        container: this.container,
        vertical: 'top',
        textElement: i18n('Widget.NetworkMarker')
      });
      return;
    }`);
  }
  if(path.endsWith('/contextMenu.ts')) replace(',\n          \'.time-widget-network\'');
  if(path.endsWith('/serviceWorker/index.service.ts')) {
    replace('|ttf|mesh)', '|ttf)');
  }
  if(path.endsWith('/databases/state.ts')) {
    replace(',\n    {\n      name: \'widgets\',\n      encryptedName: \'widgets__encrypted\'\n    }');
  }
  if(path.endsWith('/storages/dialogs.ts')) {
    replace('        const deleted = new Set<number>();');
    replace('            deleted.add(+topicId);');
    replace('        if(deleted.size) {', '        if(false) {');
  }
  if(!changes) fail('no unreachable entry points');
  return result;
}

const workerTargets = new Set<string>();
export default function widgetUpstream(requireTargets = true): Plugin {
  const found = new Set<string>();
  return {
    name: 'widget-upstream',
    enforce: 'pre',
    apply: config => !config.build?.lib,
    buildStart() {
      found.clear();
      if(requireTargets) workerTargets.clear();
    },
    transform(source, id) {
      const path = WIDGET_UPSTREAM_TARGETS.find(path => id.split('?')[0].endsWith('/' + path));
      if(!path || path.endsWith('/messageForReply.ts') && !id.endsWith('?widget-original')) return;
      found.add(path);
      if(!requireTargets) workerTargets.add(path);
      const result = pruneWidgetUpstream(source, path, source => this.parse(source, {lang: 'ts'}));
      return {code: result.toString(), map: result.generateMap({hires: true})};
    },
    buildEnd(error) {
      if(!error && requireTargets) {
        const missing = WIDGET_UPSTREAM_TARGETS.filter(path => !found.has(path) && !workerTargets.has(path));
        if(missing.length) this.error('WIDGET_UPSTREAM_TARGET_MISSING: ' + missing.join(', '));
      }
    }
  };
}
