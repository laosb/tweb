import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {WidgetConfig} from '@/widget/config';
import {EARLY_KEY_EXCHANGE_CHANNEL, offerEarlyAuthKey, resetEarlyAuthKey, takeEarlyAuthKey} from '@/widget/earlyAuthKey';

const config: WidgetConfig = {
  dcId: 2, url: 'wss://support.example/apiws',
  rsaKey: {modulus: 'ab'.repeat(256), exponent: '010001'},
  apiId: 12345, apiHash: 'ab'.repeat(16)
};
const TOKEN = '#token=' + encodeURIComponent('123:abcdefghijklmnopqrstuvwxyz_0123456789');

class FakeSharedWorker {
  static created: FakeSharedWorker[] = [];
  port = {};
  constructor(public url: string | URL, public options?: WorkerOptions) {
    FakeSharedWorker.created.push(this);
  }
}

class FakeWorker extends EventTarget {
  static created: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public url: string | URL, public options?: WorkerOptions) {
    super();
    FakeWorker.created.push(this);
    this.addEventListener('message', (event) => this.onmessage?.(event as MessageEvent));
  }
}

function setMeta(value: WidgetConfig) {
  document.head.innerHTML = Object.entries({
    'dc-id': value.dcId, 'dc-url': value.url, 'rsa-modulus': value.rsaKey.modulus,
    'rsa-exponent': value.rsaKey.exponent, 'api-id': value.apiId, 'api-hash': value.apiHash
  }).map(([name, item]) => `<meta name="blah-widget-${name}" content="${item}">`).join('');
}

/** Loads the page side as widget/index.html does, before the client. */
async function startPage(search = '?lang=zh_Hans', hash = TOKEN, shared = true) {
  history.replaceState(null, '', '/' + search + hash);
  vi.resetModules();
  vi.stubGlobal('__BLAH_WIDGET__', true);
  vi.stubGlobal('SharedWorker', shared ? FakeSharedWorker : undefined);
  vi.stubGlobal('Worker', FakeWorker);
  const {startEarlyWorker} = await import('@/widget/earlyWorker');
  startEarlyWorker();
}

/** What the worker hears back when it asks, within a few macrotasks. */
async function askAsWorker() {
  const channel = new BroadcastChannel(EARLY_KEY_EXCHANGE_CHANNEL);
  const answers: unknown[] = [];
  channel.onmessage = (event) => answers.push(event.data);
  channel.postMessage('ask');
  await new Promise((resolve) => setTimeout(resolve, 50));
  channel.close();
  return answers;
}

beforeEach(() => {
  FakeSharedWorker.created = [];
  FakeWorker.created = [];
  localStorage.clear();
  resetEarlyAuthKey();
  setMeta(config);
});

afterEach(async() => {
  // Leave no page listening for the next test: a page stops once a key is stored.
  localStorage.setItem('dc2_auth_key', '1');
  await askAsWorker();
  vi.unstubAllGlobals();
  vi.doUnmock('@config/blah');
  vi.restoreAllMocks();
  document.head.innerHTML = '';
  history.replaceState(null, '', '/');
});

it('starts the main worker at the URL the client will ask for, and hands the client that worker', async() => {
  await startPage('?lang=zh_Hans&debug=1&account=2&rtl=1&blahWidget=forged');
  expect(FakeSharedWorker.created).toHaveLength(1);
  const [early] = FakeSharedWorker.created;
  expect(early.options).toEqual({type: 'module'});

  // The client's own URL, as apiManagerProxy.registerWorker builds it.
  const {makeWorkerURL} = await import('@helpers/setWorkerProxy');
  const {THREADED_WORKER_PROTOCOL_QUERY_PARAM, THREADED_WORKER_PROTOCOL_VERSION} = await import('@lib/threadedWorkerTypes');
  const {default: MainWorkerURL} = await import('@lib/mainWorker/index.worker.ts?worker&url');
  const url = makeWorkerURL(MainWorkerURL);
  url.searchParams.set(THREADED_WORKER_PROTOCOL_QUERY_PARAM, THREADED_WORKER_PROTOCOL_VERSION + '');
  expect(String(early.url)).toBe(url.href);
  expect(JSON.parse(url.searchParams.get('blahWidget'))).toEqual({...config, lang: 'zh-hans'});
  expect(url.href).not.toContain('token');

  expect(new SharedWorker(url, {type: 'module'})).toBe(early);
  // Only once, and never for another worker or other options.
  expect(new SharedWorker(url, {type: 'module'})).not.toBe(early);
  expect(new SharedWorker(url, {type: 'module', name: 'other'})).not.toBe(early);
  expect(FakeSharedWorker.created).toHaveLength(3);
});

