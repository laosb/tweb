import MagicString from 'magic-string';
import type {Plugin} from 'vite';

// Only the topics pseudo-peer label; retain sender titles and reaction-participant rows.
const TOPICS_TITLE = [
  '    if(this.options.asAllChats === \'topics\') {',
  '      const title = i18n(\'AllMessages\');',
  '',
  '      const inner = document.createElement(\'span\');',
  '      inner.classList.add(\'peer-title-inner\');',
  '      hasInner = true;',
  '      setInnerHTML(inner, title);',
  '',
  '      const fragment = document.createDocumentFragment();',
  '      const emojiText = document.createElement(\'span\');',
  '      /* !IS_EMOJI_SUPPORTED && */ emojiText.classList.add(\'emoji-topic-icon\');',
  '      emojiText.append(wrapEmojiText(\'💬\'));',
  '      fragment.append(emojiText, inner);',
  '',
  '      setInnerHTML(this.element, fragment);',
  '    } else '
].join('\n');

export function pruneWidgetPeerTitle(source: string) {
  if(source.split(TOPICS_TITLE).length !== 2) throw new Error('WIDGET_BRANCH_TARGET_CHANGED: peerTitle topics');
  const start = source.indexOf(TOPICS_TITLE);
  return new MagicString(source).overwrite(start, start + TOPICS_TITLE.length, '    ');
}

// Remove the Wallet menu records before constructors resolve their hidden labels/icons.
export function pruneWidgetWalletMenu(source: string) {
  const records = [...source.matchAll(/    \}, \{\n      \/\/ \* [^\n]+\n      icon: 'wallet',[\s\S]*?(?=\n    \}, \{)/g)];
  if(records.length !== 1 || !/text: 'Wallet(AttachMoney|SendMoney)'/.test(records[0][0])) {
    throw new Error('WIDGET_BRANCH_TARGET_CHANGED: wallet menu');
  }
  const record = records[0];
  return new MagicString(source).remove(record.index, record.index + record[0].length);
}

export default function widgetBranches(): Plugin {
  const found = new Set<string>();
  const targets = ['src/components/peerTitle.ts', 'src/components/chat/input.ts', 'src/components/chat/contextMenu.ts'];
  return {
    name: 'widget-branches',
    enforce: 'pre',
    apply: (config) => !config.build?.lib,
    buildStart() { found.clear(); },
    transform(source, id) {
      const target = targets.find(path => id.endsWith('/' + path));
      if(!target) return;
      found.add(target);
      const result = target.endsWith('/peerTitle.ts') ? pruneWidgetPeerTitle(source) : pruneWidgetWalletMenu(source);
      return {code: result.toString(), map: result.generateMap({hires: true})};
    },
    buildEnd(error) {
      if(!error && found.size !== targets.length) this.error('WIDGET_BRANCH_TARGET_MISSING: ' + targets.filter(path => !found.has(path)).join(', '));
    }
  };
}
