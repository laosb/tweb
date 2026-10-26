import I18n, {LangPackKey} from '@lib/langPack';

export function deviceLinkMessage(error: unknown) {
  const code = (error as {type?: string, message?: string})?.type || (error as Error)?.message;
  if(code?.startsWith('Profile publication failed:')) return I18n.format('BlahLinkPublicationFailed', true);
  const keys: Record<string, LangPackKey> = {
    BLAH_LINK_REQUIRED: 'BlahLinkRequired',
    unsupportedAlgorithm: 'BlahLinkAlgorithm',
    BLAH_LINK_ALGORITHM: 'BlahLinkAlgorithm',
    BLAH_LINK_APPROVAL_REQUIRED: 'BlahLinkApprovalRequired',
    BLAH_LINK_IDENTITY_EXISTS: 'BlahLinkIdentityExists',
    BLAH_LINK_PROFILE_CHANGED: 'BlahLinkProfileChanged',
    DEVICE_LINK_PROFILE_STALE: 'BlahLinkProfileStale',
    LOGIN_TOKEN_EXPIRED: 'BlahLinkExpired',
    LOGIN_TOKEN_INVALID: 'BlahLinkExpired',
    BLAH_LINK_CANCELLED: 'BlahLinkExpired'
  };
  return I18n.format(keys[code] || 'BlahLinkFailed', true);
}
