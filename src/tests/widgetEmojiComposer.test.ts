import '@/tests/mocks/widgetEmoji';
import '@/tests/mocks/chatInputEditorEngineUi';
import {mountChatInputEditor} from '@/tests/helpers/chatInputEditor';
import {chatEmojiImagesKey} from '@components/chat/inputEditor/extensions/emojiImages';
import parseEntities from '@lib/richTextProcessor/parseEntities';

let mounted: ReturnType<typeof mountChatInputEditor>;
afterEach(() => { mounted?.editor.destroy(); mounted?.input.remove(); });

it.each(['🤼🏻', '🦰'])('keeps %s as text across selection, replacement and undo', (input) => {
  mounted = mountChatInputEditor();
  const {editor, tiptap} = mounted;
  const text = 'A ' + input + ' Z';
  editor.setTextWithEntities(text, parseEntities(text));
  expect(editor.getRichValue().value).toBe(text);
  expect(chatEmojiImagesKey.getState(tiptap.state)).toBeUndefined();
  expect(mounted.input.querySelector('.chat-input-emoji-image, img.emoji')).toBeNull();
  // ProseMirror positions include the opening paragraph token; entity offsets do not.
  editor.restoreSelection({from: 3, to: 3 + input.length}, false);
  expect(editor.getSelectedText()).toBe(input);
  editor.separateHistory();
  expect(editor.replaceSelection('!')).toBe(true);
  expect(editor.getRichValue().value).toBe('A ! Z');
  expect(editor.undo()).toBe(true);
  expect(editor.getRichValue().value).toBe(text);
  editor.restoreSelection({from: 3 + input.length, to: 3 + input.length}, false);
  expect(editor.getRichValue(true, true).caretPos).toBe(2 + input.length);
});
