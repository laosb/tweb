import '@lib/polyfill';
import type {MethodDeclMap} from '@layer';
import type {DcId, TrueDcId} from '@types';
import withTimeout from '@helpers/schedulers/withTimeout';
import {Authorizer} from '@lib/mtproto/authorizer';
import {DcConfigurator} from '@lib/mtproto/dcConfigurator';
import MTPNetworker from '@lib/mtproto/networker';
import {TimeManager} from '@lib/mtproto/timeManager';
import cryptoMessagePort from '@lib/crypto/cryptoMessagePort';
import {logger, LogTypes} from '@lib/logger';
import type {WidgetConfig} from '@/widget/config';

export interface WidgetRPC {
  call<K extends keyof MethodDeclMap>(method: K, params: MethodDeclMap[K]['req']): Promise<MethodDeclMap[K]['res']>;
  onUpdate?: (update: unknown) => void;
  destroy(): void;
}

let cryptoStarted = false;
function startCrypto() {
  if(cryptoStarted) return;
  cryptoStarted = true;
  // The standard worker offers a port for the full client's worker pool. This
  // iframe owns its worker directly and has no shared pool to forward it to.
  cryptoMessagePort.addEventListener('port', (_, __, event) => event.ports[0].close());
  const worker = new Worker(new URL('../../src/lib/crypto/crypto.worker.ts', import.meta.url), {type: 'module'});
  cryptoMessagePort.attachListenPort(worker);
  cryptoMessagePort.attachSendPort(worker);
}

/** A bare second client for the e2e support side: tweb's authorizer and networker
 * without app managers. Its page carries the widget's meta pins for @config/blah. */
export class WidgetTransport implements WidgetRPC {
  onUpdate?: (update: unknown) => void;
  private networker?: MTPNetworker;
  private connecting?: Promise<MTPNetworker>;
  private closed = false;
  private dc = new DcConfigurator();
  private time = new TimeManager();

  constructor(private config: WidgetConfig) {}

  private connect() {
    return this.connecting ??= this.open();
  }

  private async open() {
    if(this.closed) throw new Error('WIDGET_CLOSED');
    startCrypto();
    const dcId = this.config.dcId as DcId;
    const auth = await new Authorizer({timeManager: this.time, dcConfigurator: this.dc}).auth(dcId);
    if(this.closed) throw new Error('WIDGET_CLOSED');
    const networker = this.networker = new MTPNetworker({
      dcId,
      permAuthKey: auth.authKey,
      authKey: auth.authKey,
      serverSalt: auth.serverSalt,
      timeManager: this.time,
      isFileUpload: false,
      isFileDownload: false,
      getBaseDcId: async() => dcId as TrueDcId,
      getInitConnectionParams: () => ({
        id: this.config.apiId, deviceModel: 'Blah feedback widget', systemVersion: 'Web',
        version: '1.0', systemLangCode: 'en', langPack: '', langCode: 'en'
      }),
      createLogger: (prefix) => logger(prefix, LogTypes.None, true),
      isForcedStopped: () => this.closed,
      updatesProcessor: (update) => { if(!this.closed) this.onUpdate?.(update); }
    });
    networker.changeTransport(this.dc.chooseServer(dcId, 'client', 'websocket'));
    return networker;
  }

  async call<K extends keyof MethodDeclMap>(method: K, params: MethodDeclMap[K]['req']): Promise<MethodDeclMap[K]['res']> {
    if(this.closed) throw new Error('WIDGET_CLOSED');
    const timeout = Symbol('timeout');
    const result = await withTimeout(this.connect().then((networker) => {
      if(this.closed) throw new Error('WIDGET_CLOSED');
      return networker.wrapApiCall(method, params);
    }), 25_000, timeout);
    if(result === timeout) {
      this.destroy();
      throw new Error('WIDGET_TIMEOUT');
    }
    return result;
  }

  destroy() {
    this.closed = true;
    this.onUpdate = undefined;
    this.networker?.destroy();
    for(const connections of Object.values(this.dc.chosenServers)) {
      for(const dcs of Object.values(connections)) {
        for(const transports of Object.values(dcs)) transports.forEach((transport) => transport.destroy());
      }
    }
  }
}
