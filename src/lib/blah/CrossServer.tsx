import {createEffect, createSignal, onCleanup, onMount, Show} from 'solid-js';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import Row from '@components/rowTsx';
import {InputFieldTsx} from '@components/inputFieldTsx';
import type {AvatarEditPayload} from '@components/avatarEdit';
import type {Chat, ChannelsCreateChannel} from '@layer';
import {i18n} from '@lib/langPack';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import {verifyResourceProfile} from '@lib/blah/resourceProfiles';
import {profileDomain} from '@lib/blah/profile';
import type {ChatIdentityChange} from '@lib/blah/chatIdentity';
import showChatIdentitySetup, {chatIdentityError} from '@lib/blah/ChatIdentitySetup';
import styles from '@lib/blah/identity.module.scss';

/** Form-local state keeps the upstream hooks small and the cancelled attempt reusable. */
export default function useCrossServer(chat?: Chat.chat | Chat.channel) {
  const managers = bindManagersToSession(rootScope.managers);
  const accountNumber = getCurrentAccount();
  const eligible = !chat || (chat._ === 'channel' && chat.pFlags.creator && !chat.pFlags.monoforum);
  const [visible, setVisible] = createSignal(!chat);
  const [enabled, setEnabled] = createSignal(false);
  const [boundDomain, setBoundDomain] = createSignal<string>();
  const [domain, setDomain] = createSignal('');
  const [placeholder, setPlaceholder] = createSignal('news.example.org');
  const [error, setError] = createSignal('');
  const attempt = crypto.randomUUID();
  let alive = true;
  onCleanup(() => { alive = false; });
  onMount(() => {
    if(!eligible) return;
    // Public metadata supplies a suggestion even while the account identity is locked.
    void managers.appAccountManager.blahIdentity({action: 'suggestDomain'}).then(({domain}) => {
      if(alive && domain) setPlaceholder(`news.${domain}`);
    }).catch(() => {});
    if(chat) void managers.appProfileManager.getBlahResourceProfiles([chat.id.toPeerId(true)]).then(async([profile]) => {
      if(!profile) return;
      if(profile.status === 'present') {
        // A just-bound chat can still have the proposed, unnumbered profile at its home.
        const identity = await verifyResourceProfile(accountNumber, 'channel', String(chat.id), profile.profile.profile, true);
        if(!alive || !identity) return;
        setEnabled(true); setBoundDomain(identity.domains[0] || identity.identityId);
      }
      if(alive) setVisible(true);
    }).catch(() => {});
  });
  const dirty = () => visible() && enabled() && !boundDomain();
  const execute = async(change: ChatIdentityChange) => {
    setError('');
    try {
      const checked = profileDomain(domain());
      return await showChatIdentitySetup({domain: checked, attempt, change,
        action: (request) => managers.appAccountManager.blahChatIdentity(request),
        identityAction: (request) => managers.appAccountManager.blahIdentity(request)});
    } catch(error) {
      if(alive && (error as Error).message !== 'BLAH_CHAT_CANCELLED') setError(chatIdentityError(error));
      throw error;
    }
  };
  return {
    enabled: dirty,
    row: <Show when={eligible && visible()}><div class={styles.panel}>
      <Row disabled={!!boundDomain()}>
        <Row.CheckboxFieldToggle><CheckboxFieldTsx toggle checked={enabled()} disabled={!!boundDomain()} onChange={setEnabled} /></Row.CheckboxFieldToggle>
        <Row.Title>{i18n('BlahCrossServer')}</Row.Title>
        <Row.Subtitle>{boundDomain() || i18n('BlahCrossServerHelp')}</Row.Subtitle>
      </Row>
      <Show when={dirty()}><InputFieldTsx plainText label="BlahProfileDomain" value={domain()} onRawInput={setDomain}
        instanceRef={(field) => { createEffect(() => { (field.input as HTMLInputElement).placeholder = placeholder(); }); }} />
      </Show>
      <p role="status">{error()}</p>
    </div></Show>,
    createChannel: async(options: ChannelsCreateChannel) => (await execute({action: 'createChannel', options})).chatId,
    createChat: (title: string, userIds: UserId[]) => execute({action: 'createChat', title, userIds}),
    save: async(change: Omit<Extract<ChatIdentityChange, {action: 'edit'}>, 'action' | 'photo'> & {uploadAvatar?: AvatarEditPayload},
      setSaving: (value: boolean) => void, close: () => void) => {
      setSaving(true);
      try {
        // Validate before even uploading a new photo.
        profileDomain(domain());
        const {uploadAvatar, ...fields} = change;
        await execute({action: 'edit', ...fields, photo: uploadAvatar && await uploadAvatar.file()});
        if(alive) close();
      } catch(cause) {
        if(alive && (cause as Error).message !== 'BLAH_CHAT_CANCELLED') setError(chatIdentityError(cause));
      } finally { if(alive) setSaving(false); }
    }
  };
}
