import {encodeEmoji} from '@vendor/emoji';

/** Both reviewed callers pass a Unicode emoji regex match. Keep standalone text
 * symbols the artwork table rejected. Check after normalization so fixEmoji's
 * added selectors cannot turn bare gender signs into emoji on the next parse.
 */
export default function getEmojiUnified(emojiCode: string): string | undefined {
  const unified = encodeEmoji(emojiCode).replace(/-?fe0f/g, '');
  if(/^(2640|2642|2695)$/.test(unified)) return;
  return unified;
}
