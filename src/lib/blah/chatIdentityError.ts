import I18n, {LangPackKey} from '@lib/langPack';

export function chatIdentityError(cause: unknown, claiming = false) {
  const error = cause as {type?: string, message?: string};
  const code = error.type || error.message;
  const keys: Record<string, LangPackKey> = {
    IDENTITY_PROOF_INVALID: 'BlahChatProofInvalid', IDENTITY_PROOF_REQUIRED: 'BlahChatProofRequired',
    IDENTITY_CHALLENGE_INVALID: 'BlahChatChallengeInvalid', CHAT_IDENTITY_REQUIRED: 'BlahChatProofRequired',
    CHAT_ADMIN_REQUIRED: 'BlahChatCreatorRequired', FEDERATION_NOT_CONFIGURED: 'BlahChatFederationUnavailable',
    BLAH_PROFILE_NOT_PUBLISHED: 'BlahProfileNeedsPublication', BLAH_PUBLICATION_CHECK_FAILED: 'BlahPublicationCheckFailed'
  };
  if(claiming) {
    keys.CHAT_ADMIN_REQUIRED = 'BlahChatClaimDenied';
    for(const code of ['USER_NOT_PARTICIPANT', 'USER_CHANNELS_TOO_MUCH', 'CHANNEL_PRIVATE', 'CHANNEL_INVALID', 'CHANNEL_PUBLIC_GROUP_NA']) {
      keys[code] = 'BlahChatClaimJoinFirst';
    }
  }
  if(/^FLOOD_WAIT_\d+$/.test(code)) return I18n.format('BlahChatFloodWait', true, [code.slice(11)]);
  return keys[code] ? I18n.format(keys[code], true) : code || I18n.format('Error.AnError', true);
}
