import {describe, it, expect} from 'vitest';
import bytesToBase64 from '@helpers/bytes/bytesToBase64';

describe('bytesToBase64 padding', () => {
  it('preserves trailing zero bytes at every input length', () => {
    for(let length = 0; length < 100; length++) {
      const bytes = new Uint8Array(length);
      if(length) bytes[0] = 255;
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});
