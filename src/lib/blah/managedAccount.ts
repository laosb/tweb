import type {AuthAuthorization} from '@layer';

/** Managed-account tokens share a bot token's `<id>:<secret>` shape. */
export function isManagedAccountToken(token: string) {
  return /^[1-9]\d*:[A-Za-z0-9_-]{16,512}$/.test(token);
}

/** A bot presents the same kind of token but cannot use a user client. */
export function managedAccountUser(authorization: AuthAuthorization) {
  if(authorization._ !== 'auth.authorization' || authorization.user._ !== 'user' || authorization.user.pFlags?.bot) return;
  return authorization.user;
}
