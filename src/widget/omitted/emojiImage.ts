// The widget already promises native emoji on every platform. Custom emoji use
// their separate document renderer and are unaffected by this image fallback.
export const isEmojiNative = (_unicode: string) => true;
export const areAllEmojiNative = () => true;
export const getEmojiImageUrl = (unicode: string) => `assets/img/emoji/${unicode}.png`;
