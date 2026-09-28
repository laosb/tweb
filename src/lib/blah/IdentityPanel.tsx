import {createSignal, For, Show, onMount} from 'solid-js';
import type {IdentityRequest, IdentityResponse, IdentityView} from '@lib/blah/identity';
import {encode} from '@lib/blah/vault';
import createDownloadAnchor from '@helpers/dom/createDownloadAnchor';
import {ObjectURLScope} from '@helpers/objectUrl';
import styles from '@lib/blah/identity.module.scss';

export type IdentityActions = (request: IdentityRequest) => Promise<IdentityResponse>;

export default function IdentityPanel(props: {action: IdentityActions, onIdentity?: (identity: IdentityView) => void}) {
  const [ids, setIDs] = createSignal<string[]>([]);
  const [selected, setSelected] = createSignal('');
  const [identity, setIdentity] = createSignal<IdentityView>();
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal('');
  let password: HTMLInputElement;
  let domain: HTMLInputElement;
  let publisher: HTMLInputElement;
  let token: HTMLInputElement;
  let device: HTMLInputElement;
  let backup: HTMLInputElement;

  const refresh = async() => setIDs((await props.action({action: 'list'})).ids);
  onMount(() => { refresh().catch((error) => setMessage(error.message)); });

  function download(name: string, bytes: BlobPart, type: string) {
    const urls = new ObjectURLScope();
    const url = urls.create(new Blob([bytes], {type}));
    createDownloadAnchor(url, name, () => setTimeout(() => urls.dispose(), 30_000));
  }

  async function run(request: IdentityRequest) {
    if(busy()) return;
    setBusy(true); setMessage('');
    try {
      const result = await props.action({...request, id: selected(), password: password.value});
      password.value = '';
      if(result.identity) {
        setIdentity(result.identity);
        setSelected(result.identity.id);
        props.onIdentity?.(result.identity);
        await refresh();
        setMessage('Identity ready. Publish its latest profile before signing in.');
      }
      if(result.backup) download(`${identity().domain}-identity.json`, result.backup, 'application/json');
      if(request.action === 'lock') { setIdentity(undefined); props.onIdentity?.(undefined); }
    } catch(cause) {
      const error = cause as {type?: string, message?: string};
      setMessage(error.type || error.message || 'Identity operation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    const file = backup.files?.[0];
    if(!file || file.size > 600_000) { setMessage('Choose a Blah identity backup under 600 KB.'); return; }
    await run({action: 'restore', backup: await file.text()});
  }

  return <section class={styles.panel} aria-label="Browser identities">
    <p>Your keys stay in this browser. Save an encrypted backup and keep its password safe.</p>
    <fieldset disabled={busy()}>
      <label>Saved identity<select aria-label="Saved identity" value={selected()} onChange={(event) => setSelected(event.currentTarget.value)}>
        <option value="">Choose an identity</option>
        <For each={ids()}>{(id) => <option value={id}>{id}</option>}</For>
      </select></label>
      <label>Identity password<input ref={password} type="password" autocomplete="current-password" minlength="12" /></label>
      <button type="button" disabled={!selected()} onClick={() => run({action: 'unlock'})}>Unlock identity</button>
      <details><summary>Create or restore an identity</summary>
        <label>Profile domain<input ref={domain} placeholder="me.example.org" autocomplete="off" /></label>
        <p>Serve the downloaded profile at https://your-domain/.well-known/blah/profile.cbor.</p>
        <button type="button" onClick={() => run({action: 'create', domain: domain.value})}>Create identity</button>
        <label>Encrypted backup<input ref={backup} type="file" accept="application/json,.json" /></label>
        <button type="button" onClick={restore}>Restore backup</button>
      </details>
      <Show when={identity()}>{(current) => <>
        <p><strong>{current().domain}</strong><br />Profile expires {new Date(current().expiresAt * 1000).toLocaleString()}</p>
        <p class={styles.identifier}>Identity: {current().id}</p>
        <button type="button" onClick={() => download('profile.cbor', new Uint8Array(current().profile), 'application/cbor')}>Download public profile</button>
        <button type="button" onClick={() => run({action: 'backup'})}>Download encrypted backup</button>
        <button type="button" onClick={() => run({action: 'inspect'})}>Refresh profile</button>
        <button type="button" onClick={() => run({action: 'renew'})}>Renew profile and certificates</button>
        <details><summary>Profile publishing</summary>
          <p>Optional: send only the public profile to an HTTPS endpoint you control. It must accept PUT and allow this site's origin.</p>
          <label>Publication URL<input ref={publisher} type="url" value={current().publisher} placeholder="https://…" /></label>
          <label>Publication token<input ref={token} type="password" autocomplete="off" /></label>
          <button type="button" onClick={() => run({action: 'publisher', publisher: publisher.value, token: token.value})}>Save and publish profile</button>
        </details>
        <details><summary>Devices</summary>
          <For each={current().devices}>{(entry) => <div class={styles.device}>
            <code>{entry.id}</code> {entry.current ? '(this device)' : ''}
            <button type="button" onClick={() => { navigator.clipboard.writeText(encode(new Uint8Array(entry.key))).catch(() => setMessage('Clipboard unavailable.')); }}>Copy public device key</button>
            <Show when={!entry.current}><button type="button" onClick={() => {
              if(confirm('Revoke this device? Publish the new profile to apply the revocation.')) run({action: 'removeDevice', device: entry.id});
            }}>Revoke device</button></Show>
          </div>}</For>
          <label>Public device key (base64)<input ref={device} autocomplete="off" /></label>
          <button type="button" onClick={() => run({action: 'addDevice', device: device.value})}>Authorize device</button>
        </details>
        <button type="button" onClick={() => run({action: 'lock'})}>Lock identity</button>
      </>}</Show>
    </fieldset>
    <p role="status" aria-live="polite">{busy() ? 'Working…' : message()}</p>
  </section>;
}
