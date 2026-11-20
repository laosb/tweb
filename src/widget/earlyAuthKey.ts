/**
 * The support widget's first permanent auth key, which its worker may start exchanging
 * before the client script has loaded (see earlyKeyExchange.ts). The first key the client
 * asks for closes this: an exchange that has not started by then never does, and one in
 * flight is taken over instead of starting a second one.
 *
 * Imported by the upstream authorizer, so it must stay free of dependencies.
 */

/** The page answers a newly started worker's ask on it when this load has no stored key. */
export const EARLY_KEY_EXCHANGE_CHANNEL = 'blah-widget-early-key-exchange';

type ExchangedKey = {serverTime?: number, localTime?: number};

let offered: {dcId: number, promise: Promise<ExchangedKey>};
let closed = false;

export function canStartEarlyAuthKey() {
  return !closed && !offered;
}

export function offerEarlyAuthKey(dcId: number, promise: Promise<ExchangedKey>) {
  if(canStartEarlyAuthKey()) offered = {dcId, promise};
}

/**
 * The permanent key for `dcId`: the early exchange's when one was offered for that DC,
 * otherwise (or when it failed) `exchange()`. The early exchange kept its own clock;
 * `timeManager` takes the server time it learned.
 */
export function takeEarlyAuthKey<T extends ExchangedKey>(
  dcId: number,
  timeManager: {applyServerTime(serverTime: number, localTime?: number): unknown},
  exchange: () => Promise<T>
): Promise<T> {
  closed = true;
  const early = offered?.dcId === dcId ? offered.promise as Promise<T> : undefined;
  if(!early) return exchange();
  offered = undefined;
  return early.then((auth) => {
    timeManager.applyServerTime(auth.serverTime, auth.localTime);
    return auth;
  }, () => exchange());
}

/** For tests: forget any offered key and reopen. */
export function resetEarlyAuthKey() {
  offered = undefined;
  closed = false;
}
