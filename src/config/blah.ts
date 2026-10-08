import {widgetBlahConfig} from '@/widget/config';

export type BlahConfig = {
  discovery?: boolean,
  expiresAt?: string,
  profileDigest?: string,
  home?: {domain: string, identity: string, generation: string},
  /** The support widget build: pins from its own document, `param` absent when they are invalid. */
  widget?: {param?: string},
  /** Application credentials that are not built in, i.e. the widget's. */
  app?: {id: number, hash: string},
  defaultDcId: number,
  dcs: {
    id: number,
    url: string,
    rsaKey: {modulus: string, exponent: string}
  }[]
};

// Replaced at build time. Undefined in ordinary Telegram builds.
declare const __BLAH_CONFIG__: BlahConfig | undefined;
declare const __BLAH_WIDGET__: boolean;
const blah = __BLAH_WIDGET__ ? widgetBlahConfig() : __BLAH_CONFIG__;
export default blah;

// Several accounts can share a worker, but never a discovery configuration.
const accounts = new Map<number, BlahConfig>();
const ready = new Map<number, Promise<void>>();
export const blahStartupErrors = new Map<number, string>();

export function getBlahConfig(slot = 1): BlahConfig | undefined {
  return blah?.discovery ? accounts.get(slot) : blah;
}

export function setBlahConfig(slot: number, config: BlahConfig) {
  accounts.set(slot, config);
}

/** Each worker verifies the saved public profile before touching a home or transport. */
export function ensureBlahConfig(slot = 1): Promise<void> {
  if(!blah?.discovery || accounts.has(slot)) return Promise.resolve();
  let pending = ready.get(slot);
  if(!pending) {
    pending = import('@lib/blah/discovery').then(async({restoreDC, savedDC}) => {
      // A fresh slot renders sign-in without dialing. Selection reloads into a
      // worker keyed by the new profile set, before any transport can be reused.
      if(!await savedDC(slot)) return new Promise<void>(() => {});
      setBlahConfig(slot, await restoreDC(slot));
    }).catch((error) => { ready.delete(slot); throw error; });
    ready.set(slot, pending);
  }
  return pending;
}

export function getBlahDc(dcId: number, slot = 1) {
  const config = getBlahConfig(slot);
  if(blah?.discovery && (!config?.home || BigInt(config.expiresAt) <= BigInt(Math.floor(Date.now() / 1000)))) {
    throw new Error('Connect to your DC to refresh its public profile.');
  }
  if(config?.home && dcId !== 1) throw new Error('Blah homes use DC1; numeric migration is not a home change');
  // The widget dials only the pinned DC; a missing pin must never fall back to Telegram.
  if(config?.widget) {
    const dc = config.dcs.find((dc) => dc.id === dcId);
    if(!dc) throw new Error('WIDGET_DC_MISMATCH');
    return dc;
  }
  return config?.dcs.find((dc) => dc.id === dcId) ?? config?.dcs[0];
}