/** The client's URL for its main worker, as apiManagerProxy.registerWorker builds it. */
async function clientWorkerURL() {
  const {makeWorkerURL} = await import('@helpers/setWorkerProxy');
  const {THREADED_WORKER_PROTOCOL_QUERY_PARAM, THREADED_WORKER_PROTOCOL_VERSION} = await import('@lib/threadedWorkerTypes');
  const {default: MainWorkerURL} = await import('@lib/mainWorker/index.worker.ts?worker&url');
  const url = makeWorkerURL(MainWorkerURL);
  url.searchParams.set(THREADED_WORKER_PROTOCOL_QUERY_PARAM, THREADED_WORKER_PROTOCOL_VERSION + '');
  return url;
}

const message = (data: string) => new MessageEvent('message', {data});

it('starts a dedicated main worker without shared workers and replays what it said before the client listened', async() => {
  await startPage('?lang=zh_Hans&noSharedWorker=1', TOKEN, false);
  expect(FakeSharedWorker.created).toHaveLength(0);
  expect(FakeWorker.created).toHaveLength(1);
  const [early] = FakeWorker.created;
  const url = await clientWorkerURL();
  expect(String(early.url)).toBe(url.href);
  expect(early.options).toEqual({type: 'module'});

  early.dispatchEvent(message('first'));
  early.dispatchEvent(new Event('error'));
  early.dispatchEvent(message('second'));

  // The crypto and lottie workers are the client's own.
  const crypto = new Worker('https://support.example/crypto.worker.js', {type: 'module'});
  expect(crypto).not.toBe(early);
  expect(crypto.addEventListener).toBe(EventTarget.prototype.addEventListener);

  const worker = new Worker(url, {type: 'module'});
  expect(worker).toBe(early);
  expect(new Worker(url, {type: 'module'})).not.toBe(early);
  const received: string[] = [];
  worker.addEventListener('message', (event) => received.push(event.data));
  expect(received).toEqual([]);
  await Promise.resolve();
  expect(received).toEqual(['first', 'second']);
  early.dispatchEvent(message('third'));
  expect(received).toEqual(['first', 'second', 'third']);

  const errors: Event[] = [];
  worker.addEventListener('error', (event) => errors.push(event));
  await Promise.resolve();
  expect(errors).toHaveLength(1);
  // Every kind is listened for: the worker is an ordinary one again.
  expect(Object.prototype.hasOwnProperty.call(worker, 'addEventListener')).toBe(false);
  early.dispatchEvent(message('fourth'));
  expect(received).toEqual(['first', 'second', 'third', 'fourth']);
});

it('replays to an onmessage handler too', async() => {
  await startPage('', TOKEN, false);
  const [early] = FakeWorker.created;
  early.dispatchEvent(message('first'));
  const worker = new Worker(await clientWorkerURL(), {type: 'module'});
  expect(worker).toBe(early);
  const received: string[] = [];
  worker.onmessage = (event) => received.push(event.data);
  await Promise.resolve();
  early.dispatchEvent(message('second'));
  expect(received).toEqual(['first', 'second']);
});

it('leaves a different worker URL to the client', async() => {
  await startPage();
  const [early] = FakeSharedWorker.created;
  const other = new SharedWorker(String(early.url).replace('lang', 'other'), {type: 'module'});
  expect(other).not.toBe(early);
  expect(new SharedWorker(early.url, {type: 'module'})).toBe(early);
});

it('starts nothing for invalid pins or without shared workers', async() => {
  setMeta({...config, url: 'ws://support.example/apiws'});
  await startPage();
  expect(FakeSharedWorker.created).toHaveLength(0);
  expect(await askAsWorker()).toEqual([]);

  setMeta(config);
  history.replaceState(null, '', '/');
  vi.resetModules();
  vi.stubGlobal('__BLAH_WIDGET__', true);
  vi.stubGlobal('SharedWorker', undefined);
  const {startEarlyWorker} = await import('@/widget/earlyWorker');
  startEarlyWorker();
  expect(FakeSharedWorker.created).toHaveLength(0);
});

it('lets the worker exchange a key only for a token and no stored key', async() => {
  await startPage();
  expect(await askAsWorker()).toEqual(['start']);
  // Another tab's dedicated worker asks too; the answer follows the storage of the moment.
  expect(await askAsWorker()).toEqual(['start']);
  localStorage.setItem('account1', JSON.stringify({dc2_auth_key: 'ab'.repeat(256)}));
  expect(await askAsWorker()).toEqual([]);
  localStorage.clear();
  expect(await askAsWorker()).toEqual([]);

  await startPage('', '');
  expect(await askAsWorker()).toEqual([]);

  localStorage.setItem('account3', JSON.stringify({dc2_auth_key: 'ab'.repeat(256)}));
  await startPage();
  expect(await askAsWorker()).toEqual([]);

  localStorage.setItem('account3', JSON.stringify({dc1_auth_key: 'ab'.repeat(256)}));
  await startPage();
  expect(await askAsWorker()).toEqual(['start']);

  // Unreadable (encrypted) account data counts as a stored key.
  localStorage.setItem('account1', JSON.stringify('encrypted'));
  await startPage();
  expect(await askAsWorker()).toEqual([]);
});

