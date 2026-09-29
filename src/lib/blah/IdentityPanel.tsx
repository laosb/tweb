import {createSignal, For, Show, onMount, onCleanup, createEffect, JSX} from 'solid-js';
import Button from '@components/buttonTsx';
import IdentityPicker from '@lib/blah/IdentityPicker';
import IdentityInput from '@lib/blah/IdentityInput';
import showIdentitySetup from '@lib/blah/IdentitySetup';
import I18n, {i18n} from '@lib/langPack';
import type {IdentityRequest, IdentityResponse, IdentityView} from '@lib/blah/identity';
import {encode} from '@lib/blah/vault';
import createDownloadAnchor from '@helpers/dom/createDownloadAnchor';
import {ObjectURLScope} from '@helpers/objectUrl';
import styles from '@lib/blah/identity.module.scss';

export type IdentityActions = (request: IdentityRequest) => Promise<IdentityResponse>;

export default function IdentityPanel(props: {
  action: IdentityActions,
  onIdentity?: (identity: IdentityView) => void,
  onSignIn?: (identity: IdentityView) => Promise<void>,
  children?: JSX.Element
}) {
  const [ids, setIDs] = createSignal<string[]>([]);
  const [selected, setSelected] = createSignal('');
  const [identity, setIdentity] = createSignal<IdentityView>();
  const [busy, setBusy] = createSignal(false);
  const [signingIn, setSigningIn] = createSignal(false);
  const [message, setMessage] = createSignal('');
  let password: HTMLInputElement;
  let publisher: HTMLInputElement;
  let token: HTMLInputElement;
  let device: HTMLInputElement;
  let cancelled = false;

  const picker = new IdentityPicker({label: 'BlahSavedIdentity',
    onRawInput: () => {
      setSelected(''); setIdentity(undefined); props.onIdentity?.(undefined);
    }
  }, (id) => {
    if(id === 'create' || id === 'import') {
      picker.setValueSilently(selected());
      showIdentitySetup({mode: id, action: props.action, onIdentity: acceptIdentity});
      return;
    }
    setSelected(id);
    setIdentity(undefined);
    props.onIdentity?.(undefined);
    password.value = '';
  });
  createEffect(() => picker.setOptions([...ids().map((id) => ({
    value: id, label: id, matches: (query: string) => id.toLowerCase().includes(query.toLowerCase())
  })), ...(['create', 'import'] as const).map((mode) => ({
    value: mode,
    label: I18n.format(mode === 'create' ? 'BlahCreateIdentity' : 'BlahImportIdentity', true),
    matches: () => true
  }))]));
  createEffect(() => picker.setDisabled(busy()));
  onCleanup(() => { cancelled = true; picker.destroy(); });

  function acceptIdentity(current: IdentityView) {
    setIdentity(current);
    setSelected(current.id);
    picker.setValueSilently(current.id);
    props.onIdentity?.(current);
    setIDs((ids) => ids.includes(current.id) ? ids : [...ids, current.id]);
    setMessage('Identity ready. Publish its latest profile before signing in.');
  }

  const refresh = async() => setIDs((await props.action({action: 'list'})).ids);
  onMount(() => { refresh().catch((error) => setMessage(error.message)); });

  function download(name: string, bytes: BlobPart, type: string) {
    const urls = new ObjectURLScope();
    const url = urls.create(new Blob([bytes], {type}));
    createDownloadAnchor(url, name, () => setTimeout(() => urls.dispose(), 30_000));
  }

  async function run(request?: IdentityRequest) {
    if(busy() || !selected()) return;
    setBusy(true); setMessage('');
    setSigningIn(!request);
    try {
      const result = !request && identity() ? {identity: identity()} :
        await props.action({action: 'unlock', ...request, id: selected(), password: password.value});
      if(cancelled) return;
      password.value = '';
      if(result.identity) {
        acceptIdentity(result.identity);
      }
      if(result.backup) download(`${identity().domain}-identity.json`, result.backup, 'application/json');
      if(request?.action === 'lock') { setIdentity(undefined); props.onIdentity?.(undefined); }
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
      {picker.container}
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
      <Show when={identity()}>{(current) => <>
        <p><strong>{current().domain}</strong><br />Profile expires {new Date(current().expiresAt * 1000).toLocaleString()}</p>
        <p class={styles.identifier}>Identity: {current().id}</p>
        <Button primaryTransparent disabled={busy()} onClick={() => download('profile.cbor', new Uint8Array(current().profile), 'application/cbor')} text="BlahDownloadProfile" />
        <Button primaryTransparent disabled={busy()} onClick={() => run({action: 'backup'})} text="BlahDownloadBackup" />
        <Button primaryTransparent disabled={busy()} onClick={() => run({action: 'inspect'})} text="BlahRefreshProfile" />
        <Button primaryTransparent disabled={busy()} onClick={() => run({action: 'renew'})} text="BlahRenewProfile" />
        <details><summary>Profile publishing</summary>
          <p>Optional: send only the public profile to an HTTPS endpoint you control. It must accept PUT and allow this site's origin.</p>
          <IdentityInput label="BlahPublicationURL" type="url" value={current().publisher} ref={(value) => publisher = value} />
          <IdentityInput label="BlahPublicationToken" type="password" ref={(value) => token = value} />
          <Button primaryTransparent disabled={busy()} onClick={() => run({action: 'publisher', publisher: publisher.value, token: token.value})} text="BlahPublishProfile" />
        </details>
        <details><summary>Devices</summary>
          <For each={current().devices}>{(entry) => <div class={styles.device}>
            <code>{entry.id}</code> {entry.current ? '(this device)' : ''}
            <Button primaryTransparent disabled={busy()} onClick={() => { navigator.clipboard.writeText(encode(new Uint8Array(entry.key))).catch(() => setMessage('Clipboard unavailable.')); }} text="BlahCopyDeviceKey" />
            <Show when={!entry.current}><Button primaryTransparent disabled={busy()} onClick={() => {
              if(confirm('Revoke this device? Publish the new profile to apply the revocation.')) run({action: 'removeDevice', device: entry.id});
            }} text="BlahRevokeDevice" /></Show>
          </div>}</For>
          <IdentityInput label="BlahDeviceKey" ref={(value) => device = value} />
          <Button primaryTransparent disabled={busy()} onClick={() => run({action: 'addDevice', device: device.value})} text="BlahAuthorizeDevice" />
        </details>
        <Button primaryTransparent disabled={busy()} onClick={() => run({action: 'lock'})} text="BlahLockIdentity" />
      </>}</Show>
      {props.children}
      <Show when={props.onSignIn}>
        <Button primaryFilled disabled={!selected() || busy()} onClick={() => run()} text={signingIn() ? 'BlahSigningIn' : 'BlahSignIn'} />
      </Show>
      <Show when={!props.onSignIn}><p class={styles.footnote}>{i18n('BlahIdentityCustody')}</p></Show>
    </fieldset>
    <p role="status" aria-live="polite">{busy() ? 'Working…' : message()}</p>
  </section>;
}
