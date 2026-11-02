import {describe, expect, it} from 'vitest';
import {onRtmpFetch, onRtmpLeftCall} from '@/widget/omitted/serviceWorkerRtmp';
import {assertWidgetServiceWorkerModules} from '../../scripts/widget-service-worker';

describe('widget service worker', () => {
  it('answers the intercepted RTMP fetch with a closed 404', async() => {
    let response: Response;
    onRtmpFetch({respondWith: (value: Response) => { response = value; }} as FetchEvent, 'call', '');
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(onRtmpLeftCall(['1', true])).toBeUndefined();
  });

  it('rejects RTMP dependencies and loss of ordinary media streaming', () => {
    const paths = ['index.service', 'stream', 'download', 'cache', 'clearOldCache'].map(name => `src/lib/serviceWorker/${name}.ts`);
    expect(() => assertWidgetServiceWorkerModules(paths)).not.toThrow();
    for(const path of ['src/lib/rtmp/isoboxer.js', 'src/lib/rtmp/fmp4.ts', 'src/lib/rtmp/opus.ts', 'src/vendor/opus/index.js']) {
      expect(() => assertWidgetServiceWorkerModules([...paths, path])).toThrow('RTMP codecs');
    }
    expect(() => assertWidgetServiceWorkerModules(paths.filter(path => !path.endsWith('/stream.ts')))).toThrow('ordinary stream');
  });
});
