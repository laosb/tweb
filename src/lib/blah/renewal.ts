import type {IdentityInfo} from '@lib/blah/wasm';

export type RenewalPolicy = {profileDays: number, deviceDays: number, autoRenew: boolean};
export const DEFAULT_RENEWAL: RenewalPolicy = {profileDays: 180, deviceDays: 180, autoRenew: true};
export const DAY = 86400;

export function renewalPolicy(value?: RenewalPolicy): RenewalPolicy {
  const policy = value || DEFAULT_RENEWAL;
  if(!Number.isSafeInteger(policy.profileDays) || policy.profileDays < 1 ||
    !Number.isSafeInteger(policy.deviceDays) || policy.deviceDays < policy.profileDays ||
    !Number.isSafeInteger(policy.deviceDays * DAY) || policy.deviceDays * DAY > Number.MAX_SAFE_INTEGER - Date.now() / 1000 ||
    typeof policy.autoRenew !== 'boolean') {
    throw new Error('Use whole days, with device validity at least as long as profile validity.');
  }
  return {...policy};
}

/** Use signed validity intervals, including imported or shortened certificates. */
export function renewalDue(info: IdentityInfo, now = Date.now() / 1000) {
  return [info, ...info.devices].some(({notBefore, expiresAt}) => now >= notBefore + (expiresAt - notBefore) * .8);
}
