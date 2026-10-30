import Chat from '@components/chat/chat';

const insets = new WeakMap<Chat, {top: number, right: number, bottom: number, left: number, surplus: number}>();
function getInsets(instance: Chat) {
  if(!insets.has(instance)) insets.set(instance, {top: 0, right: 0, bottom: 0, left: 0, surplus: 0});
  return insets.get(instance);
}

export function getWidgetInsetTop(chat: Chat) {
  return getInsets(chat).top;
}

// Keep the history signals and scroll anchoring in step with the host's CSS lengths.
export function applyWidgetInsets() {
  const chat = Chat.prototype as any;
  for(const key of ['init', 'recomputePaddings', 'updateChatInputHeight', 'preservePaddingScroll']) {
    if(typeof(chat[key]) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: ' + key);
  }
  const updateChatInputHeight = chat.updateChatInputHeight;
  chat.updateChatInputHeight = function(surplus: number) {
    const inset = getInsets(this);
    inset.surplus = surplus;
    updateChatInputHeight.call(this, surplus + inset.bottom);
  };

  const init = chat.init;
  chat.init = function(...args: unknown[]) {
    const result = init.apply(this, args);
    const probe = document.createElement('div');
    probe.className = 'widget-inset-probe';
    probe.setAttribute('aria-hidden', 'true');
    const endProbe = probe.cloneNode() as HTMLElement;
    endProbe.classList.add('widget-inset-probe-end');
    this.container.append(probe, endProbe);
    const observer = new ResizeObserver((entries) => {
      const inset = getInsets(this);
      let {top, right, bottom, left} = inset;
      for(const {target, contentRect: {width, height}} of entries) {
        if(target === probe) {
          top = height;
          left = width;
        } else {
          bottom = height;
          right = width;
        }
      }
      if(inset.top === top && inset.right === right && inset.bottom === bottom && inset.left === left) return;
      // Pin before narrowing the history: rewrapped bubbles already move its end.
      this.preservePaddingScroll();
      const bottomChanged = inset.bottom !== bottom;
      Object.assign(inset, {top, right, bottom, left});
      for(const [side, value] of Object.entries({top, right, left})) {
        this.container.style.setProperty('--widget-history-inset-' + side, value + 'px');
      }
      if(bottomChanged) this.updateChatInputHeight(inset.surplus);
      else this.recomputePaddings();
    });
    observer.observe(probe);
    observer.observe(endProbe);
    this.destroyMiddlewareHelper.onDestroy(() => {
      observer.disconnect();
      probe.remove();
      endProbe.remove();
    });
    return result;
  };
}
