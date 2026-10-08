import blah from '@config/blah';
import {CURRENT_ACCOUNT_QUERY_PARAM} from '@lib/accounts/constants';
import {THREADED_WORKER_PROTOCOL_QUERY_PARAM} from '@lib/threadedWorkerTypes';
import {WIDGET_CONFIG_QUERY_PARAM} from '@/widget/config';

export function makeWorkerURL(url: string | URL) {
  if(!(url instanceof URL)) {
    url = new URL(url + '', location.href);
  }

  if(location.search && url.protocol !== 'blob:') {
    const params = new URLSearchParams(location.search);
    params.forEach((value, key) => {
      if(key === CURRENT_ACCOUNT_QUERY_PARAM || key === THREADED_WORKER_PROTOCOL_QUERY_PARAM) return;
      (url as URL).searchParams.set(key, value);
    });
  }

  // exclude useless params
  (url as URL).searchParams.delete('swfix');

  // Only the widget's own document pins its DC; never forward one from the page URL.
  if(blah?.widget && url.protocol !== 'blob:') {
    if(blah.widget.param) url.searchParams.set(WIDGET_CONFIG_QUERY_PARAM, blah.widget.param);
    else url.searchParams.delete(WIDGET_CONFIG_QUERY_PARAM);
  }

  return url;
}

export default function setWorkerProxy() {
  // * hook worker constructor to set search parameters (test, debug, etc)
  const workerHandler = {
    construct(target: any, args: any) {
      args[0] = makeWorkerURL(args[0]);
      return new target(...args);
    }
  };

  [
    typeof(Worker) !== 'undefined' && Worker,
    typeof(SharedWorker) !== 'undefined' && SharedWorker
  ].filter(Boolean).forEach((w) => {
    window[w.name as any] = new Proxy(w, workerHandler);
  });
}

setWorkerProxy();
