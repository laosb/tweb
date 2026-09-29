import {createSignal} from 'solid-js';
import Button from '@components/buttonTsx';
import PopupElement, {createPopup, usePopupContext} from '@components/popups/indexTsx';
import {i18n} from '@lib/langPack';
import IdentityInput from '@lib/blah/IdentityInput';
import BackupDropzone from '@lib/blah/BackupDropzone';
import type {IdentityActions} from '@lib/blah/IdentityPanel';
import type {IdentityView} from '@lib/blah/identity';
import styles from '@lib/blah/identity.module.scss';

function SetupForm(props: {action: IdentityActions, onIdentity: (identity: IdentityView) => void}) {
  const popup = usePopupContext();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [file, setFile] = createSignal<File>();
  let password: HTMLInputElement;
  let domain: HTMLInputElement;
  async function submit(restore: boolean) {
    if(busy()) return;
    if(restore && (!file() || file().size > 600_000)) {
      setError('Choose a Blah identity backup under 600 KB.');
      return;
    }
    setBusy(true); setError('');
    try {
      const result = await props.action(restore ?
        {action: 'restore', password: password.value, backup: await file().text()} :
        {action: 'create', password: password.value, domain: domain.value});
      props.onIdentity(result.identity);
      popup.hide();
    } catch(cause) {
      const error = cause as {type?: string, message?: string};
      setError(error.type || error.message || 'Identity operation failed.');
    } finally {
      setBusy(false);
    }
  }
  return <div class={styles.panel}>
    <p>{i18n('BlahIdentityCustody')}</p>
    <fieldset disabled={busy()}>
      <IdentityInput label="BlahIdentityPassword" type="password" autocomplete="new-password" ref={(value) => password = value} />
      <IdentityInput label="BlahProfileDomain" ref={(value) => domain = value} />
      <p>{i18n('BlahProfileHosting')}</p>
      <Button primaryFilled disabled={busy()} onClick={() => submit(false)} text="BlahCreateIdentity" />
      <BackupDropzone disabled={busy()} onFile={(value) => { setFile(value); setError(''); }} />
      <p role="status">{file()?.name}</p>
      <Button primaryTransparent disabled={busy() || !file()} onClick={() => submit(true)} text="BlahRestoreBackup" />
    </fieldset>
    <p role="status">{busy() ? i18n('PleaseWait') : error()}</p>
  </div>;
}

export default function showIdentitySetup(props: {action: IdentityActions, onIdentity: (identity: IdentityView) => void}) {
  createPopup(() => <PopupElement class={styles.setupPopup} closable>
    <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahIdentitySetup" /></PopupElement.Header>
    <PopupElement.Scrollable><PopupElement.Body class={styles.setupBody}><SetupForm {...props} /></PopupElement.Body></PopupElement.Scrollable>
  </PopupElement>);
}
