/**
 * Page side of the widget's early start. widget/index.html runs it (src/widget/early.ts)
 * before the client script has downloaded: it starts the MTProto worker with the URL the
 * client will ask for, and hands that very worker to the client's first construction of
 * it with the same URL and options, so the client attaches to it instead of opening a
 * second connection or worker. When this load has a token and no stored key
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

// The kinds apiManagerProxy listens for on its worker.
const BUFFERED_EVENTS = ['message', 'error'] as const;

/**
 * A dedicated worker's events reach only the listeners it has when they fire, and the
 * client attaches its own only once it has loaded. Until then they are kept, and each
 * kind is dispatched again, in order, as soon as the client listens for it: in a
 * microtask, so before any later event, which the client then receives directly.
 */
function bufferUntilListened(worker: Worker) {
  const pending = new Map<string, {buffered: Event[], keep: (event: Event) => void}>();
  for(const type of BUFFERED_EVENTS) {
    const buffered: Event[] = [];
    const keep = (event: Event) => {
      buffered.push(event);
    };
    worker.addEventListener(type, keep);
    pending.set(type, {buffered, keep});
  }

  const flush = (type: string) => {
    const kept = pending.get(type);
    if(!kept) return;
    pending.delete(type);
    worker.removeEventListener(type, kept.keep);
    if(type === 'message' && Object.getOwnPropertyDescriptor(worker, 'onmessage')?.set === setOnMessage) delete (worker as any).onmessage;
    if(!pending.size) delete (worker as any).addEventListener;
    queueMicrotask(() => kept.buffered.forEach((event) => worker.dispatchEvent(event)));
  };

  // Instance overrides, removed again once every kind has a listener.
  worker.addEventListener = function(this: Worker, type: string, ...rest: [any, any?]) {
    EventTarget.prototype.addEventListener.call(this, type, ...rest);
    flush(type);
  };
  function setOnMessage(listener: Worker['onmessage']) {
    delete (worker as any).onmessage;
    worker.onmessage = listener;
    flush('message');
  }
  Object.defineProperty(worker, 'onmessage', {configurable: true, set: setOnMessage, get: () => null});
}

/** Hands `worker` to the first construction, by the client, of the same worker with the same options. */
function offerToClient<T extends typeof SharedWorker | typeof Worker>(name: 'SharedWorker' | 'Worker', worker: InstanceType<T>, url: string) {
  let offered = true;
  (window as any)[name] = new Proxy(window[name], {
    construct(target, args: ConstructorParameters<T>) {
      const options = args[1];
      if(offered && String(args[0]) === url && typeof(options) === 'object' &&
        options.type === WORKER_OPTIONS.type && options.name === undefined && Object.keys(options).length === 1) {
        offered = false;
        return worker;
      }
      return new (target as any)(...args);
    }
  });
}

/**
 * Starts the worker apiManagerProxy.registerWorker would: shared where the client uses a
 * shared one, otherwise dedicated (Safari, whose shared workers cannot read Blobs from a
 * cross-origin iframe, and `noSharedWorker`).
 */
export function startEarlyWorker() {
  if(typeof(Worker) === 'undefined' || Modes.noWorker || import.meta.env.VITE_MTPROTO_SW) return;
  let config: WidgetConfig;
  try {
    config = readPageConfig();
  } catch{
    return; // the client shows the configuration error
  }

  const url = earlyWorkerURL(config);
  if(IS_SHARED_WORKER_SUPPORTED) {
    offerToClient('SharedWorker', new SharedWorker(url, WORKER_OPTIONS), url.href);
  } else {
    const worker = new Worker(url, WORKER_OPTIONS);
    bufferUntilListened(worker);
    offerToClient('Worker', worker, url.href);
  }

  // A worker asks once it has loaded, possibly after the client has taken it over; it
  // starts nothing once the client has asked for a key itself. Dedicated workers of other
  // tabs ask here too: each answer reflects the storage at that moment.
  if(!readToken(location.hash) || typeof(BroadcastChannel) === 'undefined') return;
  const dcId = config.dcId;
  if(hasStoredAuthKey(dcId)) return;
  const channel = new BroadcastChannel(EARLY_KEY_EXCHANGE_CHANNEL);
  channel.onmessage = (event) => {
    if(event.data !== 'ask') return;
    if(hasStoredAuthKey(dcId)) channel.close();
    else channel.postMessage('start');
  };
}
