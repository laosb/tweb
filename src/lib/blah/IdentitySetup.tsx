import {createSignal, onCleanup, onMount, Show} from 'solid-js';
import Button from '@components/buttonTsx';
import PopupElement, {createPopup, usePopupContext} from '@components/popups/indexTsx';
import {i18n} from '@lib/langPack';
import IdentityInput from '@lib/blah/IdentityInput';
import {HostedNameChoice, HostedNameChooser} from '@lib/blah/HostedNameChooser';
import BackupDropzone from '@lib/blah/BackupDropzone';
import type {IdentityActions} from '@lib/blah/IdentityPanel';
import type {IdentityKind, IdentityView} from '@lib/blah/identity';
import styles from '@lib/blah/identity.module.scss';

type IdentitySetupProps = {
  signal?: AbortSignal,
  mode: 'create' | 'import' | 'paper',
  kind?: IdentityKind,
  action: IdentityActions,
  onIdentity: (identity: IdentityView) => void
};

function SetupForm(props: IdentitySetupProps) {
  const popup = usePopupContext();
  const [hostingAvailable, setHostingAvailable] = createSignal(false);
  const [hosted, setHosted] = createSignal(false);
  const [created, setCreated] = createSignal<IdentityView>();
  onMount(() => {
    if(props.mode === 'create' && props.kind !== 'channel') {
      void props.action({action: 'hostingCapability'}).then((result) => setHostingAvailable(!!result.hostingAvailable)).catch(() => {});
    }
  });
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [file, setFile] = createSignal<File>();
  const [hasPassword, setHasPassword] = createSignal(false);
  const [profileDomain, setProfileDomain] = createSignal('');
  const [phrase, setPhrase] = createSignal('');
  let password: HTMLInputElement;
  let domain: HTMLInputElement;
  let cancelled = false;
  onCleanup(() => { cancelled = true; });

  async function submit() {
    if(busy() || cancelled || hosted()) return;
    const importing = props.mode === 'import';
    if(importing && (!file() || !password.value)) return;
    if(importing && file().size > 262_144) {
      setError('Choose a Blah identity file under 256 KiB.');
      return;
    }
    setBusy(true); setError('');
    try {
      const result = await props.action(importing ?
        {action: 'restore', password: password.value, backup: Array.from(new Uint8Array(await file().arrayBuffer()))} :
        props.mode === 'paper' ? {action: 'paper', password: password.value, domain: domain.value, phrase: phrase()} :
        {action: 'create', password: password.value, domain: domain.value});
      if(cancelled) return;
      props.onIdentity(result.identity);
      popup.hide();
    } catch(cause) {
      const error = cause as {type?: string, message?: string};
      if(!cancelled) setError(error.type || error.message || 'Identity operation failed.');
    } finally {
      setBusy(false);
    }
  }
  return <form class={styles.panel} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <Show when={hostingAvailable()}>
      <HostedNameChoice hosted={hosted()} disabled={busy() || !!created()} onChange={setHosted} />
    </Show>
    <fieldset disabled={busy() || !!created()}>
      <Show when={props.mode !== 'import'} fallback={<>
        <BackupDropzone disabled={busy()} onFile={(value) => {
          setFile(value); setError('');
        }} />
        <p role="status">{file()?.name}</p>
      </>}>
        <Show when={!hosted()}><IdentityInput label="BlahProfileDomain" onInput={setProfileDomain} ref={(value) => domain = value} /></Show>
      </Show>
      <Show when={props.mode === 'paper'}>
        <IdentityInput label="BlahPaperKeyWords" onInput={(value) => { setPhrase(value); setError(''); }} />
        <p class={styles.footnote}>{i18n(props.kind === 'channel' ? 'BlahUseChatPaperKeyHelp' : 'BlahUsePaperKeyHelp')}</p>
      </Show>
      <IdentityInput label="BlahIdentityPassword" type="password"
        autocomplete={props.mode === 'import' ? 'current-password' : 'new-password'}
        onInput={(value) => { setHasPassword(!!value); setError(''); }} ref={(value) => password = value} />
      <Show when={!hosted()}><Button primaryFilled disabled={busy() || (props.mode === 'import' && (!file() || !hasPassword())) ||
        (props.mode === 'paper' && (!phrase().trim() || !profileDomain().trim() || !hasPassword()))}
        onClick={() => submit()} text={title(props)} /></Show>
      <p class={styles.footnote}>{i18n('BlahIdentityCustody')}</p>
      <Show when={props.mode === 'create' && !hosted()}>
        <p class={styles.footnote}>{i18n('BlahProfileHosting', [
          <code>{`https://${profileDomain().trim().toLowerCase() || 'your-domain'}/.well-known/blah/profile.cbor`}</code> as HTMLElement
        ])}</p>
      </Show>
    </fieldset>
    <Show when={hosted()}>
      <HostedNameChooser action={props.action} signal={props.signal} disabled={!hasPassword()} onBusy={setBusy}
        prepare={async(domain, label) => (await props.action({action: 'create', password: password.value,
          domain: label + '.' + domain, hosted: {domain, label}})).identity}
        onIdentity={(identity) => { setCreated(identity); props.onIdentity(identity); }} onComplete={() => popup.hide()} />
    </Show>
    <p role="status">{busy() ? i18n('PleaseWait') : error()}</p>
  </form>;
}

function title({mode, kind}: IdentitySetupProps) {
  return mode === 'create' ? 'BlahCreateIdentity' : mode === 'paper' ? kind === 'channel' ? 'BlahUseChatPaperKey' : 'BlahUsePaperKey' : 'BlahImportIdentity';
}

export default function showIdentitySetup(props: IdentitySetupProps) {
  let created: IdentityView;
  const controller = new AbortController();
  createPopup(() => <PopupElement class={styles.setupPopup} closable onClose={() => controller.abort()}
    onCloseAfterTimeout={() => { if(created) props.onIdentity(created); }}>
    <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title={title(props)} /></PopupElement.Header>
    <PopupElement.Scrollable><PopupElement.Body class={styles.setupBody}><SetupForm {...props} signal={controller.signal} onIdentity={(identity) => created = identity} /></PopupElement.Body></PopupElement.Scrollable>
  </PopupElement>);
}
