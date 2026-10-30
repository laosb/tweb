import appChatBackground from '@components/chat/bubbles/chatBackground';
import {ColorRgb, rgbaToHexa} from '@helpers/color';
import themeController, {AppColorName} from '@helpers/themeController';
import {MESSAGE_OUT_TINT} from '@helpers/outgoingMessageGradient';
import rootScope from '@lib/rootScope';
import {widgetCornerRules} from '@/widget/themeCorners';

const W = 'body.blah-widget';
// Chats have their own inline theme; overlays can opt into .night even in a light document.
const SCOPE = `:root, ${W}, ${W} .chat, ${W} .night`;
const colors: [string, AppColorName][] = [
  ['surface-color', 'surface-color'],
  ['text-color', 'primary-text-color'],
  ['accent-color', 'primary-color'],
  ['incoming-bubble-color', 'message-background-color'],
  ['outgoing-bubble-color', 'message-out-background-color'],
  ['outgoing-accent-color', 'message-out-primary-color'],
  ['danger-color', 'danger-color'],
  ['support-sender-color', 'saved-color'],
  ['incoming-text-color', 'primary-text-color'],
  ['outgoing-text-color', 'primary-text-color']
];
const rule = (selector: string, body: string) => `${selector} { ${body} }`;
const scoped = (body: string) => rule(SCOPE, body);

