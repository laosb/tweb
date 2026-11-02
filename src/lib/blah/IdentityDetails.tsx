import {createSignal, For, Show, onCleanup, onMount} from 'solid-js';
import CheckboxField from '@components/checkboxFieldTsx';
import Button from '@components/buttonTsx';
import Row from '@components/rowTsx';
import Section from '@components/section';
import confirmationPopup from '@components/confirmationPopup';
import PopupElement, {createPopup, usePopupContext} from '@components/popups/indexTsx';
import type {JSX} from 'solid-js';
import {showHostedNameChooser} from '@lib/blah/HostedNameChooser';
import {hostingMessage} from '@lib/blah/hostingMessage';
import {i18n} from '@lib/langPack';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import IdentityInput from '@lib/blah/IdentityInput';
import ChatIdentityOwnership from '@lib/blah/ChatIdentityOwnership';
import type {IdentityActions} from '@lib/blah/identity';
import type {IdentityRequest, IdentitySummary, IdentityView} from '@lib/blah/identity';
import {detailsSession} from '@lib/blah/detailsSession';
import {renewalPolicy} from '@lib/blah/renewal';
import {enterRecoveryWords, showRecoveryWords} from '@lib/blah/RecoveryWords';
import {exportProfile as exportFile} from '@lib/blah/profileFiles';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';
import styles from '@lib/blah/identity.module.scss';

export type DetailsProps = {
  summary: IdentitySummary,
  identity?: IdentityView,
  action: IdentityActions,
  onIdentity: (identity: IdentityView) => void
};
export type DetailsTabPayload = DetailsProps & {session: ReturnType<typeof detailsSession>};

