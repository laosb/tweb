// Without syntax highlighting there is nothing to detect a code block's language for.
export default function detectCodeLanguage(_code: string): Promise<string | undefined> {
  return Promise.resolve(undefined);
}
