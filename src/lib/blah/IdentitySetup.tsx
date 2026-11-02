import {createSignal, onCleanup, Show} from 'solid-js';
import Button from '@components/buttonTsx';
import PopupElement, {createPopup, usePopupContext} from '@components/popups/indexTsx';
import IdentityInput from '@lib/blah/IdentityInput';
import {splitWords, WordsEntry} from '@lib/blah/RecoveryWords';
import type {IdentityActions, IdentityView} from '@lib/blah/identity';
import styles from '@lib/blah/identity.module.scss';

if(import.meta.hot) import.meta.hot.accept();

/** Chat restore always derives the identity and enrolls a fresh local device. */
export default function showIdentitySetup(props: {action: IdentityActions, onIdentity: (identity: IdentityView) => void}) {
  function Content() {
    const popup = usePopupContext();
    const [domain, setDomain] = createSignal('');
    const [phrase, setPhrase] = createSignal('');
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal('');
    let closed = false;
    onCleanup(() => { closed = true; });
    async function submit() {
      if(busy()) return;
      setBusy(true); setError('');
      try {
        const {identity} = await props.action({action: 'restore', kind: 'channel', domain: domain(), phrase: phrase()});
        if(identity.kind !== 'channel') throw new Error('Enter a chat identity domain.');
        if(!closed) { props.onIdentity(identity); popup.hide(); }
      } catch(error) { if(!closed) setError((error as Error).message); }
      finally { if(!closed) setBusy(false); }
    }
    return <form class={styles.panel} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <IdentityInput label="BlahProfileDomain" value={domain()} onInput={setDomain} disabled={busy()} />
      <Show when={domain().trim()}><WordsEntry onPhrase={setPhrase} disabled={busy()} /></Show>
      <Button primaryFilled text="Continue" disabled={busy() || !domain().trim() || splitWords(phrase()).length !== 24} onClick={submit} />
      <p role="alert">{error()}</p>
    </form>;
  }
  createPopup(() => <PopupElement class={styles.setupPopup} closable>
    <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahRestoreChatIdentity" /></PopupElement.Header>
    <PopupElement.Scrollable><PopupElement.Body class={styles.setupBody}><Content /></PopupElement.Body></PopupElement.Scrollable>
  </PopupElement>);
}
