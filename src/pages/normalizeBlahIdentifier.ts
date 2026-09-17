/** Match Blah's identifier namespace without rewriting email addresses. */
export default function normalizeBlahIdentifier(identifier: string) {
  const value = identifier.trim();
  return /^[0-9]+$/.test(value) && !value.startsWith('999') ? `+999${value}` : value;
}
