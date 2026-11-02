/** The replacement deliberately drops only artwork membership. Any upstream
 * signature, export, normalization or control-flow change needs a fresh review.
 */
const reviewedSource = `
import Emoji from '@config/emoji';
import {encodeEmoji} from '@vendor/emoji';
export default function getEmojiUnified(emojiCode: string) {
  const unified = encodeEmoji(emojiCode).replace(/-?fe0f/g, '');
  if(!Emoji.hasOwnProperty(unified)) { return; }
  return unified;
}`;

function shape(value: any): any {
  if(Array.isArray(value)) return value.map(shape);
  if(!value || typeof(value) !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort()
  .filter(key => !['start', 'end', 'loc', 'range', 'raw', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key))
  .map(key => [key, shape(value[key])]));
}

export function assertWidgetEmojiSource(source: string, parse: (source: string) => any) {
  const body = (source: string) => {
    const parsed = parse(source);
    return JSON.stringify(shape((parsed.program || parsed).body));
  };
  if(body(source) !== body(reviewedSource)) throw new Error('re-review widget getEmojiUnified export/signature/semantics');
}

// Both consumers scan the Unicode regex before normalization. parseEntities feeds
// mergeEntities/fixEmoji, bubble sizing, wrapRichText and ChatInput's entity logic.
// emojiImages keeps text/selection intact and skips decorations for native emoji.
const reviewedConsumers = new Set([
  'src/lib/richTextProcessor/parseEntities.ts',
  'src/components/chat/inputEditor/extensions/emojiImages.ts'
]);

export function assertWidgetEmojiConsumer(path: string) {
  if(!reviewedConsumers.has(path.split('?')[0])) throw new Error('re-review widget getEmojiUnified consumer: ' + path);
}

export function assertWidgetEmojiModules(paths: string[]) {
  if(paths.some(path => path.split('?')[0] === 'src/config/emoji.ts')) {
    throw new Error('widget artwork emoji table is reachable');
  }
}
