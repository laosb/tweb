import {createSignal, For, Show, onCleanup, onMount} from 'solid-js';
import CheckboxField from '@components/checkboxFieldTsx';
import Button from '@components/buttonTsx';
import Row from '@components/rowTsx';
import Section from '@components/section';
import confirmationPopup from '@components/confirmationPopup';
import PopupElement, {createPopup, usePopupContext} from '@components/popups/indexTsx';
import {i18n} from '@lib/langPack';
import IdentityInput from '@lib/blah/IdentityInput';
import type {IdentityActions} from '@lib/blah/IdentityPanel';
import type {IdentityRequest, IdentitySummary, IdentityView} from '@lib/blah/identity';
import {detailsSession} from '@lib/blah/detailsSession';
import {renewalPolicy} from '@lib/blah/renewal';
import {encode} from '@lib/blah/vault';
import createDownloadAnchor from '@helpers/dom/createDownloadAnchor';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';
import {ObjectURLScope} from '@helpers/objectUrl';
import styles from '@lib/blah/identity.module.scss';

export type DetailsProps = {
  summary: IdentitySummary,
  identity?: IdentityView,
  action: IdentityActions,
  onIdentity: (identity: IdentityView) => void
};
export type DetailsTabPayload = DetailsProps & {session: ReturnType<typeof detailsSession>, onReturn?: () => void};

