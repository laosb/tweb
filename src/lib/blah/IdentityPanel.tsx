import {createSignal, Show, onMount, onCleanup, createEffect, JSX} from 'solid-js';
import Button from '@components/buttonTsx';
import IdentityPicker from '@lib/blah/IdentityPicker';
import IdentityInput from '@lib/blah/IdentityInput';
import showIdentitySetup from '@lib/blah/IdentitySetup';
import I18n, {i18n} from '@lib/langPack';
import type {IdentityRequest, IdentityResponse, IdentitySummary, IdentityView} from '@lib/blah/identity';
import showIdentityDetails from '@lib/blah/IdentityDetails';
import styles from '@lib/blah/identity.module.scss';

export type IdentityActions = (request: IdentityRequest) => Promise<IdentityResponse>;

export default function IdentityPanel(props: {
  action: IdentityActions,
  onIdentity?: (identity: IdentityView) => void,
  onSignIn?: (identity: IdentityView) => Promise<void>,
  children?: JSX.Element
}) {
  const [identities, setIdentities] = createSignal<IdentitySummary[]>([]);
  const [selected, setSelected] = createSignal('');
  const [identity, setIdentity] = createSignal<IdentityView>();
  const [busy, setBusy] = createSignal(false);
  const [signingIn, setSigningIn] = createSignal(false);
  const [message, setMessage] = createSignal('');
  let password: HTMLInputElement;
  let detailsButton: HTMLElement;
  let cancelled = false;

  const picker = new IdentityPicker({label: 'BlahSavedIdentity',
    onRawInput: () => {
      setSelected(''); setIdentity(undefined); props.onIdentity?.(undefined);
    }
  }, (id) => {
    if(id === 'create' || id === 'import') {
      picker.setValueSilently(selectedLabel());
      showIdentitySetup({mode: id, action: props.action, onIdentity: (current) => {
        if(cancelled) return;
        acceptIdentity(current);
        if(id === 'create') queueMicrotask(() => { if(!cancelled) openDetails(); });
      }});
      return;
    }
    setSelected(id);
    setIdentity(undefined);
    props.onIdentity?.(undefined);
    if(password) password.value = '';
  });
  createEffect(() => picker.setOptions([...identities().map((entry) => ({
    value: entry.id, label: identityLabel(entry), matches: (query: string) => `${entry.domain || ''} ${entry.id}`.toLowerCase().includes(query.toLowerCase())
  })), ...(['create', 'import'] as const).map((mode) => ({
    value: mode,
    icon: mode === 'create' ? 'adduser' as const : 'document' as const,
    label: I18n.format(mode === 'create' ? 'BlahCreateIdentity' : 'BlahImportIdentity', true),
    matches: () => true
  }))]));
  createEffect(() => picker.setDisabled(busy()));
  onCleanup(() => { cancelled = true; picker.destroy(); });

  function identityLabel(entry: IdentitySummary) {
    return entry.domain ? `${entry.domain} - ${entry.id.slice(0, 6)}` : entry.id.slice(0, 6);
  }
  const selectedSummary = () => identities().find((entry) => entry.id === selected());
  const selectedLabel = () => selectedSummary() ? identityLabel(selectedSummary()) : '';
  function openDetails() {
    detailsButton?.focus();
    picker.hidePicker();
    showIdentityDetails({summary: selectedSummary(), identity: identity(), action: props.action, onIdentity: (current) => {
      if(cancelled) return;
      if(current) acceptIdentity(current);
      else { setIdentity(undefined); props.onIdentity?.(undefined); }
    }});
  }

  function acceptIdentity(current: IdentityView) {
    setIdentity(current);
    setSelected(current.id);
    picker.setValueSilently(identityLabel({id: current.id, domain: current.domains[0]}));
    props.onIdentity?.(current);
    setIdentities((entries) => [...entries.filter((entry) => entry.id !== current.id), {id: current.id, domain: current.domains[0]}]);
  }

  const refresh = async() => {
    const result = await props.action({action: 'list'});
    if(!cancelled) setIdentities(result.identities || result.ids.map((id) => ({id})));
  };
  onMount(() => { refresh().catch((error) => setMessage(error.message)); });

  async function run(request?: IdentityRequest) {
    if(busy() || !selected()) return;
    setBusy(true); setMessage('');
    setSigningIn(!request);
    try {
      const result = !request && identity() ? {identity: identity()} :
        await props.action({action: 'unlock', ...request, id: selected(), password: password?.value});
      if(cancelled) return;
      if(password) password.value = '';
      if(result.identity) {
        acceptIdentity(result.identity);
      }
      if(!request) await props.onSignIn(result.identity);
    } catch(cause) {
      const error = cause as {type?: string, message?: string};
      setMessage(error.type || error.message || 'Identity operation failed.');
    } finally {
      setBusy(false);
      setSigningIn(false);
    }
  }

  return <section class={styles.panel} aria-label="Browser identities">
    <fieldset disabled={busy()}>
      <div class={styles.pickerRow}>
        {picker.container}
        <Show when={selected()}><Button.Icon ref={(element) => detailsButton = element} icon="info" disabled={busy()} aria-label={I18n.format('BlahIdentityDetails', true)} onClick={openDetails} /></Show>
      </div>
      <Show when={!identity()}>
        <IdentityInput label="BlahIdentityPassword" type="password" autocomplete="current-password" ref={(value) => {
          password = value;
          value.addEventListener('keydown', (event) => {
            if(event.key === 'Enter' && !event.isComposing) {
              event.preventDefault();
              void run(props.onSignIn ? undefined : {action: 'unlock'});
            }
          });
        }} />
        <Show when={!props.onSignIn}>
          <Button primaryFilled disabled={!selected() || busy()} onClick={() => run({action: 'unlock'})} text="BlahUnlockIdentity" />
        </Show>
      </Show>
      {props.children}
      <Show when={props.onSignIn}>
        <Button primaryFilled disabled={!selected() || busy()} onClick={() => run()} text={signingIn() ? 'BlahSigningIn' : 'BlahSignIn'} />
      </Show>
      <Show when={!props.onSignIn}><p class={styles.footnote}>{i18n('BlahIdentityCustody')}</p></Show>
    </fieldset>
    <p role="status" aria-live="polite">{busy() ? 'Working…' : message()}</p>
  </section>;
}
