import {batch, createEffect, createSignal, onCleanup, onMount, Show} from 'solid-js';
import confirmationPopup from '@components/confirmationPopup';
import Modes from '@config/modes';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';
import Button from '@components/buttonTsx';
import MediaHeader from '@components/mediaHeader';
import blah, {getBlahConfig} from '@config/blah';
import HomeDCCard from '@lib/blah/HomeDCCard';
import IdentityInput from '@lib/blah/IdentityInput';

import type {IdentityRequest, IdentityView} from '@lib/blah/identity';
import {isManagedAccountToken} from '@lib/blah/managedAccount';
import identityStyles from '@lib/blah/identity.module.scss';
import I18n, {LangPackKey} from '@lib/langPack';
import AuthCard from '@/pages/AuthCard';
import {useAuthFlow} from '@/pages/authFlow';
import requestLoginCode from '@/pages/requestLoginCode';
import styles from '@/pages/authFlow.module.scss';
import {BlahAddressCard, BlahWordsDisplayCard, BlahWordsVerifyCard, BlahWordsEntryCard, BlahPublicationCard} from '@/pages/cards/BlahIdentityCards';

function tokenError(error: {type?: string, message?: string}): LangPackKey | undefined {
  const code = error.type || error.message;
  if(code === 'ACCESS_TOKEN_INVALID' || code === 'ACCESS_TOKEN_EXPIRED') return 'BlahManagedAccountTokenInvalid';
  if(code === 'MANAGED_ACCOUNT_REQUIRED') return 'BlahManagedAccountRequired';
  if(code?.startsWith('USER_MIGRATE_')) return 'BlahManagedAccountOtherHome';
}

