import {createSignal, For, onCleanup, onMount, Show} from 'solid-js';
import Section from '@components/section';
import Row from '@components/rowTsx';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import I18n, {i18n} from '@lib/langPack';
import showIdentitySetup from '@lib/blah/IdentitySetup';
import showIdentityDetails, {IdentityDetails} from '@lib/blah/IdentityDetails';
import {detailsSession} from '@lib/blah/detailsSession';
import type {IdentitySummary, IdentityView, IdentityActions} from '@lib/blah/identity';

export default function IdentitySettings() {
  const [tab] = useSuperTab();
  const [identity, setIdentity] = createSignal<IdentityView>();
  const [chats, setChats] = createSignal<IdentitySummary[]>([]);
  const [message, setMessage] = createSignal('');
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const action: IdentityActions = (request) => tab.managers.appAccountManager.blahIdentity(request);
  const session = detailsSession(action, undefined, () => {});
  onCleanup(() => { void session.close(); });
  async function refresh() {
    const resources = await action({action: 'list', kind: 'channel'});
    if(!disposed) setChats(resources.identities || []);
  }
  onMount(() => {
    void refresh();
    void action({action: 'inspect'}).then((result) => { if(!disposed) { setIdentity(result.identity); if(result.managed) setMessage(I18n.format('BlahNoAccountIdentityNotice', true)); } })
    .catch((error) => { if(!disposed) setMessage(error.message === 'BLAH_IDENTITY_REQUIRED' ? I18n.format('BlahNoAccountIdentityNotice', true) : error.message); });
  });
  const details = (summary: IdentitySummary, identity?: IdentityView) => showIdentityDetails({summary, identity,
    action: (request) => action({...request, kind: 'channel'}), onIdentity: () => { void refresh(); }});
  return <>
    <Show when={identity()}>{(value) => <IdentityDetails summary={value()} identity={value()} action={action} session={session}
      onIdentity={setIdentity} />}</Show>
    <Section name="BlahChatIdentities">
      <For each={chats()}>{(entry) => <Row clickable={() => details(entry)}>
        <Row.Icon icon="key" /><Row.Title>{entry.title || entry.domain}</Row.Title>
        <Row.Subtitle>{entry.chatId ? entry.domain : i18n('BlahIdentityNotAttachedSubtitle')}</Row.Subtitle>
      </Row>}</For>
      <Row clickable={() => showIdentitySetup({action, onIdentity: (identity) => { void refresh(); details(identity, identity); }})}>
        <Row.Icon icon="key" /><Row.Title>{i18n('BlahRestoreChatIdentity')}</Row.Title>
      </Row>
    </Section>
    <p role="status">{message()}</p>
  </>;
}
