import type {EMOJI_VERSION} from '@/environment/emojiVersionsSupport';

export type {EMOJI_VERSION};
// See ./emojiSupport.ts: no version falls back to an emoji image.
const EMOJI_VERSIONS_SUPPORTED: {[version in EMOJI_VERSION]: boolean} = {'': true, '14': true, '15': true, '15.1': true, '16': true};
export default EMOJI_VERSIONS_SUPPORTED;
