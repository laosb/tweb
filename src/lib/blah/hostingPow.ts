import {sha256} from '@noble/hashes/sha2.js';
import type {HostingPuzzle} from '@blahdiem/diem';

/** Public puzzle only. Each worker owns a disjoint big-endian counter stride. */
export function proofSearch(puzzle: HostingPuzzle, start: number, stride: number) {
  if(!Number.isInteger(puzzle.requiredBits) || puzzle.requiredBits < 0 || puzzle.requiredBits > 256 ||
    !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(stride) || stride < 1 ||
    puzzle.input.length > 4096 || puzzle.input.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error('Invalid proof puzzle');
  }
  const prefix = sha256.create().update(new Uint8Array(puzzle.input));
  const nonce = new Uint8Array(8);
  const view = new DataView(nonce.buffer);
  let counter = BigInt(start);
  const step = BigInt(stride);
  const maximumCounter = BigInt('0xffffffffffffffff');
  let attempts = 0;
  return (batch = 2048) => {
    for(let i = 0; i < batch; i++, counter += step) {
      if(counter > maximumCounter) throw new Error('Proof search exhausted');
      view.setBigUint64(0, counter);
      const hash = prefix.clone().update(nonce).digest();
      attempts++;
      const bytes = Math.floor(puzzle.requiredBits / 8);
      let valid = true;
      for(let j = 0; j < bytes; j++) if(hash[j]) { valid = false; break; }
      const bits = puzzle.requiredBits % 8;
      if(valid && (!bits || hash[bytes] >>> (8 - bits) === 0)) return {attempts, nonce: Array.from(nonce)};
    }
    return {attempts, nonce: undefined as number[] | undefined};
  };
}
