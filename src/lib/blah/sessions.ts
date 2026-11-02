import type {ApiManager} from '@appManagers/apiManager';
import {stored, exclusively, storeEntries, serializeAccountStorage, assertAccountEpoch} from '@lib/blah/vault';
import {custodyKey, deleteSlotCustody} from '@lib/blah/custody';
import {identityAction, removeSessionDevices} from '@lib/blah/identity';
import pause from '@helpers/schedulers/pause';

export type SessionDevices = {_: 'blah.sessionDevices', sessions: SessionDevice[], retired: Uint8Array[]};
export type SessionDevice = {_: 'blah.sessionDevice', hash: string | number, device: Uint8Array};
declare module '@layer' {
  interface MethodDeclMap {
    'blah.getSessionDevices': {req: {}, res: SessionDevices}
  }
}

export async function resetIdentitySessions(slot: number, api: ApiManager, hash?: string | number) {
  if(await stored('slot:' + slot) === 'managed-account') return;
  const {identity} = await identityAction(slot, {action: 'inspect'});
  if(!identity.holder) throw new Error('Enter the recovery words on this device first.');
  const {sessions} = await api.invokeApi('blah.getSessionDevices');
  const devices = sessions.filter((entry) => hash === undefined ? String(entry.hash) !== '0' : String(entry.hash) === String(hash)).map((entry) => entry.device);
  if(devices.length) await removeSessionDevices(slot, devices);
}

export async function retrySessionReset<T>(reset: () => Promise<T>) {
  try { return await reset(); }
  catch(error) {
    if((error as {type?: string}).type !== 'DEVICE_STILL_LISTED') throw error;
    await pause(500);
    return reset();
  }
}

/** Ordinary logout retires the device; a later holder prune removes its certificate. */
export async function logoutIdentity(slot: number) {
  return serializeAccountStorage(() => exclusively(async() => {
    await assertAccountEpoch();
    if(await stored(custodyKey(slot))) {
      await deleteSlotCustody(slot);
      await storeEntries([['enrollment:' + slot, null]]);
    }
  }));
}

/** Keep publication and the ordinary reset retry in one worker-owned path. */
export async function resetBlahSessions<T>(slot: number, api: ApiManager, reset: () => Promise<T>, hash?: string | number) {
  await resetIdentitySessions(slot, api, hash);
  return retrySessionReset(reset);
}

/** Forgot-passcode logout removes account custody while retaining browser-owned chats. */
export function logoutAllIdentities() {
  return serializeAccountStorage(() => exclusively(async() => {
    await storeEntries([['account-relocation', null], ['account-epoch', (await stored<number>('account-epoch') || 0) + 1],
      ...[1, 2, 3, 4].flatMap((slot): [string, unknown][] =>
        [[custodyKey(slot), null], ['slot:' + slot, null], ['enrollment:' + slot, null], ['reset-slot:' + slot, null]])]);
    const {clearAccountCaches} = await import('@lib/blah/homeStorage');
    for(const slot of [1, 2, 3, 4]) await clearAccountCaches(slot);
  }));
}