export function IdentityDetails(props: DetailsTabPayload & {onExit: () => void}) {
  const [identity, setIdentity] = createSignal(props.identity);
  const [pending, setPending] = createSignal(0);
  const busy = () => pending() > 0;
  const [message, setMessage] = createSignal('');
  const [newDomain, setNewDomain] = createSignal('');
  const [publicationPending, setPublicationPending] = createSignal<boolean>();
  const [publicationError, setPublicationError] = createSignal(false);
  let password: HTMLInputElement;
  let exportButton: HTMLElement;
  const [profileDays, setProfileDays] = createSignal(String(props.identity?.renewal.profileDays ?? 180));
  const [deviceDays, setDeviceDays] = createSignal(String(props.identity?.renewal.deviceDays ?? 180));
  const [autoRenew, setAutoRenew] = createSignal(props.identity?.renewal.autoRenew ?? true);
  let saveTimer: ReturnType<typeof setTimeout>;
  let renewalChanged = false;
  let publicationCheck = 0;

  props.session.beforeClose = flushRenewal;
  onCleanup(() => { void props.session.close().catch(console.error); });
  onMount(() => {
    if(props.identity) void run({action: 'inspect'});
    else focusWhenSettled(password, () => !props.session.isClosed());
  });

  function exportFile(name: string, bytes: BlobPart, type: string) {
    const urls = new ObjectURLScope();
    const url = urls.create(new Blob([bytes], {type}));
    createDownloadAnchor(url, name, () => setTimeout(() => urls.dispose(), 30_000));
  }

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
    if(password) password.value = '';
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
      // Dispatch now so closing the view waits for this save before locking.
      void run({action: 'renewal', renewal});
    } catch(error) {
      setMessage((error as Error).message);
    }
  }

  async function run(request: IdentityRequest) {
    if(props.session.isClosed()) return false;
    setPending((count) => count + 1); setMessage('');
    try {
      const result = await props.session.action({...request, password: password?.value});
      if(props.session.isClosed()) return false;
      if(result.identity) accept(result.identity, request.action !== 'renewal');
      if(request.action === 'unlock') focusWhenSettled(exportButton, () => !props.session.isClosed());
      if(result.backup) exportFile(`${identity().domain}-identity.cbor`, new Uint8Array(result.backup), 'application/cbor');
      if(result.identity && request.action !== 'renewal') void checkPublication();
      return true;
    } catch(cause) {
      const error = cause as {type?: string, message?: string};
      if(!props.session.isClosed() && ['renew', 'addDevice', 'removeDevice', 'removeOtherDevices', 'domains'].includes(request.action)) {
        try {
          // Publication can fail after a new revision has already been saved.
          const result = await props.session.action({action: 'inspect'});
          if(!props.session.isClosed()) { accept(result.identity); void checkPublication(); }
        } catch{}
      }
      if(!props.session.isClosed()) {
        if(request.action === 'renewal') renewalChanged = true;
        if(error.message === 'Unlock your browser identity to continue.') {
          setIdentity(undefined);
          props.onIdentity(undefined);
        }
        setMessage(error.type || error.message || 'Identity operation failed.');
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

  async function terminate(device?: string) {
    try {
      await confirmationPopup({
        titleLangKey: device ? 'AreYouSureSessionTitle' : 'AreYouSureSessionsTitle',
        descriptionLangKey: 'BlahTerminateDevicesHelp',
        button: {langKey: 'Terminate', isDanger: true}
      });
    } catch{ return; }
    if(!props.session.isClosed()) return run({action: device ? 'removeDevice' : 'removeOtherDevices', device});
  }

  function AuthorizeForm() {
    const popup = usePopupContext();
    const [key, setKey] = createSignal('');
    const [submitting, setSubmitting] = createSignal(false);
    const submit = async() => {
      if(submitting() || !key().trim() || props.session.isClosed()) return;
      setSubmitting(true);
      if(await run({action: 'addDevice', device: key().trim()})) popup.hide();
      setSubmitting(false);
    };
    return <form class={styles.panel} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <IdentityInput label="BlahDeviceKey" onInput={setKey} disabled={submitting()} />
      <Button primaryFilled text="BlahAuthorizeDevice" disabled={submitting() || !key().trim()} onClick={submit} />
      <p role="status">{message()}</p>
    </form>;
  }

  function authorizeDevice() {
    createPopup(() => <PopupElement class={styles.setupPopup} closable>
      <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahAuthorizeDevice" /></PopupElement.Header>
      <PopupElement.Body class={styles.setupBody}><AuthorizeForm /></PopupElement.Body>
    </PopupElement>);
  }

  const DeviceDetails = (row: {entry: IdentityView['devices'][number]}) => {
    const popup = usePopupContext();
    return <>
      <Row><Row.Title><code class={styles.identifier} title={row.entry.id}>{row.entry.id}</code></Row.Title>
        <Row.Subtitle>{i18n('BlahDeviceExpires', [new Date(row.entry.expiresAt * 1000).toLocaleString()])}</Row.Subtitle></Row>
      <Row clickable={() => { navigator.clipboard.writeText(encode(new Uint8Array(row.entry.key))).catch(() => setMessage('Clipboard unavailable.')); }}>
        <Row.Icon icon="copy" /><Row.Title>{i18n('BlahCopyDeviceKey')}</Row.Title>
      </Row>
      <Show when={!row.entry.current}>
        <Button class="btn-primary btn-transparent danger" icon="stop" text="Terminate" disabled={busy()} onClick={async() => { if(await terminate(row.entry.id)) popup.hide(); }} />
      </Show>
      <p role="status">{message()}</p>
    </>;
  };

  const DeviceRow = (row: {entry: IdentityView['devices'][number]}) => <Row class="session-row"
    clickable={() => {
      createPopup(() => <PopupElement class={styles.setupPopup} closable>
        <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahDeviceDetails" /></PopupElement.Header>
        <PopupElement.Body><DeviceDetails entry={row.entry} /></PopupElement.Body>
      </PopupElement>);
    }} disabled={busy()}
    contextMenu={row.entry.current ? undefined : {buttons: [{icon: 'stop', text: 'Terminate', danger: true, onClick: () => void terminate(row.entry.id)}]}}>
    <Row.Icon icon={row.entry.current ? 'web_filled' : 'devices_filled'} />
    <Row.Title>{row.entry.current ? i18n('BlahThisBrowser') : <code class={styles.identifier} title={row.entry.id}>{row.entry.id}</code>}</Row.Title>
    <Row.Subtitle>{i18n('BlahDeviceExpires', [new Date(row.entry.expiresAt * 1000).toLocaleString()])}</Row.Subtitle>
  </Row>;

  return <div class={styles.panel}>
    <Show when={identity()} fallback={<form class={styles.lockedDetails} onSubmit={(event) => { event.preventDefault(); if(!busy()) void run({action: 'unlock'}); }}>
      <Row><Row.Title>{props.summary.domain}</Row.Title><Row.Subtitle><code class={styles.identifier} title={props.summary.id}>{props.summary.id}</code></Row.Subtitle></Row>
      <IdentityInput label="BlahIdentityPassword" type="password" autocomplete="current-password" disabled={busy()} ref={(value) => password = value} />
      <Button primaryFilled disabled={busy()} onClick={() => run({action: 'unlock'})} text="BlahUnlockIdentity" />
    </form>}>
      <Section>
        <Row><Row.Icon icon="username" /><Row.Title>{identity().domain}</Row.Title><Row.Subtitle>{i18n('BlahProfileDomain')}</Row.Subtitle></Row>
        <Row><Row.Icon icon="key" /><Row.Title><code class={styles.identifier} title={identity().id}>{identity().id}</code></Row.Title><Row.Subtitle>{i18n('BlahIdentityID')}</Row.Subtitle></Row>
        <Row><Row.Icon icon="time_filled" /><Row.Title>{new Date(identity().expiresAt * 1000).toLocaleString()}</Row.Title><Row.Subtitle>{i18n('BlahProfileExpires')}</Row.Subtitle></Row>
      </Section>
      <Section name="BlahProfileDomains" caption="BlahProfileDomainsHelp">
        <For each={identity().domains}>{(domain) => <div role="group" aria-label={domain}>
          <Row disabled={busy()}>
            <Row.Title>{domain}</Row.Title>
          </Row>
          <Button text="Delete" disabled={busy() || identity().domains.length === 1} onClick={() => run({action: 'domains',
            domains: identity().domains.filter((name) => name !== domain)})} />
        </div>}</For>
        <form onSubmit={(event) => { event.preventDefault(); void addDomain(); }}>
          <IdentityInput label="BlahProfileDomain" value={newDomain()} onInput={setNewDomain} disabled={busy()} />
          <Button text="BlahAddDomain" disabled={busy() || !newDomain().trim()} onClick={addDomain} />
        </form>
      </Section>
      <Section name="BlahIdentityFiles">
        <Row ref={(element) => exportButton = element} clickable={() => exportFile('profile.cbor', new Uint8Array(identity().profile), 'application/cbor')} disabled={busy()}><Row.Icon icon="document" /><Row.Title>{i18n('BlahExportProfile')}</Row.Title></Row>
        <Row clickable={() => run({action: 'backup'})} disabled={busy()}><Row.Icon icon="document" /><Row.Title>{i18n('BlahExportBackup')}</Row.Title></Row>
      </Section>
      <Section name="BlahRenewalSettings">
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
        <Show when={publicationPending()}><p class={styles.sectionNote}>{i18n('BlahProfileNeedsPublication')}</p></Show>
        <Show when={publicationError()}><p class={styles.sectionNote}>{i18n('BlahPublicationCheckFailed')}</p></Show>
      </Section>
      <Section name="CurrentSession">
        <For each={identity().devices.filter((entry) => entry.current)}>{(entry) => <DeviceRow entry={entry} />}</For>
        <Show when={identity().devices.some((entry) => !entry.current)}>
          <Button class="btn-primary btn-transparent danger" icon="stop" text="BlahTerminateOtherDevices" disabled={busy()} onClick={() => terminate()} />
        </Show>
      </Section>
      <Show when={identity().devices.some((entry) => !entry.current)}>
        <Section name="OtherSessions"><For each={identity().devices.filter((entry) => !entry.current)}>{(entry) => <DeviceRow entry={entry} />}</For></Section>
      </Show>
      <Section name="Devices">
        <Row clickable={authorizeDevice} disabled={busy()}><Row.Icon icon="add" /><Row.Title>{i18n('BlahAuthorizeDevice')}</Row.Title></Row>
      </Section>
      <Section caption="BlahIdentityCustody">
        <Row clickable={props.onExit}><Row.Icon icon="lock" /><Row.Title>{i18n('BlahLockIdentity')}</Row.Title></Row>
      </Section>
    </Show>
    <p role="status">{busy() ? i18n('PleaseWait') : message()}</p>
  </div>;
}

export default function showIdentityDetails(props: DetailsProps) {
  const session = detailsSession(props.action, props.summary.id, () => props.onIdentity(undefined));
  function Content() {
    const popup = usePopupContext();
    return <IdentityDetails {...props} session={session} onExit={() => popup.hide()} />;
  }
  createPopup(() => <PopupElement class={styles.setupPopup} closable onClose={() => { void session.close().catch(console.error); }}>
    <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahIdentityDetails" /></PopupElement.Header>
    <PopupElement.Scrollable><PopupElement.Body class={styles.detailsBody}><Content /></PopupElement.Body></PopupElement.Scrollable>
  </PopupElement>);
}
