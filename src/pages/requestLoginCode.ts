import type {AuthFlowContextValue} from '@/pages/authFlow';

/** Shared phone/Blah entry flow. Keep the complete sent-code payload for resume. */
export default async function requestLoginCode(
  flow: Pick<AuthFlowContextValue, 'managers' | 'navigate' | 'toIm'>,
  identifier: string,
  isActive: () => boolean
) {
  const result = await flow.managers.appAccountManager.sendLoginCode(identifier);
  if(!isActive()) return;

  if(result._ === 'auth.sentCode') {
    flow.navigate({name: 'authCode', payload: {...result, phone_number: identifier}});
  } else if(result._ === 'auth.sentCodeSuccess' && result.authorization._ === 'auth.authorization') {
    await flow.toIm();
  } else {
    // Payment-required/unsupported responses must not become an invalid code card.
    throw new Error(result._);
  }
}
