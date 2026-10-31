// Blah has no translation. Settle with no language so the store releases pending work.
export default function detectLanguage(_text: string): Promise<TranslatableLanguageISO> {
  return Promise.resolve(undefined);
}
