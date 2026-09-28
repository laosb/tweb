export type BlahConfig = {
  discovery?: boolean,
  expiresAt?: string,
  profileDigest?: string,
  home?: {domain: string, identity: string, generation: string},
  defaultDcId: number,
  dcs: {
    id: number,
    url: string,
    rsaKey: {modulus: string, exponent: string}
  }[]
};

// Replaced at build time. Undefined in ordinary Telegram builds.
declare const __BLAH_CONFIG__: BlahConfig | undefined;
const blah = __BLAH_CONFIG__;
export default blah;

let ready: Promise<void>;

/** Each worker verifies the saved public profile before touching a home or transport. */
export function ensureBlahConfig(): Promise<void> {
  if(!blah?.discovery || blah.home) return Promise.resolve();
  return ready ??= import('@lib/blah/discovery').then(async({restoreDC}) => {
    Object.assign(blah, await restoreDC());
  }).catch((error) => { ready = undefined; throw error; });
}

export function getBlahDc(dcId: number) {
  if(blah?.discovery && (!blah.home || BigInt(blah.expiresAt) <= BigInt(Math.floor(Date.now() / 1000)))) {
    throw new Error('Connect to your DC to refresh its public profile.');
  }
  if(blah?.home && dcId !== 1) throw new Error('Blah homes use DC1; numeric migration is not a home change');
  return blah?.dcs.find((dc) => dc.id === dcId) ?? blah?.dcs[0];
}