export function IdentityDetails(props: DetailsTabPayload) {
  const managers = bindManagersToSession(rootScope.managers);
  const [identity, setIdentity] = createSignal(props.identity);
  const [pending, setPending] = createSignal(0);
  const busy = () => pending() > 0;
  const [message, setMessage] = createSignal<JSX.Element>('');
  const [newDomain, setNewDomain] = createSignal('');
  const [publicationPending, setPublicationPending] = createSignal<boolean>();
  const [publicationError, setPublicationError] = createSignal(false);
  let exportButton: HTMLElement;
  const [profileDays, setProfileDays] = createSignal(String(props.identity?.renewal.profileDays ?? 180));
  const [deviceDays, setDeviceDays] = createSignal(String(props.identity?.renewal.deviceDays ?? 180));
  const [autoRenew, setAutoRenew] = createSignal(props.identity?.renewal.autoRenew ?? true);
  let saveTimer: ReturnType<typeof setTimeout>;
  let renewalChanged = false;
  let publicationCheck = 0;

  props.session.beforeClose = flushRenewal;
  onCleanup(() => { void props.session.close().catch(console.error); });
  onMount(() => { void run({action: 'inspect'}); });

  async function checkPublication() {
    const check = ++publicationCheck;
    setPublicationPending(undefined);
    setPublicationError(false);
    try {
      const {publication} = await props.session.action({action: 'publication'});
      if(props.session.isClosed() || check !== publicationCheck) return;
      // A renewal may have completed while the host was being read.
      if(publication?.profile.length === identity()?.profile.length &&
        publication.profile.every((byte, index) => byte === identity().profile[index])) {
        setPublicationPending(publication.pending);
      }
    } catch{
      if(!props.session.isClosed() && check === publicationCheck) setPublicationError(true);
    }
  }

  function accept(current: IdentityView, updateRenewal = true) {
    if(updateRenewal && !renewalChanged) {
      setAutoRenew(current.renewal.autoRenew);
      setProfileDays(String(current.renewal.profileDays));
      setDeviceDays(String(current.renewal.deviceDays));
    }
    setIdentity(current);
    props.onIdentity(current);
  }

  function scheduleRenewal() {
    renewalChanged = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushRenewal, 400);
  }

  function flushRenewal() {
    clearTimeout(saveTimer);
    if(!renewalChanged || !identity()) return;
    try {
      const renewal = renewalPolicy({profileDays: Number(profileDays()), deviceDays: Number(deviceDays()), autoRenew: autoRenew()});
      renewalChanged = false;
      // Dispatch now so closing the view waits for this save before closing.
      void run({action: 'renewal', renewal});
    } catch(error) {
      setMessage((error as Error).message);
    }
  }

  async function run(request: IdentityRequest) {
    if(props.session.isClosed()) return false;
    setPending((count) => count + 1); setMessage('');
    try {
      const result = await props.session.action(request);
      if(props.session.isClosed()) return false;
      if(result.identity) accept(result.identity, request.action !== 'renewal');
      // The slot's account belonged to the hosting this home change ended.
      if(result.retired) void managers.apiManager.logOut();
      if(result.identity && request.action !== 'renewal') void checkPublication();
      return true;
    } catch(cause) {
      const error = cause as {type?: string, message?: string};
      if(!props.session.isClosed() && ['renew', 'domains', 'home', 'retryPublication'].includes(request.action)) {
        try {
          // Publication can fail after a new revision has already been saved.
          const result = await props.session.action({action: 'inspect'});
          if(!props.session.isClosed()) { accept(result.identity); void checkPublication(); }
        } catch{}
      }
      if(!props.session.isClosed()) {
        if(request.action === 'renewal') renewalChanged = true;
        setMessage(error.type?.startsWith('BlahHosting') ? hostingMessage(cause) : error.type || error.message || 'Identity operation failed.');
      }
      return false;
    } finally {
      setPending((count) => count - 1);
    }
  }

  async function addDomain() {
    const domain = newDomain().trim().toLowerCase();
    if(busy() || !domain) return;
    if(await run({action: 'domains', domains: [...identity().domains, domain]})) setNewDomain('');
  }

  const homeLabel = () => identity().hosting.domain || identity().hosting.dc;

  /** Any DC by domain; the viewing account's DC comes first when the identity lives elsewhere. */
  function ChangeHomeForm() {
    const popup = usePopupContext();
    const [domain, setDomain] = createSignal('');
    const [submitting, setSubmitting] = createSignal(false);
    const slot = identity().hosting.slot;
    const choose = async(target: string) => {
      target = target.trim().toLowerCase();
      if(submitting() || !target || props.session.isClosed()) return;
      try {
        await confirmationPopup({
          titleLangKey: 'BlahChangeHomeDC',
          descriptionLangKey: identity().hosting.account ? 'BlahChangeHomeWarning' : 'BlahChangeHomeUnallocated',
          descriptionLangArgs: [homeLabel(), target],
          button: {langKey: 'BlahChangeHomeConfirm', isDanger: true}
        });
      } catch{ return; }
      setSubmitting(true);
      if(await run({action: 'home', domain: target})) popup.hide();
      setSubmitting(false);
    };
    return <form class={styles.panel} onSubmit={(event) => { event.preventDefault(); void choose(domain()); }}>
      <Show when={!identity().hosting.current}>
        <Row clickable={() => void choose(slot.domain)} disabled={submitting()}>
          <Row.Icon icon="data" /><Row.Title>{slot.domain}</Row.Title><Row.Subtitle>{i18n('BlahThisAccountDC')}</Row.Subtitle>
        </Row>
      </Show>
      <IdentityInput label="BlahDCDomain" onInput={setDomain} disabled={submitting()} />
      <Button primaryFilled text="BlahChangeHomeDC" disabled={submitting() || !domain().trim()} onClick={() => choose(domain())} />
      <p role="status">{submitting() ? i18n('BlahDCLoading') : message()}</p>
    </form>;
  }

  function changeHome() {
    createPopup(() => <PopupElement class={styles.setupPopup} closable>
      <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahChangeHomeDC" /></PopupElement.Header>
      <PopupElement.Body class={styles.setupBody}><ChangeHomeForm /></PopupElement.Body>
    </PopupElement>);
  }

  return <div class={styles.panel}>
    <Show when={identity()}>
      <Section>
        <Row><Row.Icon icon="username" /><Row.Title>{identity().domain}</Row.Title><Row.Subtitle>{i18n('BlahProfileDomain')}</Row.Subtitle></Row>
        <Row><Row.Icon icon="key" /><Row.Title><code class={styles.identifier} title={identity().id}>{identity().id}</code></Row.Title><Row.Subtitle>{i18n('BlahIdentityID')}</Row.Subtitle></Row>
        <Row><Row.Icon icon="time_filled" /><Row.Title>{new Date(identity().expiresAt * 1000).toLocaleString()}</Row.Title><Row.Subtitle>{i18n('BlahProfileExpires')}</Row.Subtitle></Row>
      </Section>
      <Show when={identity().hosting}>
        <Section name="BlahHomeDC" caption={identity().hosting.current ? 'BlahHomeDCHelp' : 'BlahHostedElsewhere'}
          captionArgs={[identity().hosting.slot.domain]}>
          <Row><Row.Icon icon="data" />
            <Row.Title>{identity().hosting.domain || <code class={styles.identifier} title={identity().hosting.dc}>{identity().hosting.dc}</code>}</Row.Title>
            <Row.Subtitle>{i18n(identity().hosting.current ? 'BlahThisAccountDC' : 'BlahOtherDC')}</Row.Subtitle></Row>
          <Row><Row.Icon icon="user" /><Row.Title>{identity().hosting.account || i18n('BlahUserIDNotAllocated')}</Row.Title>
            <Row.Subtitle>{i18n('BlahUserID')}</Row.Subtitle></Row>
          <Show when={identity().holder}><Row clickable={changeHome} disabled={busy()}><Row.Icon icon="replace" /><Row.Title>{i18n('BlahChangeHomeDC')}</Row.Title></Row></Show>
        </Section>
      </Show>
      <Show when={identity().kind === 'channel' && identity().account}>
        <ChatIdentityOwnership identity={identity()} onClaimed={() => focusWhenSettled(exportButton, () => !props.session.isClosed())} />
      </Show>
      <Section name="BlahProfileDomains" caption="BlahProfileDomainsHelp">
        <For each={identity().domains}>{(domain) => <div role="group" aria-label={domain}>
          <Row disabled={busy()}>
            <Row.Title>{domain}</Row.Title>
          </Row>
          <Show when={identity().holder}><Button text="Delete" disabled={busy() || identity().domains.length === 1} onClick={() => run({action: 'domains',
            domains: identity().domains.filter((name) => name !== domain)})} /></Show>
        </div>}</For>
        <Show when={identity().holder}><form onSubmit={(event) => { event.preventDefault(); void addDomain(); }}>
          <IdentityInput label="BlahProfileDomain" value={newDomain()} onInput={setNewDomain} disabled={busy()} />
          <Button text="BlahAddDomain" disabled={busy() || !newDomain().trim()} onClick={addDomain} />
        </form></Show>
        <Show when={identity().hostingAvailable}>
          <Button text="BlahHostingAdd" disabled={busy()} onClick={() => showHostedNameChooser({action: props.session.action,
            identity: identity(), onIdentity: (current) => { accept(current); void checkPublication(); }})} />
          <Show when={identity().hostedNames}>
            <p role="status">{i18n(identity().publicationPending ? 'BlahHostingPending' : 'BlahHostingPublished')}</p>
            <Button text="BlahHostingRetry" disabled={busy()} onClick={() => run({action: 'retryPublication'})} />
          </Show>
        </Show>
      </Section>
      <Section name="BlahPublicProfile">
        <Row ref={(element) => exportButton = element} clickable={() => exportFile('profile.cbor', new Uint8Array(identity().profile), 'application/cbor')} disabled={busy()}><Row.Icon icon="document" /><Row.Title>{i18n('BlahExportProfile')}</Row.Title></Row>
      </Section>
        <Show when={publicationPending()}><p class={styles.sectionNote}>{i18n('BlahProfileNeedsPublication')}</p></Show>
        <Show when={publicationError()}><p class={styles.sectionNote}>{i18n('BlahPublicationCheckFailed')}</p></Show>
      <Show when={identity().holder}><Section name="BlahRenewalSettings">
        <div class={styles.renewalSettings}>
          <IdentityInput label="BlahProfileValidityDays" type="number" value={profileDays()} onInput={(value) => { setProfileDays(value); scheduleRenewal(); }} />
          <IdentityInput label="BlahDeviceValidityDays" type="number" value={deviceDays()} onInput={(value) => { setDeviceDays(value); scheduleRenewal(); }} />
          <Row>
            <Row.CheckboxFieldToggle><CheckboxField toggle checked={autoRenew()} onChange={(checked) => { setAutoRenew(checked); scheduleRenewal(); }} /></Row.CheckboxFieldToggle>
            <Row.Title>{i18n('BlahAutoRenew')}</Row.Title>
          </Row>
        </div>
        <p class={styles.sectionNote}>{i18n('BlahAutoRenewHelp')}</p>
        <Row clickable={() => { flushRenewal(); void run({action: 'renew'}); }} disabled={busy()}><Row.Icon icon="key" /><Row.Title>{i18n('BlahRenewProfile')}</Row.Title></Row>
      </Section>
      </Show>
      <Section name="BlahRecoveryWords" caption="BlahIdentityCustody">
        <Show when={identity().holder} fallback={
          <Row clickable={() => enterRecoveryWords(props.session.action, () => { void run({action: 'inspect'}); })}>
            <Row.Icon icon="key" /><Row.Title>{i18n('BlahEnterRecoveryWords')}</Row.Title>
          </Row>
        }>
          <Row clickable={() => void showRecoveryWords(props.session.action, managers).catch((error) => setMessage(error.message))}>
            <Row.Icon icon="key" /><Row.Title>{i18n('BlahRecoveryWords')}</Row.Title>
          </Row>
          <Row clickable={async() => {
            try { await confirmationPopup({titleLangKey: 'BlahRemoveWords', descriptionLangKey: 'BlahRemoveWordsConfirm',
              button: {langKey: 'BlahRemoveWords', isDanger: true}}); }
            catch{ return; }
            await run({action: 'removeWords'});
          }}><Row.Icon icon="delete" /><Row.Title>{i18n('BlahRemoveWords')}</Row.Title></Row>
        </Show>
      </Section>
    </Show>
    <p role="status">{busy() ? i18n('PleaseWait') : message()}</p>
  </div>;
}

export default function showIdentityDetails(props: DetailsProps) {
  const session = detailsSession(props.action, props.summary.id, () => props.onIdentity(undefined));
  function Content() {
    return <IdentityDetails {...props} session={session} />;
  }
  createPopup(() => <PopupElement class={styles.setupPopup} closable onClose={() => { void session.close().catch(console.error); }}>
    <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahIdentityDetails" /></PopupElement.Header>
    <PopupElement.Scrollable><PopupElement.Body class={styles.detailsBody}><Content /></PopupElement.Body></PopupElement.Scrollable>
  </PopupElement>);
}
