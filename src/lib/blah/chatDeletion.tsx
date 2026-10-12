import {createSignal, onMount} from 'solid-js';
import Button from '@components/buttonTsx';
import PopupElement, {createPopup, usePopupContext} from '@components/popups/indexTsx';
import {toastNew} from '@components/toast';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';
import {i18n} from '@lib/langPack';
import type rootScope from '@lib/rootScope';
import IdentityInput from '@lib/blah/IdentityInput';
import type {IdentityActions} from '@lib/blah/IdentityPanel';
import type {IdentitySummary} from '@lib/blah/identity';
import {chatIdentityError} from '@lib/blah/chatIdentityError';
import styles from '@lib/blah/identity.module.scss';

/** Cancellation wins over an in-flight unlock and locks any late custody. */
export function unlockChatIdentity(identity: IdentitySummary, action: IdentityActions): Promise<boolean> {
  return new Promise((resolve) => {
    let closed = false;
    let unlocked = false;
    let pending: Promise<void>;
    function Content() {
      const popup = usePopupContext();
      const [busy, setBusy] = createSignal(false);
      const [message, setMessage] = createSignal('');
      let password: HTMLInputElement;
      onMount(() => focusWhenSettled(password, () => !closed));
      const submit = () => {
        if(busy() || closed) return;
        setBusy(true); setMessage('');
        pending = action({action: 'unlock', id: identity.id, password: password.value}).then(async() => {
          password.value = '';
          if(closed) { await action({action: 'lock', id: identity.id}); return; }
          unlocked = true;
          popup.hide();
        }).catch((error) => {
          if(!closed) setMessage(chatIdentityError(error));
        }).finally(() => setBusy(false));
      };
      return <form class={styles.panel} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <p>{i18n('BlahUnlockChatIdentityHelp', [identity.domain || identity.id])}</p>
        <IdentityInput label="BlahIdentityPassword" type="password" autocomplete="current-password" disabled={busy()} ref={(input) => password = input} />
        <Button primaryFilled text="BlahUnlockIdentity" disabled={busy()} onClick={submit} />
        <p role="status">{busy() ? i18n('PleaseWait') : message()}</p>
      </form>;
    }
    createPopup(() => <PopupElement class={styles.setupPopup} closable onClose={() => { closed = true; }}
      onCloseAfterTimeout={() => { void Promise.resolve(pending).then(() => resolve(unlocked)); }}>
      <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahUnlockChatIdentity" /></PopupElement.Header>
      <PopupElement.Body class={styles.setupBody}><Content /></PopupElement.Body>
    </PopupElement>);
  });
}

/** The delete dialog treats any resolution as success, so an aborted deletion must reject. */
export default async function deleteChatWithIdentity(...args: Parameters<typeof tryDeleteChatWithIdentity>): Promise<true> {
  if(!await tryDeleteChatWithIdentity(...args)) throw new Error('BLAH_CHAT_CANCELLED');
  return true;
}

/** For callers that check the result: false means cancellation or an explained custody requirement. */
export async function tryDeleteChatWithIdentity(managers: Pick<typeof rootScope.managers, 'appChatsManager' | 'appAccountManager'>, chatId: ChatId): Promise<boolean> {
  let unlockedId: string;
  try {
    try {
      await managers.appChatsManager.delete(chatId);
    } catch(cause) {
      const error = cause as {type?: string, id?: string, domain?: string};
      if(error.type !== 'BLAH_CHAT_IDENTITY_LOCKED') throw cause;
      const action: IdentityActions = (request) => managers.appAccountManager.blahIdentity(request);
      if(!await unlockChatIdentity({id: error.id, domain: error.domain}, action)) return false;
      unlockedId = error.id;
      await managers.appChatsManager.delete(chatId);
    }
    return true;
  } catch(error) {
    if(['CHAT_IDENTITY_REQUIRED', 'IDENTITY_PROOF_REQUIRED'].includes((error as ApiError).type)) {
      toastNew({langPackKey: 'BlahDeleteChatIdentityRequired'});
      return false;
    }
    throw error;
  } finally {
    if(unlockedId) await managers.appAccountManager.blahIdentity({action: 'lock', id: unlockedId}).catch(console.error);
  }
}
