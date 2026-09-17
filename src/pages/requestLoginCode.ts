import type {AuthFlowContextValue} from '@/pages/authFlow';
import {continueLogin} from '@/pages/continueLogin';

/** Shared phone/Blah entry flow, using upstream response handling. */
export default async function requestLoginCode(
  flow: Pick<AuthFlowContextValue, 'managers' | 'navigate' | 'toIm'>,
  identifier: string,
  isActive: () => boolean,
  ready?: Promise<unknown>
) {
  const result = await flow.managers.appAccountManager.sendCode(identifier);
  if(ready) await ready;
  if(!isActive()) return;
  await continueLogin(result, {...flow, phone_number: identifier});
}
