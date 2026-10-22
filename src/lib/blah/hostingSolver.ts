import type {HostingPuzzle} from '@blahdiem/diem';

export type ProofWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;

/** Called from the UI thread, never from identity custody or the WASM queue. */
export function solveHostedProof(puzzle: HostingPuzzle, options: {
  signal: AbortSignal,
  onProgress?: (attempts: number) => void,
  workers?: number,
  workerFactory?: () => ProofWorker
}): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const workers: ProofWorker[] = [];
    const attempts: number[] = [];
    let done = false;
    const finish = (nonce?: number[], error?: string) => {
      if(done) return;
      done = true;
      options.signal.removeEventListener('abort', abort);
      workers.forEach((worker) => worker.terminate());
      if(nonce) resolve(nonce);
      else reject({type: error || 'BlahHostingCancelled'});
    };
    const abort = () => finish();
    if(options.signal.aborted) { abort(); return; }
    options.signal.addEventListener('abort', abort, {once: true});
    const count = Math.max(1, Math.min(4, options.workers ?? ((navigator.hardwareConcurrency || 2) - 1)));
    try {
      for(let i = 0; i < count; i++) {
        const worker = options.workerFactory ? options.workerFactory() :
          new Worker(new URL('./hostingPow.worker.ts', import.meta.url), {type: 'module'});
        workers.push(worker);
        worker.onmessage = ({data}) => {
          if(done) return;
          attempts[i] = data.attempts || 0;
          options.onProgress?.(attempts.reduce((sum, value) => sum + value, 0));
          if(data.nonce) finish(data.nonce);
          else if(data.error) finish(undefined, 'BlahHostingProofFailed');
        };
        worker.onerror = () => finish(undefined, 'BlahHostingProofFailed');
        worker.postMessage({puzzle, start: i, stride: count});
      }
    } catch{ finish(undefined, 'BlahHostingProofFailed'); }
  });
}
