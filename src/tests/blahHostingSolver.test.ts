import {describe, expect, it, vi} from 'vitest';
import {sha256} from '@noble/hashes/sha2.js';
import {proofSearch} from '@lib/blah/hostingPow';
import {solveHostedProof, ProofWorker} from '@lib/blah/hostingSolver';

const puzzle = {label: 'alice', input: [...new TextEncoder().encode('diem-profile-hosting-pow-v1\0id.example\0alice\0'),
  ...Array.from({length: 32}, (_, i) => i + 1)], requiredBits: 12};

function factory(workers: ProofWorker[]) {
  return () => {
    let timer: ReturnType<typeof setTimeout>;
    const worker: ProofWorker = {onmessage: undefined, onerror: undefined,
      terminate: vi.fn(() => clearTimeout(timer)),
      postMessage: ({puzzle, start, stride}) => {
        const search = proofSearch(puzzle, start, stride);
        const batch = () => {
          const result = search(128);
          worker.onmessage.call(undefined, {data: result} as MessageEvent);
          if(!result.nonce) timer = setTimeout(batch, 0);
        };
        timer = setTimeout(batch, 0);
      }};
    workers.push(worker);
    return worker;
  };
}

describe('hosted proof worker pool', () => {
  it('matches the first big-endian counter in the golden vector', async() => {
    const workers: ProofWorker[] = [];
    const progress = vi.fn();
    const nonce = await solveHostedProof(puzzle, {signal: new AbortController().signal,
      workers: 1, workerFactory: factory(workers), onProgress: progress});
    expect(new DataView(new Uint8Array(nonce).buffer).getBigUint64(0)).toBe(BigInt(8759));
    expect(progress).toHaveBeenCalled();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
  it('finds a valid nonce with strided workers and terminates the entire pool', async() => {
    const workers: ProofWorker[] = [];
    const nonce = await solveHostedProof(puzzle, {signal: new AbortController().signal, workers: 3, workerFactory: factory(workers)});
    const hash = sha256(new Uint8Array([...puzzle.input, ...nonce]));
    expect(hash[0]).toBe(0);
    expect(hash[1] >>> 4).toBe(0);
    expect(workers).toHaveLength(3);
    workers.forEach((worker) => expect(worker.terminate).toHaveBeenCalledOnce());
  });
  it('cancels all workers and does not start an already cancelled search', async() => {
    const workers: ProofWorker[] = [];
    const controller = new AbortController();
    const result = solveHostedProof({...puzzle, requiredBits: 256}, {signal: controller.signal, workers: 4, workerFactory: factory(workers)});
    controller.abort();
    await expect(result).rejects.toMatchObject({type: 'BlahHostingCancelled'});
    workers.forEach((worker) => expect(worker.terminate).toHaveBeenCalledOnce());
    const create = vi.fn();
    await expect(solveHostedProof(puzzle, {signal: controller.signal, workerFactory: create})).rejects.toMatchObject({type: 'BlahHostingCancelled'});
    expect(create).not.toHaveBeenCalled();
  });
});
