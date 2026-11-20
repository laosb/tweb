/**
 * Page side of the widget's early start. widget/index.html runs it (src/widget/early.ts)
 * before the client script has downloaded: it starts the MTProto SharedWorker with the
 * URL the client will ask for, and hands that very worker to the client's first
 * `new SharedWorker()` with the same URL and options, so the client attaches to it
 * instead of opening a second connection. When this load has a token and no stored key
 * for the pinned DC, it lets the worker begin the key exchange (earlyKeyExchange.ts).
 *
 * Only validated pins go into the worker URL, exactly as the client puts them there; the
 * token is only checked for its presence and never leaves the fragment.
 */
import MainWorkerURL from '@lib/mainWorker/index.worker.ts?worker&url';
import Modes, {getLoadedWorkerFlags, isPageOnlyFlag} from '@config/modes';
import IS_SHARED_WORKER_SUPPORTED from '@environment/sharedWorkerSupport';
import {CURRENT_ACCOUNT_QUERY_PARAM, MAX_ACCOUNTS} from '@lib/accounts/constants';
import {THREADED_WORKER_PROTOCOL_QUERY_PARAM, THREADED_WORKER_PROTOCOL_VERSION} from '@lib/threadedWorkerTypes';
import {readPageConfig, readToken, WIDGET_CONFIG_QUERY_PARAM, type WidgetConfig} from '@/widget/config';
import {EARLY_KEY_EXCHANGE_CHANNEL} from '@/widget/earlyAuthKey';

const WORKER_OPTIONS: WorkerOptions = {type: 'module'};

/**
 * The URL apiManagerProxy gives the main worker (makeWorkerURL plus the protocol
 * version), built without the client's modules. A difference only costs the handover.
 */
export function earlyWorkerURL(config: WidgetConfig, workerURL: string = MainWorkerURL) {
  const url = new URL(workerURL, location.href);
  new URLSearchParams(location.search).forEach((value, key) => {
    if(key === CURRENT_ACCOUNT_QUERY_PARAM || key === THREADED_WORKER_PROTOCOL_QUERY_PARAM || isPageOnlyFlag(key)) return;
    url.searchParams.set(key, value);
  });
  getLoadedWorkerFlags().forEach((flag) => url.searchParams.set(flag, '1'));
  url.searchParams.delete('swfix');
  url.searchParams.set(WIDGET_CONFIG_QUERY_PARAM, JSON.stringify(config));
  url.searchParams.set(THREADED_WORKER_PROTOCOL_QUERY_PARAM, '' + THREADED_WORKER_PROTOCOL_VERSION);
  return url;
}

/** Whether any account slot (or the legacy keys) holds a key for the DC; unreadable data counts as one. */
export function hasStoredAuthKey(dcId: number) {
  try {
    const key = `dc${dcId}_auth_key`;
    if(localStorage.getItem(key) !== null) return true;
    return Array.from({length: MAX_ACCOUNTS}, (_, index) => localStorage.getItem('account' + (index + 1))).some((stored) => {
      if(stored === null) return false;
      const data = JSON.parse(stored);
      return typeof(data) !== 'object' || !data || !!data[key];
    });
  } catch{
    return true;
  }
}

/** Hands `worker` to the first construction of the same shared worker. */
function offerToClient(worker: SharedWorker, url: string) {
  let offered = true;
  window.SharedWorker = new Proxy(window.SharedWorker, {
    construct(target, args: ConstructorParameters<typeof SharedWorker>) {
      const options = args[1];
      if(offered && String(args[0]) === url && typeof(options) === 'object' &&
        options.type === WORKER_OPTIONS.type && options.name === undefined && Object.keys(options).length === 1) {
        offered = false;
        return worker;
      }
      return new target(...args);
    }
  });
}

export function startEarlyWorker() {
  if(!IS_SHARED_WORKER_SUPPORTED || Modes.noWorker || import.meta.env.VITE_MTPROTO_SW) return;
  let config: WidgetConfig;
  try {
    config = readPageConfig();
  } catch{
    return; // the client shows the configuration error
  }

  const url = earlyWorkerURL(config);
  const worker = new SharedWorker(url, WORKER_OPTIONS);
  offerToClient(worker, url.href);

  // The worker asks once it has loaded, possibly after the client has taken it over; it
  // starts nothing once the client has asked for a key itself.
  if(!readToken(location.hash) || hasStoredAuthKey(config.dcId) || typeof(BroadcastChannel) === 'undefined') return;
  const channel = new BroadcastChannel(EARLY_KEY_EXCHANGE_CHANNEL);
  channel.onmessage = (event) => {
    if(event.data !== 'ask') return;
    channel.postMessage('start');
    channel.close();
  };
}
