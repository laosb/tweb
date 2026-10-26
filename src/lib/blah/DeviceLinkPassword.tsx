import {createSignal, onCleanup, onMount} from 'solid-js';
import Button from '@components/buttonTsx';
import IdentityInput from '@lib/blah/IdentityInput';
import {deviceLinkMessage} from '@lib/blah/deviceLinkMessage';
import {i18n} from '@lib/langPack';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';
import styles from '@lib/blah/identity.module.scss';

export default function DeviceLinkPassword(props: {onSubmit: (password: string) => Promise<void>}) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  let password: HTMLInputElement;
  let closed = false;
  onCleanup(() => { closed = true; password.value = ''; });
  onMount(() => focusWhenSettled(password, () => !closed));
  const submit = async() => {
    if(busy() || !password.value) return;
    setBusy(true); setError('');
    const value = password.value;
    password.value = '';
    try { await props.onSubmit(value); }
    catch(error) { if(!closed) setError(deviceLinkMessage(error)); }
    finally { if(!closed) setBusy(false); }
  };
  return <form class={styles.panel} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <p>{i18n('BlahLinkLocalPassword')}</p>
    <IdentityInput label="BlahIdentityPassword" type="password" autocomplete="new-password" disabled={busy()} ref={(input) => password = input} />
    <Button primaryFilled text="BlahSignIn" disabled={busy()} onClick={submit} />
    <p role="status">{busy() ? i18n('PleaseWait') : error()}</p>
  </form>;
}
