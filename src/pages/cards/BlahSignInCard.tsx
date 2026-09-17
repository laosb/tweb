import {createSignal, onCleanup, onMount} from 'solid-js';

import Button from '@components/buttonTsx';
import InputField from '@components/inputField';
import LanguageChangeButton from '@components/languageChangeButton';
import MediaHeader from '@components/mediaHeader';
import IS_TOUCH_SUPPORTED from '@environment/touchSupport';
import focusWhenConnected from '@helpers/dom/focusWhenConnected';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import {i18n} from '@lib/langPack';
import AuthCard from '@/pages/AuthCard';
import {useAuthFlow} from '@/pages/authFlow';
import normalizeBlahIdentifier from '@/pages/normalizeBlahIdentifier';
import requestLoginCode from '@/pages/requestLoginCode';
import styles from '@/pages/authFlow.module.scss';

/** Only the identifier entry differs; the code/password/signup flow stays shared. */
export default function BlahSignInCard() {
  const flow = useAuthFlow();
  const [submitting, setSubmitting] = createSignal(false);
  const [hasInput, setHasInput] = createSignal(false);
  const [error, setError] = createSignal('');
  let cancelled = false;
  let cancelFocus: () => void;

  const field = new InputField({
    plainText: true,
    labelText: 'Blah Number or email address',
    name: 'username',
    autocomplete: 'username'
  });
  const input = field.input as HTMLInputElement;
  input.inputMode = 'email';
  input.autocapitalize = 'none';
  input.spellcheck = false;
  input.addEventListener('input', () => {
    setHasInput(!!input.value.trim());
    setError('');
  });
  input.addEventListener('keydown', (event) => {
    if(event.key === 'Enter') {
      event.preventDefault();
      onSubmit();
    }
  });

  async function onSubmit() {
    if(submitting() || !hasInput() || cancelled) return;
    setSubmitting(true);
    setError('');
    input.disabled = true;
    try {
      await requestLoginCode(flow, normalizeBlahIdentifier(input.value), () => !cancelled);
    } catch(err) {
      if(cancelled) return;
      const error = err as {type?: string, message?: string};
      setError(error?.type === 'PHONE_NUMBER_INVALID' || error?.type === 'EMAIL_INVALID' ?
        'Enter a valid Blah Number or email address.' : error?.type || error?.message || 'Unable to sign in.');
    } finally {
      if(!cancelled) {
        setSubmitting(false);
        input.disabled = false;
      }
    }
  }

  onMount(() => {
    flow.managers.appStateManager.pushToState('authState', {_: 'authStateSignIn'});
    if(!IS_TOUCH_SUPPORTED) {
      cancelFocus = focusWhenConnected(input, () => !cancelled);
    }
  });
  onCleanup(() => {
    cancelled = true;
    cancelFocus?.();
  });

  return (
    <AuthCard
      class={styles.pageSignIn}
      header={
        <MediaHeader>
          <MediaHeader.Title>Blah</MediaHeader.Title>
          <MediaHeader.Subtitle class="secondary">Sign in with your Blah Number or email address.</MediaHeader.Subtitle>
        </MediaHeader>
      }
    >
      {field.container}
      <div class={styles.errorLabel} role="alert">{error()}</div>
      <Button class="btn-primary btn-color-primary" disabled={!hasInput() || submitting()} onClick={onSubmit}>
        {i18n(submitting() ? 'PleaseWait' : 'Login.Next')}
      </Button>
      {getCurrentAccount() === 1 && <LanguageChangeButton />}
      <Button
        class="btn-primary btn-secondary btn-primary-transparent primary"
        disabled={submitting()}
        onClick={() => flow.navigate({name: 'signQR'})}
        text="Login.QR.Login"
      />
    </AuthCard>
  );
}
