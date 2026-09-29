import type {AuthFlowContextValue} from '@/pages/authFlow';
import {continueLogin} from '@/pages/continueLogin';
import blah from '@config/blah';

/** Shared phone/Blah entry flow, using upstream response handling. */
export default async function requestLoginCode(
  flow: Pick<AuthFlowContextValue, 'managers' | 'navigate' | 'toIm'>,
  identifier: string,
  isActive: () => boolean
) {
  const result = await flow.managers.appAccountManager.sendLoginCode(identifier);
  if(!isActive()) return;
  if(result._ === 'auth.sentCodeSuccess' && result.authorization._ === 'auth.authorization') {
    await flow.toIm(); // The account manager has already persisted the authorization.
    return;
  }
  if(result._ !== 'auth.sentCode' && result._ !== 'auth.sentCodeSuccess') throw new Error(result._);
  if((blah?.discovery || blah?.home) && result._ === 'auth.sentCode' && result.phone_code_hash === 'diem' &&
    result.type._ === 'auth.sentCodeTypeApp' && result.type.length === 0) {
    flow.navigate({name: 'signUp', payload: {phone_number: identifier, phone_code_hash: result.phone_code_hash}});
    return;
  }
  await continueLogin({...result}, {...flow, phone_number: identifier});
}
