// Blah has no message translation, so the widget offers none and never needs a message's
// language; an undetected one is never counted as foreign (src/stores/peerLanguage.ts).
export default function detectLanguage(_text: string): Promise<TranslatableLanguageISO> {
  return new Promise(() => {});
}
