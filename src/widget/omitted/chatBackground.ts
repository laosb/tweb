import themeController from '@helpers/themeController';
import highlightingColor from '@helpers/highlightingColor';
import rootScope from '@lib/rootScope';

// The widget has no wallpapers: the chat sits on the host's --widget-chat-background-color
// (and optional image, see src/widget/style.scss) or the theme's plain background. This
// stands in for src/components/chat/bubbles/chatBackground.tsx with the API the chat page uses.

type BackgroundOptions = {
  onCachedStatus?: (cached: boolean) => void,
  onHighlightColor?: (hsla: string) => void,
  deferReveal?: (reveal: () => void) => void
};

const element = document.createElement('div');
element.setAttribute('aria-hidden', 'true');
element.classList.add('blah-widget-background');
let last: BackgroundOptions = {};

/** Service messages and highlights take their tint from the background, as over a wallpaper. */
function highlight() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  context.fillStyle = getComputedStyle(element).backgroundColor;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  const hsla = highlightingColor([r, g, b]);
  themeController.applyHighlightingColor({hsla});
  last.onHighlightColor?.(hsla);
}

const appChatBackground = {
  element,
  attach(parent: HTMLElement = document.body) {
    if(element.parentElement !== parent) parent.insertBefore(element, parent.firstChild);
  },
  setBackground(options: BackgroundOptions = {}) {
    last = options;
    options.onCachedStatus?.(true);
    if(element.isConnected) highlight();
    options.deferReveal?.(() => {});
    return Promise.resolve();
  },
  getActiveGradientRenderer: (): undefined => undefined,
  onActiveGradientRendererChange(listener: (renderer: undefined) => void) {
    listener(undefined);
    return () => {};
  },
  getReadyPromise: () => Promise.resolve(),
  resize() {},
  reRender() {
    return appChatBackground.setBackground(last);
  }
};

rootScope.addEventListener('theme_changed', () => element.isConnected && highlight());

/** Inline backgrounds (previews and lock screens the widget never shows) are left plain. */
export function ChatBackground(props: {class?: string}) {
  const layer = document.createElement('div');
  if(props.class) layer.className = props.class;
  return layer;
}

export default appChatBackground;
