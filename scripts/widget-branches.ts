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

export default function widgetBranches(): Plugin {
  let found = false;
  return {
    name: 'widget-branches',
    enforce: 'pre',
    apply: (config) => !config.build?.lib,
    buildStart() { found = false; },
    transform(source, id) {
      if(!id.endsWith('/src/components/peerTitle.ts')) return;
      found = true;
      const result = pruneWidgetPeerTitle(source);
      return {code: result.toString(), map: result.generateMap({hires: true})};
    },
    buildEnd(error) {
      if(!error && !found) this.error('WIDGET_BRANCH_TARGET_MISSING: peerTitle');
    }
  };
}