it('hands the client the early key once, with its server time, and falls back on failure', async() => {
  const timeManager = {applyServerTime: vi.fn()};
  const exchange = vi.fn(async() => ({serverTime: 2}));
  offerEarlyAuthKey(2, Promise.resolve({serverTime: 100, localTime: 5000}));
  expect(await takeEarlyAuthKey(2, timeManager, exchange)).toEqual({serverTime: 100, localTime: 5000});
  expect(timeManager.applyServerTime).toHaveBeenCalledWith(100, 5000);
  expect(exchange).not.toHaveBeenCalled();
  expect(await takeEarlyAuthKey(2, timeManager, exchange)).toEqual({serverTime: 2});

  // Closed by the client's first request: nothing is offered after it.
  offerEarlyAuthKey(2, Promise.resolve({serverTime: 100}));
  expect(await takeEarlyAuthKey(2, timeManager, exchange)).toEqual({serverTime: 2});

  resetEarlyAuthKey();
  offerEarlyAuthKey(2, Promise.reject(new Error('NETWORK')));
  expect(await takeEarlyAuthKey(2, timeManager, exchange)).toEqual({serverTime: 2});

  resetEarlyAuthKey();
  offerEarlyAuthKey(2, Promise.resolve({serverTime: 100}));
  expect(await takeEarlyAuthKey(4, timeManager, exchange)).toEqual({serverTime: 2});
});

it('takes the early key in the authorizer instead of exchanging another', async() => {
  const {Authorizer} = await import('@lib/mtproto/authorizer');
  const {offerEarlyAuthKey} = await import('@/widget/earlyAuthKey');
  const authorizer = new Authorizer({timeManager: {applyServerTime: vi.fn()} as any, dcConfigurator: {accountNumber: 1} as any});
  const own = vi.spyOn(authorizer as any, '_auth').mockResolvedValue({});
  const early = {authKey: 'early', serverTime: 1};
  offerEarlyAuthKey(2, Promise.resolve(early));
  expect(await authorizer.auth(2)).toBe(early);
  expect(own).not.toHaveBeenCalled();
});

it('exchanges the key in a new worker once its page answers, before the client asks', async() => {
  vi.resetModules();
  vi.doMock('@config/blah', async(importOriginal) => ({...await importOriginal<object>(), default: {widget: {param: 'pins'}, defaultDcId: 2, dcs: []}}));
  const {Authorizer} = await import('@lib/mtproto/authorizer');
  const key = {authKey: 'early', serverTime: 1};
  const exchange = vi.spyOn(Authorizer.prototype as any, '_auth').mockResolvedValue(key);
  const page = new BroadcastChannel(EARLY_KEY_EXCHANGE_CHANNEL);
  page.onmessage = (event) => event.data === 'ask' && page.postMessage('start');
  await import('@/widget/earlyKeyExchange');
  await new Promise((resolve) => setTimeout(resolve, 50));
  page.close();
  expect(exchange).toHaveBeenCalledWith(2);
  const {takeEarlyAuthKey} = await import('@/widget/earlyAuthKey');
  const own = vi.fn();
  expect(await takeEarlyAuthKey(2, {applyServerTime: vi.fn()}, own)).toBe(key);
  expect(own).not.toHaveBeenCalled();
});

it('runs the exchange\'s stateless crypto in the worker and leaves the rest to the crypto workers', async() => {
  const {default: cryptoMessagePort} = await import('@lib/crypto/cryptoMessagePort');
  const {computeStatelessCryptoHere} = await import('@/widget/earlyKeyExchange');
  const {default: sha256} = await import('@lib/crypto/utils/sha256');
  const send = vi.spyOn(cryptoMessagePort, 'invoke').mockReturnValue(new Promise(() => {}));
  const stop = computeStatelessCryptoHere();
  const bytes = new Uint8Array([1, 2, 3]);
  expect(await cryptoMessagePort.invokeCrypto('sha256', bytes)).toEqual(await sha256(bytes));
  expect(send).not.toHaveBeenCalled();
  // AES-CTR keeps its state in the crypto worker that prepared it.
  void cryptoMessagePort.invokeCrypto('aes-ctr-destroy', 1);
  expect(send).toHaveBeenCalledOnce();
  expect(await cryptoMessagePort.invokeCrypto('sha256', bytes)).toEqual(await sha256(bytes));
  expect(send).toHaveBeenCalledOnce();
  stop();
  void cryptoMessagePort.invokeCrypto('sha256', bytes);
  expect(send).toHaveBeenCalledTimes(2);
});
