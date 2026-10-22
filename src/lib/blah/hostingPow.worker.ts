import {proofSearch} from '@lib/blah/hostingPow';
import type {HostingPuzzle} from '@blahdiem/diem';

self.onmessage = ({data}: MessageEvent<{puzzle: HostingPuzzle, start: number, stride: number}>) => {
  try {
    const search = proofSearch(data.puzzle, data.start, data.stride);
    let reported = performance.now();
    while(true) {
      const result = search();
      const now = performance.now();
      if(result.nonce || now - reported >= 250) {
        self.postMessage(result);
        reported = now;
      }
      if(result.nonce) break;
    }
  } catch{
    self.postMessage({error: true});
  }
};
