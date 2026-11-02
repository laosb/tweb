import {createSignal, onCleanup, onMount, Show, type JSX} from 'solid-js';
import Modes from '@config/modes';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';
import AuthCard from '@/pages/AuthCard';
import Button from '@components/buttonTsx';
import MediaHeader from '@components/mediaHeader';
import IdentityInput from '@lib/blah/IdentityInput';
import {HostedNameChoice, HostedNameChooser} from '@lib/blah/HostedNameChooser';
import {WordsDisplay, WordsEntry, WordsVerify, splitWords} from '@lib/blah/RecoveryWords';
import {exportProfile} from '@lib/blah/profileFiles';
import {profileDomain} from '@lib/blah/profile';
import type {IdentityActions, IdentityRequest, IdentityView} from '@lib/blah/identity';
import I18n, {i18n, type LangPackKey} from '@lib/langPack';
import styles from '@lib/blah/identity.module.scss';

function Card(props: {title: LangPackKey, children: JSX.Element}) {
  let panel: HTMLDivElement;
  onMount(() => {
    // Word components transfer focus themselves, including within popups.
    if(Modes.a11y && !panel.querySelector('ol, input[list]')) {
      const target = panel.querySelector<HTMLElement>('input:enabled, button:enabled');
      if(target) onCleanup(focusWhenSettled(target));
    }
  });
  return <AuthCard header={<MediaHeader><MediaHeader.Title tag="h1">{i18n(props.title)}</MediaHeader.Title></MediaHeader>}>
    <div ref={panel} class={styles.panel}>{props.children}</div>
  </AuthCard>;
}

export function BlahAddressCard(props: {creating: boolean, action: IdentityActions,
  onAddress: (domain: string, hosted?: IdentityRequest['hosted']) => void}) {
  const [domain, setDomain] = createSignal('');
  const [hosted, setHosted] = createSignal(false);
  const [hostingAvailable, setHostingAvailable] = createSignal(false);
  const [error, setError] = createSignal('');
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  onMount(() => { if(props.creating) void props.action({action: 'hostingCapability'}).then((result) => {
    if(!controller.signal.aborted) setHostingAvailable(result.hostingAvailable);
  }).catch(() => {}); });
  function submit() {
    try { props.onAddress(profileDomain(domain())); }
    catch(error) { setError((error as Error).message); }
  }
  return <Card title="BlahIdentityAddress">
    <Show when={hostingAvailable()}><HostedNameChoice hosted={hosted()} onChange={setHosted} /></Show>
    <Show when={!hosted()} fallback={<HostedNameChooser action={props.action} signal={controller.signal} addressOnly
      onIdentity={() => {}} onAddress={(domain, label) => props.onAddress(label + '.' + domain, {domain, label})} />}>
      <form class={styles.panel} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <IdentityInput label="BlahProfileDomain" onInput={setDomain} ref={(input) => input.dir = 'ltr'} />
        <Button primaryFilled text="Continue" disabled={!domain().trim()} onClick={submit} />
      </form>
    </Show>
    <p role="alert">{error()}</p>
  </Card>;
}

export function BlahWordsDisplayCard(props: {words: string[], onDone: () => void}) {
  return <Card title="BlahRecoveryWords"><WordsDisplay {...props} /></Card>;
}

export function BlahWordsVerifyCard(props: {words: string[], busy?: boolean, onVerified: () => void}) {
  return <Card title="BlahVerifyRecoveryWords"><WordsVerify {...props} /></Card>;
}

export function BlahWordsEntryCard(props: {busy: boolean, error: string, onPhrase: (phrase: string) => void}) {
  const [phrase, setPhrase] = createSignal('');
  return <Card title="BlahEnterRecoveryWords">
    <form class={styles.panel} onSubmit={(event) => { event.preventDefault(); props.onPhrase(phrase()); }}>
      <WordsEntry onPhrase={setPhrase} disabled={props.busy} />
      <Button primaryFilled text="Continue" disabled={props.busy || splitWords(phrase()).length !== 24} onClick={() => props.onPhrase(phrase())} />
      <p role="alert">{props.error}</p>
    </form>
  </Card>;
}

export function BlahPublicationCard(props: {identity: IdentityView, action: IdentityActions, onReady: () => Promise<void>, children?: JSX.Element}) {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  async function check() {
    if(busy()) return;
    setBusy(true); setError('');
    try {
      const {publication} = await props.action({action: 'publication'});
      if(publication.pending) throw new Error(I18n.format('BlahProfileNeedsPublication', true));
      if(!controller.signal.aborted) await props.onReady();
    } catch(error) { if(!controller.signal.aborted) setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <Card title="BlahSignIn">
    <Show when={props.identity.hostedNames && props.identity.publicationPending} fallback={<>
      <p>{i18n('BlahProfileHosting', [<code dir="ltr">{`https://${props.identity.domain}/.well-known/blah/profile.cbor`}</code> as HTMLElement])}</p>
      <Button text="BlahExportProfile" onClick={async() => {
        const {identity} = await props.action({action: 'inspect'});
        if(!controller.signal.aborted) exportProfile('profile.cbor', new Uint8Array(identity.profile));
      }} />
      <Button primaryFilled text="BlahSignIn" disabled={busy()} onClick={check} />
    </>}>
      <HostedNameChooser identity={props.identity} action={props.action} signal={controller.signal}
        onIdentity={() => {}} onComplete={props.onReady} />
    </Show>
    {props.children}
    <p role="alert">{error()}</p>
  </Card>;
}
