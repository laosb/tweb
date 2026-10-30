import {EmoticonsDropdown} from '@components/emoticonsDropdown';

// Shared text fields expect a node and a disposer even when there is no picker.
export default function createEmojiDropdownButton() {
  return {button: document.createTextNode(''), dispose() {}};
}
export function useEmojiDropdown() {
  return {emoticonsDropdown: new EmoticonsDropdown({tabsToRender: []})};
}