export default function BlahSignInCard() {
  const flow = useAuthFlow();
  if(blah?.discovery && !getBlahConfig(flow.accountNumber)?.home) return <HomeDCCard />;
  const [error, setError] = createSignal('');
  const [needsEmail, setNeedsEmail] = createSignal(false);
  const [useToken, setUseToken] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [step, setStep] = createSignal<'entry' | 'address' | 'display' | 'verify' | 'words' | 'publication'>('entry');
  const [unfinished, setUnfinished] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [words, setWords] = createSignal<string[]>();
  const [identity, setIdentity] = createSignal<IdentityView>();
  let domain: string;
  let hosted: IdentityRequest['hosted'];
  const action = (request: IdentityRequest) => flow.managers.appAccountManager.blahIdentity(request);
  onMount(() => { void action({action: 'inspect'}).then((result) => {
    if(!cancelled && result.identity) { setIdentity(result.identity); setUnfinished(result.unfinished); setStep('publication'); }
  }).catch(() => {}); });
  async function address(value: string, name?: IdentityRequest['hosted']) {
    if(busy()) return;
    domain = value; hosted = name; setError('');
    if(!creating()) { setStep('words'); return; }
    setBusy(true);
    try {
      const result = await action({action: 'generateWords'});
      if(!cancelled) { setWords(result.words); setStep('display'); }
    } catch(error) { if(!cancelled) setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function enroll(phrase: string) {
    if(busy()) return;
    setBusy(true); setError('');
    try {
      const result = await action({action: creating() ? 'create' : 'restore', domain, hosted, phrase});
      if(cancelled) return;
      batch(() => { setStep('publication'); setIdentity(result.identity); setUnfinished(true); setWords(undefined); });
    } catch(error) {
      // A failed publisher may already have committed the device and encrypted seed.
      try {
        const saved = await action({action: 'inspect'});
        if(!cancelled && saved.identity) batch(() => { setIdentity(saved.identity); setUnfinished(saved.unfinished); setStep('publication'); setWords(undefined); });
      } catch{}
      if(!cancelled) setError((error as Error).message);
    } finally { setBusy(false); }
  }
  async function discard() {
    try {
      await confirmationPopup({titleLangKey: 'BlahDiscardSignIn', descriptionLangKey: 'BlahDiscardSignInConfirm',
        button: {langKey: 'BlahDiscardSignIn', isDanger: true}});
    } catch{ return; }
    if(cancelled || busy()) return;
    setBusy(true);
    try {
      await action({action: 'discardEnrollment', id: identity().id});
      if(!cancelled) batch(() => { setIdentity(undefined); setWords(undefined); setUnfinished(false); setError(''); setStep('entry'); });
    } catch(error) { if(!cancelled) setError((error as Error).message); }
    finally { setBusy(false); }
  }
  let email: HTMLInputElement;
  let token: HTMLInputElement;
  let form: HTMLFormElement;
  let cancelled = false;
  onCleanup(() => { cancelled = true; });

  async function login(identity: IdentityView) {
    setError('');
    try {
      await requestLoginCode(flow, needsEmail() ? email.value.trim() : identity.domain, () => !cancelled);
    } catch(cause) {
      if(cancelled) return;
      const error = cause as {type?: string, message?: string};
      if(error.type === 'SIGNUP_EMAIL_REQUIRED') setNeedsEmail(true);
      else if(error.type === 'SESSION_PASSWORD_NEEDED') flow.navigate({name: 'password'});
      else setError(error.type || error.message || 'Sign-in failed.');
    }
  }

  async function loginWithToken(event: SubmitEvent) {
    event.preventDefault();
    if(busy()) return;
    const value = token.value.trim();
    if(!isManagedAccountToken(value)) {
      setError(I18n.format('BlahManagedAccountTokenInvalid', true));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await flow.managers.appAccountManager.importManagedAccountAuthorization(value);
      if(!cancelled) await flow.toIm();
    } catch(cause) {
      if(cancelled) return;
      const error = cause as {type?: string, message?: string};
      const key = tokenError(error);
      setError(key ? I18n.format(key, true) : error.type || error.message || 'Sign-in failed.');
    } finally {
      if(!cancelled) setBusy(false);
    }
  }

  function toggleToken() {
    setError('');
    setNeedsEmail(false);
    setUseToken((value) => !value);
  }

  let entry: HTMLDivElement;
  createEffect(() => {
    if(step() !== 'entry') return;
    const tokenMode = useToken();
    if(Modes.a11y) {
      const target = tokenMode ? token : entry?.querySelector('h1');
      if(!target) return;
      if(!tokenMode) target.tabIndex = -1;
      const cancel = focusWhenSettled(target, () => !cancelled);
      onCleanup(cancel);
    }
  });

  return <>
    <Show when={step() === 'entry'}>
      <div ref={entry}><AuthCard header={<MediaHeader>
        <MediaHeader.Title tag="h1">Blah</MediaHeader.Title>
        <MediaHeader.Subtitle>{useToken() ? I18n.format('BlahManagedAccountDescription', true) : I18n.format('BlahIdentityEntryHelp', true)}</MediaHeader.Subtitle>
      </MediaHeader>}>
        <Show when={!useToken()} fallback={<form ref={form} class={identityStyles.panel} onSubmit={loginWithToken} aria-busy={busy()}>
          <fieldset disabled={busy()}>
            <IdentityInput label="BlahManagedAccountToken" type="password" autocomplete="off" ref={(value) => token = value} onInput={() => setError('')} />
            <div class={styles.errorLabel} role="alert">{error()}</div>
            <Button primaryFilled disabled={busy()} onClick={() => form.requestSubmit()} text={busy() ? 'BlahSigningIn' : 'BlahSignIn'} />
          </fieldset>
        </form>}>
          <div class={identityStyles.panel}>
            <Button primaryFilled text="BlahCreateAccount" onClick={() => { setCreating(true); setStep('address'); }} />
            <Button primaryTransparent text="BlahSignInWords" onClick={() => { setCreating(false); setStep('address'); }} />
            <Button primaryTransparent text="BlahSignInQR" onClick={() => flow.navigate({name: 'signQR'})} />
          </div>
        </Show>
        <Button primaryTransparent disabled={busy()} onClick={toggleToken} text={useToken() ? 'BlahUseIdentity' : 'BlahUseManagedAccountToken'} />
      </AuthCard></div>
    </Show>
    <Show when={step() === 'address'}><BlahAddressCard action={action} creating={creating()} onAddress={address} /><p role="alert">{error()}</p></Show>
    <Show when={step() === 'display'}><BlahWordsDisplayCard words={words()} onDone={() => setStep('verify')} /></Show>
    <Show when={step() === 'verify'}><BlahWordsVerifyCard words={words()} busy={busy()} onVerified={() => enroll(words().join(' '))} />
      <p role="alert">{error()}</p>
    </Show>
    <Show when={step() === 'words'}><BlahWordsEntryCard busy={busy()} error={error()} onPhrase={enroll} /></Show>
    <Show when={step() === 'publication'}><BlahPublicationCard identity={identity()} action={action} onReady={() => login(identity())}>
      <Show when={needsEmail()}><IdentityInput label="BlahAdmissionEmail" type="email" autocomplete="email" ref={(value) => email = value} /></Show>
      <div class={styles.errorLabel} role="alert">{error()}</div>
      <Show when={unfinished()}><Button primaryTransparent text="BlahDiscardSignIn" disabled={busy()} onClick={discard} /></Show>
    </BlahPublicationCard></Show>
    <Show when={step() !== 'entry' && step() !== 'publication'}>
      <Button primaryTransparent text="Cancel" disabled={busy()} onClick={() => { batch(() => { setStep('entry'); setWords(undefined); setError(''); }); }} />
    </Show>
  </>;
}
