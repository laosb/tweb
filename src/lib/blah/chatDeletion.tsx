import {toastNew} from '@components/toast';
import type rootScope from '@lib/rootScope';

export default async function deleteChatWithIdentity(...args: Parameters<typeof tryDeleteChatWithIdentity>): Promise<true> {
  if(!await tryDeleteChatWithIdentity(...args)) throw new Error('BLAH_CHAT_CANCELLED');
  return true;
}

/** Local chat custody signs automatically; missing custody is restored from recovery words. */
export async function tryDeleteChatWithIdentity(managers: Pick<typeof rootScope.managers, 'appChatsManager' | 'appAccountManager'>, chatId: ChatId): Promise<boolean> {
  try {
    await managers.appChatsManager.delete(chatId);
    return true;
  } catch(error) {
    if(['CHAT_IDENTITY_REQUIRED', 'IDENTITY_PROOF_REQUIRED'].includes((error as ApiError).type)) {
      toastNew({langPackKey: 'BlahDeleteChatIdentityRequired'});
      return false;
    }
    throw error;
  }
}
