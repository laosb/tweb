import {createEffect, createSignal, onCleanup, Show} from 'solid-js';
import Row from '@components/rowTsx';
import Section from '@components/section';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import I18n, {i18n} from '@lib/langPack';
import type {IdentityView} from '@lib/blah/identity';
import {chatIdentityError} from '@lib/blah/chatIdentityError';
import styles from '@lib/blah/identity.module.scss';

/** This lookup belongs to identity details, never to opening a conversation. */
export default function ChatIdentityOwnership(props: {identity: IdentityView, onClaimed: () => void}) {
  const [state, setState] = createSignal<'loading' | 'creator' | 'member' | 'join'>('loading');
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal('');
  let disposed = false;
  let check = 0;
  onCleanup(() => { disposed = true; ++check; });
  const managers = bindManagersToSession(rootScope.managers);
  createEffect(() => {
    const identity = props.identity;
    const current = ++check;
    setState('loading');
    void (async() => {
      const chatId = Number(identity.account);
      let chat = await managers.appChatsManager.getChat(chatId);
      if(!chat || (chat._ === 'channel' && chat.pFlags.min)) {
        // A just-imported identity has no access hash in this account's cache.
        // Resolving its published domain saves the peer through the normal manager.
        await managers.appUsersManager.resolveUsername(identity.domain);
        chat = await managers.appChatsManager.getChat(chatId);
      }
      const member = await managers.appChatsManager.isInChat(chatId);
      if(!disposed && current === check) {
        setState(chat && 'pFlags' in chat && 'creator' in chat.pFlags && chat.pFlags.creator ? 'creator' : member ? 'member' : 'join');
      }
    })().catch(() => { if(!disposed && current === check) setState('join'); });
  });

  const claim = async() => {
    if(busy() || disposed) return;
    setBusy(true); setMessage('');
    try {
      await managers.appAccountManager.blahChatIdentity({action: 'claim', id: props.identity.id});
      if(!disposed) {
        setState('creator'); setMessage(I18n.format('BlahChatClaimed', true));
        props.onClaimed();
      }
    } catch(error) {
      if(!disposed) setMessage(chatIdentityError(error, true));
    } finally { if(!disposed) setBusy(false); }
  };

  return <Section name="BlahChatOwnership" caption="BlahChatHandover">
    <Show when={state() === 'member'}>
      <Row clickable={claim} disabled={busy()}><Row.Icon icon="key" /><Row.Title>{i18n('BlahClaimChatOwnership')}</Row.Title></Row>
    </Show>
    <Show when={state() === 'join'}><p class={styles.sectionNote}>{i18n('BlahChatClaimJoinFirst')}</p></Show>
    <p role="status">{busy() || state() === 'loading' ? i18n('PleaseWait') : message()}</p>
  </Section>;
}
