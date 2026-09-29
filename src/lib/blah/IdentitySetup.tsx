import {createSignal, onCleanup, Show} from 'solid-js';
import Button from '@components/buttonTsx';
import PopupElement, {createPopup, usePopupContext} from '@components/popups/indexTsx';
import {i18n} from '@lib/langPack';
import IdentityInput from '@lib/blah/IdentityInput';
import BackupDropzone from '@lib/blah/BackupDropzone';
import type {IdentityActions} from '@lib/blah/IdentityPanel';
import type {IdentityView} from '@lib/blah/identity';
import styles from '@lib/blah/identity.module.scss';

type IdentitySetupProps = {
  mode: 'create' | 'import',
  action: IdentityActions,
  onIdentity: (identity: IdentityView) => void
};

function SetupForm(props: IdentitySetupProps) {
  const popup = usePopupContext();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [file, setFile] = createSignal<File>();
  const [hasPassword, setHasPassword] = createSignal(false);
  const [profileDomain, setProfileDomain] = createSignal('');
  let password: HTMLInputElement;
  let domain: HTMLInputElement;
  let cancelled = false;
  onCleanup(() => { cancelled = true; });

  async function submit() {
    if(busy() || cancelled) return;
    const importing = props.mode === 'import';
    if(importing && (!file() || !password.value)) return;
    if(importing && file().size > 600_000) {
      setError('Choose a Blah identity file under 600 KB.');
      return;
    }
    setBusy(true); setError('');
    try {
      const result = await props.action(importing ?
        {action: 'restore', password: password.value, backup: await file().text()} :
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
    <fieldset disabled={busy()}>
      <Show when={props.mode === 'create'} fallback={<>
        <BackupDropzone disabled={busy()} onFile={(value) => {
          setFile(value); setError('');
        }} />
        <p role="status">{file()?.name}</p>
      </>}>
        <IdentityInput label="BlahProfileDomain" onInput={setProfileDomain} ref={(value) => domain = value} />
      </Show>
      <IdentityInput label="BlahIdentityPassword" type="password"
        autocomplete={props.mode === 'create' ? 'new-password' : 'current-password'}
        onInput={(value) => { setHasPassword(!!value); setError(''); }} ref={(value) => password = value} />
      <Button primaryFilled disabled={busy() || (props.mode === 'import' && (!file() || !hasPassword()))}
        onClick={() => submit()} text={props.mode === 'create' ? 'BlahCreateIdentity' : 'BlahImportIdentity'} />
      <p class={styles.footnote}>{i18n('BlahIdentityCustody')}</p>
      <Show when={props.mode === 'create'}>
        <p class={styles.footnote}>{i18n('BlahProfileHosting', [
          <code>{`https://${profileDomain().trim().toLowerCase() || 'your-domain'}/.well-known/blah/profile.cbor`}</code> as HTMLElement
        ])}</p>
      </Show>
    </fieldset>
    <p role="status">{busy() ? i18n('PleaseWait') : error()}</p>
  </form>;
}

export default function showIdentitySetup(props: IdentitySetupProps) {
  let created: IdentityView;
  createPopup(() => <PopupElement class={styles.setupPopup} closable
    onCloseAfterTimeout={() => { if(created) props.onIdentity(created); }}>
    <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title={props.mode === 'create' ? 'BlahCreateIdentity' : 'BlahImportIdentity'} /></PopupElement.Header>
    <PopupElement.Scrollable><PopupElement.Body class={styles.setupBody}><SetupForm {...props} onIdentity={(identity) => created = identity} /></PopupElement.Body></PopupElement.Scrollable>
  </PopupElement>);
}
