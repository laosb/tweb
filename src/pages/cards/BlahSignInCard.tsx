import {createSignal, onCleanup, Show} from 'solid-js';
import Button from '@components/buttonTsx';
import MediaHeader from '@components/mediaHeader';
import blah, {getBlahConfig} from '@config/blah';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import HomeDCCard from '@lib/blah/HomeDCCard';
import IdentityInput from '@lib/blah/IdentityInput';
import IdentityPanel from '@lib/blah/IdentityPanel';
import type {IdentityView} from '@lib/blah/identity';
import {isManagedAccountToken} from '@lib/blah/managedAccount';
import identityStyles from '@lib/blah/identity.module.scss';
import I18n, {LangPackKey} from '@lib/langPack';
import AuthCard from '@/pages/AuthCard';
import {useAuthFlow} from '@/pages/authFlow';
import requestLoginCode from '@/pages/requestLoginCode';
import styles from '@/pages/authFlow.module.scss';

function tokenError(error: {type?: string, message?: string}): LangPackKey | undefined {
  const code = error.type || error.message;
  if(code === 'ACCESS_TOKEN_INVALID' || code === 'ACCESS_TOKEN_EXPIRED') return 'BlahManagedAccountTokenInvalid';
  if(code === 'MANAGED_ACCOUNT_REQUIRED') return 'BlahManagedAccountRequired';
  if(code?.startsWith('USER_MIGRATE_')) return 'BlahManagedAccountOtherHome';
}

export default function BlahSignInCard() {
  if(blah?.discovery && !getBlahConfig(getCurrentAccount())?.home) return <HomeDCCard />;
  const flow = useAuthFlow();
  const [error, setError] = createSignal('');
  const [needsEmail, setNeedsEmail] = createSignal(false);
  const [useToken, setUseToken] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
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

  return <AuthCard header={<MediaHeader>
    <MediaHeader.Title>Blah</MediaHeader.Title>
    <MediaHeader.Subtitle>{useToken() ? I18n.format('BlahManagedAccountDescription', true) : 'Sign in with an identity held in your browser.'}</MediaHeader.Subtitle>
  </MediaHeader>}>
    <Show when={useToken()} fallback={
      <IdentityPanel action={(request) => flow.managers.appAccountManager.blahIdentity(request)} onSignIn={login}
        onIdentity={(identity) => { if(!identity) { setNeedsEmail(false); setError(''); } }}>
        <Show when={needsEmail()}><IdentityInput label="BlahAdmissionEmail" type="email" autocomplete="email" ref={(value) => email = value} /></Show>
        <div class={styles.errorLabel} role="alert">{error()}</div>
      </IdentityPanel>
    }>
      <form ref={form} class={identityStyles.panel} onSubmit={loginWithToken} aria-busy={busy()}>
        <fieldset disabled={busy()}>
          <IdentityInput label="BlahManagedAccountToken" type="password" autocomplete="off" ref={(value) => token = value}
            onInput={() => setError('')} />
          <div class={styles.errorLabel} role="alert">{error()}</div>
          <Button primaryFilled disabled={busy()} onClick={() => form.requestSubmit()} text={busy() ? 'BlahSigningIn' : 'BlahSignIn'} />
        </fieldset>
      </form>
    </Show>
    <Button class="btn-primary btn-secondary btn-primary-transparent primary" disabled={busy()} onClick={toggleToken}
      text={useToken() ? 'BlahUseIdentity' : 'BlahUseManagedAccountToken'} />
  </AuthCard>;
}