export function applyWidgetTheme() {
  const style = document.createElement('style');
  style.id = 'blah-widget-tweb-theme';
  document.head.append(style);
  // Let the browser resolve *any* CSS color, including var(), currentColor, color-mix and
  // wide-gamut syntax. Canvas converts it to sRGB for upstream's RGB/HSL derivation.
  const probes = document.createElement('div');
  probes.hidden = true;
  probes.setAttribute('aria-hidden', 'true');
  const inputs = new Map(colors.map(([name]) => {
    const probe = document.createElement('span');
    probe.style.color = `var(--widget-${name})`;
    probes.append(probe);
    return [name, probe];
  }));
  document.documentElement.append(probes);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  const rgb = (color: string): ColorRgb => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3) as ColorRgb;
  };
  let backgroundColor: string, previous: string;
  const apply = () => {
    const html = document.documentElement;
    const computed = getComputedStyle(html);
    const values = new Map(colors.map(([name]) => [name, computed.getPropertyValue('--widget-' + name).trim() ? getComputedStyle(inputs.get(name)).color : '']));
    const corners = widgetCornerRules(computed);
    const isNight = html.classList.contains('night');
    // Read upstream's inline bases, not our last stylesheet's overrides, for unset mix colors.
    const native = new Map([...colors.map(([, name]) => name), 'secondary-text-color'].map(name => [name, html.style.getPropertyValue('--' + name)]));
    const surface = values.get('surface-color') || native.get('surface-color');
    const outgoing = values.get('outgoing-bubble-color') || native.get('message-out-background-color');
    const signature = JSON.stringify([isNight, [...values], [...native], corners]);
    if(signature !== previous) {
      previous = signature;
      const rules = [corners];
      const derive = (name: AppColorName, value: string, filledOnly = false) => {
        const element = document.createElement('div');
        themeController.applyAppColor({
          name, hex: rgbaToHexa(rgb(value)), element, isNight, saveToCache: false,
          mixColor: (name === 'message-out-primary-color' ? outgoing : surface) ? rgb(name === 'message-out-primary-color' ? outgoing : surface) : undefined,
          lightenAlpha: name === 'message-out-primary-color' ? MESSAGE_OUT_TINT : name === 'message-out-background-color' ? (isNight ? 1 : .12) : .08,
          darkenAlpha: name === 'primary-color' ? .04 : undefined
        });
        // Retain the resolved base's alpha/gamut. Upstream's companions are sRGB.
        element.style.setProperty('--' + name, value);
        if(name === 'primary-color' || name === 'danger-color') element.style.setProperty('--' + name.replace('-color', '-button-color'), value);
        return Array.from(element.style).filter(key => !filledOnly || key.startsWith('--light-filled-')).map(key => `${key}: ${element.style.getPropertyValue(key)} !important;`).join(' ');
      };
      for(const [variable, name] of colors) {
        const value = values.get(variable);
        if(!value) continue;
        if(variable === 'incoming-text-color' || variable === 'outgoing-text-color') {
          rules.push(rule(`${W} .bubble${variable === 'outgoing-text-color' ? '.is-out' : ':not(.is-out)'} .bubble-content`, `${derive(name, value)} color: ${value};`));
        } else if(variable === 'support-sender-color') {
          rules.push(rule(`${W} .name, ${W} .reply, ${W} .bubble:not(.is-out) .quote-like, ${W} .reply-wrapper-content, ${W} .avatar`, `--peer-color-rgb: ${rgb(value).join(',')} !important; --peer-border-background: ${value} !important; --color-top: ${value} !important; --color-bottom: ${value} !important;`));
        } else {
          rules.push(scoped(derive(name, value)));
        }
      }
      // Filled companions also depend on the surface even when their own base is unset.
      if(values.get('surface-color')) {
        for(const [variable, name] of [...colors.filter(([, name]) => ['primary-color', 'message-background-color', 'message-out-background-color'].includes(name)), ['secondary-text-color', 'secondary-text-color']] as [string, AppColorName][]) {
          const base = native.get(name);
          if(!values.get(variable) && base) rules.push(scoped(derive(name, base, true)));
        }
      }
      if(values.get('outgoing-bubble-color') && !values.get('outgoing-accent-color')) {
        const base = native.get('message-out-primary-color');
        if(base) rules.push(scoped(derive('message-out-primary-color', base, true)));
      }
      if(values.get('accent-color')) {
        rules.push(scoped(derive('link-color', values.get('accent-color'))));
        rules.push(scoped(derive('green-color', values.get('accent-color'))));
        rules.push(scoped('--selection-background-color: rgba(var(--primary-color-rgb), .4) !important; --spoiler-background-color: var(--light-primary-color) !important; --gc-blue-text-color: var(--primary-color) !important;'));
        rules.push(rule(`${W} ::selection`, 'background-color: var(--selection-background-color); color: inherit;'));
        rules.push(rule(`${W} .media-viewer-caption`, '--link-color: var(--primary-color) !important;'));
        rules.push(rule(`${W} .document`, '--background-color: var(--primary-color) !important;'));
        rules.push(rule(`${W} .bubble.is-highlighted:after, ${W} .album-item.is-highlighted:after, ${W} .document-container.is-highlighted .document-selection`, 'background-color: rgba(var(--primary-color-rgb), .4) !important;'));
      }
      if(values.get('outgoing-accent-color')) {
        rules.push(rule(`${W} .bubble.is-out ::selection`, 'background-color: var(--selection-background-color); color: inherit;'));
        rules.push(rule(`${W} .chat`, '--message-out-status-color: var(--message-out-primary-color) !important; --message-out-time-color: var(--message-out-primary-color) !important; --message-out-selection-background-color: rgba(var(--message-out-primary-color-rgb), .4) !important;'));
        rules.push(rule(`${W} .bubble.is-out .document`, '--background-color: var(--message-out-primary-color) !important;'));
      }
      if(values.get('danger-color')) rules.push(scoped('--message-error-color: var(--danger-color) !important; --gc-red-text-color: var(--danger-color) !important;'));
      const text = rules.join('\n');
      if(style.textContent !== text) style.textContent = text;
    }
    // The background and service/date pill tint remain owned by the existing background lane.
    const color = getComputedStyle(appChatBackground.element).backgroundColor;
    if(color !== backgroundColor) {
      backgroundColor = color;
      appChatBackground.reRender();
    }
  };
  let pending = false;
  const schedule = () => {
    if(pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; apply(); });
  };
  apply();
  rootScope.addEventListener('theme_changed', schedule);
  new MutationObserver(schedule).observe(document.documentElement, {attributes: true, attributeFilter: ['class', 'style']});
}
