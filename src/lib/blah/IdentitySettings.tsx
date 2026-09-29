import {createSignal, For, onCleanup, onMount} from 'solid-js';
import Section from '@components/section';
import Row from '@components/rowTsx';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import {AppBlahIdentityDetailsTab} from '@components/solidJsTabs/tabs';
import {i18n} from '@lib/langPack';
import rootScope from '@lib/rootScope';
import showIdentitySetup from '@lib/blah/IdentitySetup';
import {detailsSession} from '@lib/blah/detailsSession';
import type {IdentitySummary, IdentityView} from '@lib/blah/identity';
import type {IdentityActions} from '@lib/blah/IdentityPanel';
import styles from '@lib/blah/identity.module.scss';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';

export default function IdentitySettings() {
  const [tab] = useSuperTab();
  const [identities, setIdentities] = createSignal<IdentitySummary[]>([]);
  const [message, setMessage] = createSignal('');
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const action: IdentityActions = (request) => rootScope.managers.appAccountManager.blahIdentity(request);
  const refresh = async() => {
    try {
      const result = await action({action: 'list'});
      const entries: IdentitySummary[] = result.identities || result.ids.map((id) => ({id}));
      if(!disposed) setIdentities((previous) => entries
        .map((entry) => previous.find((saved) => saved.id === entry.id && saved.domain === entry.domain) || entry));
    } catch(error) { if(!disposed) setMessage((error as Error).message); }
  };
  onMount(refresh);

  function openDetails(summary: IdentitySummary, identity?: IdentityView, opener = tab.container.ownerDocument.activeElement as HTMLElement) {
    const session = detailsSession(action, summary.id, () => { void refresh(); });
    void tab.slider.createTab(AppBlahIdentityDetailsTab).open({summary, identity, action, session,
      onIdentity: () => {},
      onReturn: () => {
        if(opener?.isConnected) focusWhenSettled(opener, () => !disposed && tab.container.classList.contains('active'));
      }
    });
  }

  function setup(mode: 'create' | 'import') {
    showIdentitySetup({mode, action, onIdentity: (identity) => {
      if(disposed) { void action({action: 'lock', id: identity.id}); return; }
      void refresh();
      openDetails(identity, identity);
    }});
  }

  return <>
    <Section name="BlahSavedIdentities">
      <For each={identities()}>{(entry) => <Row clickable={(event) => openDetails(entry, undefined, event.currentTarget)}>
        <Row.Icon icon="key" />
        <Row.Title>{entry.domain || entry.id.slice(0, 6)}</Row.Title>
        <Row.Subtitle><code class={styles.identifier} title={entry.id}>{entry.id}</code></Row.Subtitle>
      </Row>}</For>
    </Section>
    <Section caption="BlahIdentityCustody">
      <Row clickable={() => setup('create')}><Row.Icon icon="adduser" /><Row.Title>{i18n('BlahCreateIdentity')}</Row.Title></Row>
      <Row clickable={() => setup('import')}><Row.Icon icon="document" /><Row.Title>{i18n('BlahImportIdentity')}</Row.Title></Row>
    </Section>
    <p role="status">{message()}</p>
  </>;
}
