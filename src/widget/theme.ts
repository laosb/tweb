import appChatBackground from '@components/chat/bubbles/chatBackground';
import rootScope from '@lib/rootScope';

// tweb writes its theme inline on <html> and on each chat, so a stylesheet cannot fall back
// to it; the widget's CSS variables are applied as rules only for the values the page sets.
const W = 'body.blah-widget';
const themeVariable = (name: string) => (value: string) => `${W} #page-chats, ${W} #page-chats .chat { ${name}: ${value} !important; }`;
const RULES: [variable: string, rule: (value: string) => string][] = [
  ['surface-color', themeVariable('--surface-color')],
  ['text-color', themeVariable('--primary-text-color')],
  ['accent-color', themeVariable('--primary-color')],
  ['incoming-bubble-color', themeVariable('--message-background-color')],
  ['outgoing-bubble-color', themeVariable('--message-out-background-color')],
  ['incoming-text-color', (value) => `${W} .bubble:not(.is-out) .bubble-content { color: ${value}; }`],
  ['outgoing-text-color', (value) => `${W} .bubble.is-out .bubble-content { color: ${value}; }`],
  ['bubble-radius', (value) => `${W} .bubble .bubble-content { border-radius: ${value} !important; } ${W} .bubble .bubble-tail { display: none; }`],
  ['incoming-bubble-radius', (value) => `${W} .bubble:not(.is-out) .bubble-content { border-radius: ${value} !important; } ${W} .bubble:not(.is-out) .bubble-tail { display: none; }`],
  ['outgoing-bubble-radius', (value) => `${W} .bubble.is-out .bubble-content { border-radius: ${value} !important; } ${W} .bubble.is-out .bubble-tail { display: none; }`]
];

export function applyWidgetTheme() {
  const style = document.createElement('style');
  style.id = 'blah-widget-tweb-theme';
  document.head.append(style);
  let backgroundColor: string;
  const apply = () => {
    const computed = getComputedStyle(document.documentElement);
    const text = RULES.map(([variable, rule]) => {
      const value = computed.getPropertyValue('--widget-' + variable).trim();
      return value ? rule(value) : '';
    }).join('\n');
    if(style.textContent !== text) style.textContent = text;
    // The chat background (src/widget/style.scss) also tints service messages.
    const color = getComputedStyle(appChatBackground.element).backgroundColor;
    if(color !== backgroundColor) {
      backgroundColor = color;
      appChatBackground.reRender();
    }
  };
  apply();
  // Light and dark values switch with tweb's `night` class; hosts may also set variables inline.
  rootScope.addEventListener('theme_changed', apply);
  new MutationObserver(apply).observe(document.documentElement, {attributes: true, attributeFilter: ['class', 'style']});
}
