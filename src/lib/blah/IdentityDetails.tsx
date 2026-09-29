import {createSignal, For, Show, onCleanup, onMount} from 'solid-js';
import CheckboxField from '@components/checkboxFieldTsx';
import Button from '@components/buttonTsx';
import Row from '@components/rowTsx';
import Section from '@components/section';
import PopupElement, {createPopup, usePopupContext} from '@components/popups/indexTsx';
import {i18n} from '@lib/langPack';
import IdentityInput from '@lib/blah/IdentityInput';
import type {IdentityActions} from '@lib/blah/IdentityPanel';
import type {IdentityRequest, IdentitySummary, IdentityView} from '@lib/blah/identity';
import {encode} from '@lib/blah/vault';
import createDownloadAnchor from '@helpers/dom/createDownloadAnchor';
import {ObjectURLScope} from '@helpers/objectUrl';
import styles from '@lib/blah/identity.module.scss';

type DetailsProps = {
  summary: IdentitySummary,
  identity?: IdentityView,
  action: IdentityActions,
  onIdentity: (identity: IdentityView) => void
};

function IdentityDetails(props: DetailsProps) {
  const popup = usePopupContext();
  const [identity, setIdentity] = createSignal(props.identity);
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal('');
  let password: HTMLInputElement;
  let publisher: HTMLInputElement;
  let token: HTMLInputElement;
  let device: HTMLInputElement;
  let profileDays: HTMLInputElement;
  let deviceDays: HTMLInputElement;
  const [autoRenew, setAutoRenew] = createSignal(props.identity?.renewal.autoRenew ?? true);
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  onMount(() => { if(props.identity) void run({action: 'inspect'}); });

  function download(name: string, bytes: BlobPart, type: string) {
    const urls = new ObjectURLScope();
    const url = urls.create(new Blob([bytes], {type}));
    createDownloadAnchor(url, name, () => setTimeout(() => urls.dispose(), 30_000));
  }

  function accept(current: IdentityView) {
    if(password) password.value = '';
    setIdentity(current);
    setAutoRenew(current.renewal.autoRenew);
    props.onIdentity(current);
  }

  async function run(request: IdentityRequest) {
    if(busy()) return;
    setBusy(true); setMessage('');
    try {
      const result = await props.action({...request, id: props.summary.id, password: password?.value});
      if(cancelled) return;
      if(result.identity) accept(result.identity);
      if(result.backup) download(`${identity().domain}-identity.json`, result.backup, 'application/json');
      if(request.action === 'lock') {
        props.onIdentity(undefined);
        popup.hide();
      }
    } catch(cause) {
      const error = cause as {type?: string, message?: string};
      if(!cancelled && ['renew', 'publisher', 'addDevice', 'removeDevice'].includes(request.action)) {
        try {
          // Publication may fail after a profile was saved. Export that durable
          // revision, while keeping the original error visible for retry.
          const result = await props.action({action: 'inspect', id: props.summary.id});
          if(!cancelled) accept(result.identity);
        } catch{}
      }
      if(!cancelled) {
        if(error.message === 'Unlock your browser identity to continue.') {
          setIdentity(undefined);
          props.onIdentity(undefined);
        }
        setMessage(error.type || error.message || 'Identity operation failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  return <div class={styles.panel}>
    <fieldset disabled={busy()}>
      <Show when={identity()} fallback={<form class={styles.lockedDetails} onSubmit={(event) => { event.preventDefault(); void run({action: 'unlock'}); }}>
        <Row><Row.Title>{props.summary.domain}</Row.Title><Row.Subtitle><code class={styles.identifier} title={props.summary.id}>{props.summary.id}</code></Row.Subtitle></Row>
        <IdentityInput label="BlahIdentityPassword" type="password" autocomplete="current-password" ref={(value) => password = value} />
        <Button primaryFilled disabled={busy()} onClick={() => run({action: 'unlock'})} text="BlahUnlockIdentity" />
      </form>}>
        <Section noShadow noMarginBottom noDelimiter>
          <Row><Row.Icon icon="username" /><Row.Title>{identity().domain}</Row.Title><Row.Subtitle>{i18n('BlahProfileDomain')}</Row.Subtitle></Row>
          <Row><Row.Icon icon="key" /><Row.Title><code class={styles.identifier} title={identity().id}>{identity().id}</code></Row.Title><Row.Subtitle>{i18n('BlahIdentityID')}</Row.Subtitle></Row>
          <Row><Row.Icon icon="time_filled" /><Row.Title>{new Date(identity().expiresAt * 1000).toLocaleString()}</Row.Title><Row.Subtitle>{i18n('BlahProfileExpires')}</Row.Subtitle></Row>
        </Section>
        <Section noShadow noMarginBottom name="BlahIdentityFiles">
          <Row clickable={() => download('profile.cbor', new Uint8Array(identity().profile), 'application/cbor')} disabled={busy()}><Row.Icon icon="download" /><Row.Title>{i18n('BlahDownloadProfile')}</Row.Title></Row>
          <Row clickable={() => run({action: 'backup'})} disabled={busy()}><Row.Icon icon="document" /><Row.Title>{i18n('BlahDownloadBackup')}</Row.Title></Row>
        </Section>
        <Section noShadow noMarginBottom name="BlahIdentityProfile">
          <Show when={identity().publicationPending}><p class={styles.footnote}>{i18n('BlahProfileNeedsPublication')}</p></Show>
          <Row clickable={() => run({action: 'inspect'})} disabled={busy()}><Row.Icon icon="rotate" /><Row.Title>{i18n('BlahRefreshProfile')}</Row.Title></Row>
          <Row clickable={() => run({action: 'renew'})} disabled={busy()}><Row.Icon icon="key" /><Row.Title>{i18n('BlahRenewProfile')}</Row.Title></Row>
          <details><summary>{i18n('BlahProfilePublishing')}</summary>
            <p>Optional: send only the public profile to an HTTPS endpoint you control. It must accept PUT and allow this site's origin.</p>
            <IdentityInput label="BlahPublicationURL" type="url" value={identity().publisher} ref={(value) => publisher = value} />
            <IdentityInput label="BlahPublicationToken" type="password" ref={(value) => token = value} />
            <Button primaryTransparent disabled={busy()} onClick={() => run({action: 'publisher', publisher: publisher.value, token: token.value})} text="BlahPublishProfile" />
          </details>
        </Section>
        <Section noShadow noMarginBottom>
          <details><summary>{i18n('BlahRenewalSettings')}</summary>
            <div class={styles.renewalSettings}>
              <IdentityInput label="BlahProfileValidityDays" type="number" value={String(identity().renewal.profileDays)} ref={(value) => profileDays = value} />
              <IdentityInput label="BlahDeviceValidityDays" type="number" value={String(identity().renewal.deviceDays)} ref={(value) => deviceDays = value} />
              <Row>
                <Row.CheckboxFieldToggle><CheckboxField toggle checked={autoRenew()} onChange={setAutoRenew} disabled={busy()} /></Row.CheckboxFieldToggle>
                <Row.Title>{i18n('BlahAutoRenew')}</Row.Title>
              </Row>
              <p class={styles.footnote}>{i18n('BlahAutoRenewHelp')}</p>
              <Button primaryFilled disabled={busy()} text="Save" onClick={() => run({action: 'renewal', renewal: {
                profileDays: Number(profileDays.value), deviceDays: Number(deviceDays.value), autoRenew: autoRenew()
              }})} />
            </div>
          </details>
        </Section>
        <Section noShadow noMarginBottom>
          <details><summary>{i18n('Devices')}</summary>
            <For each={identity().devices}>{(entry) => <div class={styles.device}>
              <code class={styles.identifier} title={entry.id}>{entry.id}</code> {entry.current ? '(this device)' : ''}
              <p>{i18n('BlahDeviceExpires', [new Date(entry.expiresAt * 1000).toLocaleString()])}</p>
              <Button primaryTransparent disabled={busy()} onClick={() => { navigator.clipboard.writeText(encode(new Uint8Array(entry.key))).catch(() => setMessage('Clipboard unavailable.')); }} text="BlahCopyDeviceKey" />
              <Show when={!entry.current}><Button primaryTransparent disabled={busy()} onClick={() => {
                if(confirm('Revoke this device? Publish the new profile to apply the revocation.')) run({action: 'removeDevice', device: entry.id});
              }} text="BlahRevokeDevice" /></Show>
            </div>}</For>
            <IdentityInput label="BlahDeviceKey" ref={(value) => device = value} />
            <Button primaryTransparent disabled={busy()} onClick={() => run({action: 'addDevice', device: device.value})} text="BlahAuthorizeDevice" />
          </details>
        </Section>
        <Button primaryTransparent disabled={busy()} onClick={() => run({action: 'lock'})} text="BlahLockIdentity" />

        <p class={styles.footnote}>{i18n('BlahIdentityCustody')}</p>
      </Show>
    </fieldset>
    <p role="status">{busy() ? i18n('PleaseWait') : message()}</p>
  </div>;
}

export default function showIdentityDetails(props: DetailsProps) {
  createPopup(() => <PopupElement class={styles.setupPopup} closable>
    <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahIdentityDetails" /></PopupElement.Header>
    <PopupElement.Scrollable><PopupElement.Body class={styles.detailsBody}><IdentityDetails {...props} /></PopupElement.Body></PopupElement.Scrollable>
  </PopupElement>);
}
