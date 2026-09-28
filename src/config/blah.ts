export type BlahConfig = {
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

export function getBlahDc(dcId: number) {
  if(blah?.home && dcId !== 1) throw new Error('Blah homes use DC1; numeric migration is not a home change');
  return blah?.dcs.find((dc) => dc.id === dcId) ?? blah?.dcs[0];
}
