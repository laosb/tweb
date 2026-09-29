import {getBlahConfig} from '@config/blah';
import type MTPNetworker from '@lib/mtproto/networker';
import Schema from '@lib/mtproto/schema';
import {TLSerialization} from '@lib/mtproto/tl_utils';
import type {InvokeApiOptions} from '@types';
import {bindIdentity, numberIdentity, withIdentity} from '@lib/blah/identity';
import {diem} from '@lib/blah/wasm';

// Application schema extension: upstream generated Telegram schemas remain untouched.
Schema.API.constructors.push({id: 0xa5bf10f6 | 0, predicate: 'blah.identityChallenge', type: 'blah.IdentityChallenge',
  params: [{name: 'data', type: 'bytes'}, {name: 'expires_at', type: 'int'}]});
delete Schema.API.constructorsIndex;
Schema.API.methods.push(
  {id: 0xdceefd53 | 0, method: 'blah.requestIdentityChallenge', params: [{name: 'domain', type: 'string'}], type: 'blah.IdentityChallenge'},
  {id: 0x525b7c28, method: 'blah.invokeWithIdentityProof', params: [{name: 'proof', type: 'bytes'}, {name: 'query', type: '!X'}], type: 'X'}
);

export async function provenCall(slot: number, networker: MTPNetworker, method: string, params: unknown, options: InvokeApiOptions = {}) {
  const domain = await bindIdentity(slot);
  const challenge = await networker.wrapApiCall('blah.requestIdentityChallenge', {domain}, {ignoreErrors: true});
  // Sending the challenge first establishes/binds a PFS key on a cold networker.
  const binding = networker.getIdentityBinding();
  const query = new TLSerialization();
  const resultType = query.storeMethod(method, params);
  const queryBytes = query.getBytes(true);
  const proof = await withIdentity(slot, async(secret) => {
    const result = await diem('prove', secret, {challengeKind: 'invocation',
      challenge: challenge.data, approvedChallenge: challenge.data, expiresAt: challenge.expires_at,
      query: queryBytes, ...binding}, slot);
    return new Uint8Array(result.proof);
  });
  const current = networker.getIdentityBinding();
  if(current.keyID !== binding.keyID || current.sessionID !== binding.sessionID || networker.isStopped()) {
    throw new Error('MTProto session changed. Retry sign-in for a fresh device challenge.');
  }
  return networker.wrapApiCall('blah.invokeWithIdentityProof', {proof, query: (serializer: TLSerialization) => {
    serializer.storeRawBytes(queryBytes);
    return resultType;
  }}, {...options, ignoreErrors: true});
}

/** Keep single-use proof retries outside generic API migration/retry handling. */
export function invokeBlah(slot: number, networker: MTPNetworker, method: string, params: any, options: InvokeApiOptions) {
  if(networker.dcId !== 1) throw new Error('Wrong Blah home DC.');
  const proofRequired = method === 'auth.sendCode' || method === 'auth.signUp';
  if(method === 'auth.exportLoginToken' || method === 'auth.importLoginToken' || method.includes('PasskeyLogin')) {
    throw new Error('Blah requires browser identity sign-in.');
  }
  const promise = proofRequired ? provenCall(slot, networker, method, params, options) : networker.wrapApiCall(method, params, options);
  return promise.then(async(result) => {
    const authorization = result?._ === 'auth.sentCodeSuccess' ? result.authorization : result;
    if(authorization?._ === 'auth.authorization' && getBlahConfig(slot)?.home &&
      ['auth.sendCode', 'auth.signIn', 'auth.signUp', 'auth.checkPassword', 'auth.recoverPassword'].includes(method)) {
      await numberIdentity(slot, String(authorization.user.id));
      try {
        await provenCall(slot, networker, 'account.getAuthorizations', {});
      } catch(cause) {
        const error = cause as {type?: string, message?: string};
        throw new Error('Publish the latest profile (now containing your account number), then sign in again. ' + (error.type || error.message));
      }
    }
    return result;
  });
}
