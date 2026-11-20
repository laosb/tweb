/**
 * Worker side of the widget's early start (earlyWorker.ts is the page side). The build
 * imports this into the main worker (vite.widget.config.ts). A newly started worker asks
 * its page whether this load has no stored key; if so it creates the permanent auth key
 * with the pinned DC while the client script is still downloading, and the client's first
 * key request takes it over (earlyAuthKey.ts).
 *
 * The page hands the worker its crypto workers only once the client runs. Until the
 * exchange settles, the stateless methods it needs run in this worker; every other
 * method, notably the stateful AES-CTR of WebSocket obfuscation, still goes to the
 * crypto workers.
 */
import type {CryptoMethods} from '@lib/crypto/crypto_methods';
import blah from '@config/blah';
import bytesModPow from '@helpers/bytes/bytesModPow';
import noop from '@helpers/noop';
import cryptoMessagePort from '@lib/crypto/cryptoMessagePort';
import {aesDecryptSync, aesEncryptSync} from '@lib/crypto/utils/aesIGE';
import factorizeBrentPollardPQ from '@lib/crypto/utils/factorize/BrentPollard';
import rsaEncrypt from '@lib/crypto/utils/rsa';
import sha1 from '@lib/crypto/utils/sha1';
import sha256 from '@lib/crypto/utils/sha256';
import {Authorizer} from '@lib/mtproto/authorizer';
import {DcConfigurator} from '@lib/mtproto/dcConfigurator';
import {TimeManager} from '@lib/mtproto/timeManager';
import {canStartEarlyAuthKey, EARLY_KEY_EXCHANGE_CHANNEL, offerEarlyAuthKey} from '@/widget/earlyAuthKey';

const STATELESS: Partial<CryptoMethods> = {
  'sha1': sha1,
  'sha256': sha256,
  'aes-encrypt': aesEncryptSync,
  'aes-decrypt': aesDecryptSync,
  'rsa-encrypt': rsaEncrypt,
  'factorize': factorizeBrentPollardPQ,
  'mod-pow': bytesModPow
};

/** Runs the stateless crypto methods in this worker until the returned function is called. */
export function computeStatelessCryptoHere() {
  type Invoke = {method: keyof CryptoMethods, args: any[]};
  const invoke = ({method, args}: Invoke): Promise<any> => {
    const fn = STATELESS[method] as (...args: any[]) => any;
    if(fn) return new Promise((resolve) => resolve(fn(...args)));
    // A listener makes the port answer in this realm; step aside for this one call.
    cryptoMessagePort.removeEventListener('invoke', invoke as any);
    try {
      return cryptoMessagePort.invokeCryptoNew({method, args} as any);
    } finally {
      cryptoMessagePort.addEventListener('invoke', invoke as any);
    }
  };
  cryptoMessagePort.addEventListener('invoke', invoke as any);
  return () => cryptoMessagePort.removeEventListener('invoke', invoke as any);
}

function exchange(dcId: number) {
  const stop = computeStatelessCryptoHere();
  const authorizer = new Authorizer({timeManager: new TimeManager(), dcConfigurator: new DcConfigurator()});
  // Not auth(): that is the client's request, which would take this exchange over.
  const promise = authorizer['_auth'](dcId);
  promise.then(stop, stop);
  promise.catch(noop);
  offerEarlyAuthKey(dcId, promise);
}

export function listenForEarlyKeyExchange() {
  if(!blah?.widget?.param || typeof(BroadcastChannel) === 'undefined') return;
  const channel = new BroadcastChannel(EARLY_KEY_EXCHANGE_CHANNEL);
  channel.onmessage = (event) => {
    if(event.data !== 'start') return;
    channel.close();
    if(canStartEarlyAuthKey()) exchange(blah.defaultDcId);
  };
  channel.postMessage('ask');
}

listenForEarlyKeyExchange();
