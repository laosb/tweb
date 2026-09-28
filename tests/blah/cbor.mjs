// Independent fixture encoder; production profile encoding/verification belongs to BlahDiem.
function head(major, input) {
  let n = BigInt(input);
  if(n < 24n) return [major * 32 + Number(n)];
  const size = n <= 255n ? 1 : n <= 65535n ? 2 : n <= 4294967295n ? 4 : 8;
  const bytes = new Array(size);
  for(let i = size - 1; i >= 0; --i) { bytes[i] = Number(n & 255n); n >>= 8n; }
  return [major * 32 + ({1: 24, 2: 25, 4: 26, 8: 27})[size], ...bytes];
}

export function cbor(value) {
  if(value === null) return [0xf6];
  if(typeof value === 'boolean') return [value ? 0xf5 : 0xf4];
  if(typeof value === 'number' || typeof value === 'bigint') return head(0, value);
  if(typeof value === 'string') { const bytes = [...new TextEncoder().encode(value)]; return [...head(3, bytes.length), ...bytes]; }
  if(value instanceof Uint8Array) return [...head(2, value.length), ...value];
  return [...head(4, value.length), ...value.flatMap(cbor)];
}
