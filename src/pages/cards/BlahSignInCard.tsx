import {createSignal, onCleanup, Show} from 'solid-js';
import MediaHeader from '@components/mediaHeader';
import blah, {getBlahConfig} from '@config/blah';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import HomeDCCard from '@lib/blah/HomeDCCard';
import IdentityInput from '@lib/blah/IdentityInput';
import IdentityPanel from '@lib/blah/IdentityPanel';
import type {IdentityView} from '@lib/blah/identity';
import AuthCard from '@/pages/AuthCard';
import {useAuthFlow} from '@/pages/authFlow';
import requestLoginCode from '@/pages/requestLoginCode';
import styles from '@/pages/authFlow.module.scss';

export default function BlahSignInCard() {
  if(blah?.discovery && !getBlahConfig(getCurrentAccount())?.home) return <HomeDCCard />;
  const flow = useAuthFlow();
  const [error, setError] = createSignal('');
  const [needsEmail, setNeedsEmail] = createSignal(false);
  let email: HTMLInputElement;
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

  return <AuthCard header={<MediaHeader>
    <MediaHeader.Title>Blah</MediaHeader.Title>
    <MediaHeader.Subtitle>Sign in with an identity held in your browser.</MediaHeader.Subtitle>
  </MediaHeader>}>
    <IdentityPanel action={(request) => flow.managers.appAccountManager.blahIdentity(request)} onSignIn={login}
      onIdentity={(identity) => { if(!identity) { setNeedsEmail(false); setError(''); } }}>
      <Show when={needsEmail()}><IdentityInput label="BlahAdmissionEmail" type="email" autocomplete="email" ref={(value) => email = value} /></Show>
      <div class={styles.errorLabel} role="alert">{error()}</div>
    </IdentityPanel>
  </AuthCard>;
}
