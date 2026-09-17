export type BlahConfig = {
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

export function getBlahDc(dcId: number) {
  return blah?.dcs.find((dc) => dc.id === dcId) ?? blah?.dcs[0];
}
