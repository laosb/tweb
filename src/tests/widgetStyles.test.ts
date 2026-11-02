import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {widgetStyles, assertWidgetStyleSelector} from '../../scripts/widget-styles';
import omitted from '@/widget/omittedStyles.json';

const source = readFileSync('src/scss/style.scss', 'utf8');

describe('widget global styles', () => {
  it('omits exactly the reviewed upstream uses', () => {
    const filtered = widgetStyles(source);
    for(const entry of omitted) expect(filtered).not.toContain(`@use "${entry}";`);
    for(const entry of ['partials/chatPinned', 'partials/starsBadge', 'partials/slider', 'partials/popups/peer', 'partials/peerTyping', 'partials/chatBubble', 'partials/reactions', 'partials/popups/reactedList', 'partials/accessibility']) {
      expect(filtered).toContain(`@use "${entry}";`);
    }
  });

  it('fails after any upstream omission target is renamed, removed or duplicated', () => {
    for(const entry of omitted) {
      const line = `@use "${entry}";`;
      expect(() => widgetStyles(source.replace(line, ''))).toThrow('re-review');
      expect(() => widgetStyles(source.replace(line, '// ' + line))).toThrow('re-review');
      expect(() => widgetStyles(source + '\n' + line)).toThrow('re-review');
    }
  });

  it('rejects hidden feature selectors while retaining shared surfaces and RTL/a11y', () => {
    for(const selector of ['.popup-call .button', '.profile-name', '.emoji-dropdown', 'poll-element .poll-answer', '.popup-payment-methods']) {
      expect(() => assertWidgetStyleSelector(selector)).toThrow('omitted selector');
    }
    for(const selector of ['.reply-title', '.popup-peer', '.tabs-container', '.popup-reacted-list', '.is-rtl .reply-media', '.a11y .btn-icon:focus-visible', '.media-viewer-buttons']) {
      expect(() => assertWidgetStyleSelector(selector)).not.toThrow();
    }
  });
});
