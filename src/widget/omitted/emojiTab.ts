// Picker-only exports referenced by ChatInput, reaction expansion and sticker menus.
// Native emoji in message text uses the rich-text renderer, not this module.
export default class EmojiTab {}
// Sticker-pack context menus also use this reader for Copy, outside any picker.
export function getEmojiFromElement(element: HTMLElement) {
  const emoji = element.closest('.super-emoji');
  if(!emoji) return;
  const custom = emoji.querySelector<HTMLElement>('.custom-emoji');
  return custom ? {emoji: custom.dataset.stickerEmoji, docId: custom.dataset.docId} :
    {emoji: emoji.querySelector('[alt]')?.getAttribute('alt') || emoji.textContent};
}
