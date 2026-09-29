import {createSignal, onCleanup, onMount} from 'solid-js';
import Button from '@components/buttonTsx';
import InputField, {InputState} from '@components/inputField';
import MediaHeader from '@components/mediaHeader';
import {blahStartupErrors} from '@config/blah';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import apiManagerProxy from '@lib/apiManagerProxy';
import {connectDC, savedDC} from '@lib/blah/discovery';
import {i18n} from '@lib/langPack';
import AuthCard from '@/pages/AuthCard';
import styles from '@/pages/authFlow.module.scss';

/** The first Blah sign-in step; all presentation comes from the auth components. */
export default function HomeDCCard() {
  const slot = getCurrentAccount();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal(blahStartupErrors.get(slot) || '');
  let cancelled = false;
  let form: HTMLFormElement;
  const field = new InputField({
    label: 'BlahDCDomain', plainText: true, name: 'dc-domain', required: true,
    autocomplete: 'url',
    onRawInput: () => { field.setState(InputState.Neutral); setError(''); }
  });
  const input = field.input as HTMLInputElement;
  input.autocapitalize = 'none';
  input.spellcheck = false;
  input.placeholder = 'dc.example.org';
  input.setAttribute('aria-describedby', 'blah-dc-status');

  onMount(() => {
    void savedDC(slot).then((saved) => {
      if(cancelled) return;
      field.value = saved?.domain || new URL(location.href).searchParams.get('dc') || '';
      setError(blahStartupErrors.get(slot) || '');
    }).catch((error) => { if(!cancelled) setError(String(error)); });
  });
  const cancelFocus = focusWhenSettled(input, () =>
    document.activeElement === document.body || document.activeElement === input);
  onCleanup(() => { cancelled = true; cancelFocus(); });

  async function connect(event: SubmitEvent) {
    event.preventDefault();
    if(busy()) return;
    setBusy(true);
    setError('');
    input.readOnly = true;
    try {
      await connectDC(field.value, slot);
      // Other tabs must join the new worker/profile set before this slot signs in.
      if(!cancelled) apiManagerProxy.reloadAll();
    } catch(error) {
      if(cancelled) return;
      setError(error instanceof Error ? error.message : String(error));
      field.setState(InputState.Error);
      input.focus();
    } finally {
      if(!cancelled) { setBusy(false); input.readOnly = false; }
    }
  }

  return <AuthCard inputWrapper={false} header={<MediaHeader>
    <MediaHeader.Title>{i18n('BlahDCConnect')}</MediaHeader.Title>
    <MediaHeader.Subtitle>{i18n('BlahDCDescription')}</MediaHeader.Subtitle>
  </MediaHeader>}>
    <form ref={form} class="input-wrapper" onSubmit={connect} aria-busy={busy()}>
      {field.container}
      <div id="blah-dc-status" class={styles.errorLabel} role="status">
        {busy() ? i18n('BlahDCLoading') : error()}
      </div>
      <Button onClick={() => form.requestSubmit()}
        class="btn-primary btn-color-primary" disabled={busy()} text="BlahDCConnect" />
    </form>
  </AuthCard>;
}
