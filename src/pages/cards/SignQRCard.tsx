import {createSignal, lazy, Show, onCleanup, onMount} from 'solid-js';

import Button from '@components/buttonTsx';
import LanguageChangeButton from '@components/languageChangeButton';
import PasskeyLoginButton from '@components/passkeyLoginButton';
import {putPreloader} from '@components/putPreloader';
import MediaHeader from '@components/mediaHeader';
import mediaHeaderStyles from '@components/mediaHeader.module.scss';
import bytesCmp from '@helpers/bytes/bytesCmp';
import bytesToBase64 from '@helpers/bytes/bytesToBase64';
import fixBase64String from '@helpers/fixBase64String';
import pause from '@helpers/schedulers/pause';
import {paintQrCode} from '@helpers/qrCode/paintQrCode';
import type {DcId} from '@types';
import {AuthAuthorization, AuthLoginToken} from '@layer';
import App from '@config/app';
import blah from '@config/blah';
import type {DeviceLinkResult} from '@lib/blah/deviceLinkTypes';
import I18n, {LangPackKey, i18n} from '@lib/langPack';
import AccountController from '@lib/accounts/accountController';
import bindManagersToAccount from '@lib/accounts/bindManagersToAccount';
import rootScope from '@lib/rootScope';

import AuthCard from '@/pages/AuthCard';
import {CardSpec, useAuthFlow} from '@/pages/authFlow';
import styles from '@/pages/authFlow.module.scss';

if(import.meta.hot) import.meta.hot.accept();

type Spec = Extract<CardSpec, {name: 'signQR'}>;

const LinkPassword = lazy(() => import('@lib/blah/DeviceLinkPassword'));
const FETCH_INTERVAL = 3;
const QR_SIZE = 240;

/**
 * Card variant of `pageSignQR`. Polls `auth.exportLoginToken` in a loop, painting
 * the QR code into the `auth-image` slot. On `loginTokenSuccess` we go to IM; on
 * `SESSION_PASSWORD_NEEDED` to the password card; on cancel/back to the signIn
 * card. The loop terminates when the card unmounts (cleanup flips `stopped`).
 */
export default function SignQRCard(_props: {spec: Spec}) {
  const {accountNumber, managers: flowManagers, navigate, toIm} = useAuthFlow();
  const managers = bindManagersToAccount(flowManagers, accountNumber);

  // Persistent host for the QR canvas (qr-code-styling injects its canvas
  // into this div). We hand it to <MediaHeader.Sticker element={...}>.
  let stickerHost: HTMLDivElement;
  let preloader: HTMLElement | undefined;
  let stopped = false;
  const attempt = crypto.randomUUID();
  let parameter = '';
  let started = false;
  const [needsPassword, setNeedsPassword] = createSignal(false);
  const [error, setError] = createSignal('');
  const [linkURL, setLinkURL] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  let wake: () => void;
  const onLoginToken = (slot: number) => { if(slot === accountNumber) wake?.(); };
  rootScope.addEventListener('blah_login_token', onLoginToken);

  async function applyLinkedResult(result: DeviceLinkResult) {
    if(stopped) return true;
    parameter = result.parameter || parameter;
    if(result.needsPassword) { setNeedsPassword(true); return true; }
    if(result.loginToken?._ === 'auth.loginTokenSuccess') {
      const authorization = result.loginToken.authorization;
      if(authorization._ !== 'auth.authorization') throw new Error('DEVICE_LINK_INVALID');
      await managers.apiManager.setUser(authorization.user);
      toIm();
      return true;
    }
    return false;
  }

  async function finishLink(password: string) {
    try {
      await applyLinkedResult(await managers.appAccountManager.blahDeviceLink({action: 'complete', attempt, password}));
    } catch(error) {
      if(stopped) return;
      if((error as ApiError).type === 'SESSION_PASSWORD_NEEDED') {
        stopped = true;
        navigate({name: 'password'});
      } else throw error;
    }
  }

  // Latest token we've drawn — kept so the theme_changed listener can repaint
  // synchronously without waiting for the next `iterate` cycle to come around.
  let lastDrawnToken: Uint8Array | number[] | undefined;
  let QRCodeStylingCtor: any;

  /* ---------- description list ---------- */

  const helpKeys: LangPackKey[] = ['Login.QR.Help1', 'Login.QR.Help2', 'Login.QR.Help3'];
  const helpList = (
    <ol class={styles.qrDescription}>
      {helpKeys.map((key, idx) => (
        <li class={styles.qrDescriptionItem}>
          <span class={styles.qrDescriptionMarker}>{idx + 1}</span>
          {i18n(key)}
        </li>
      ))}
    </ol>
  );

  /* ---------- 'user_auth' subscription ---------- */

  const onUserAuth = () => {
    stopped = true;
  };
  rootScope.addEventListener('user_auth', onUserAuth, {once: true});

  /* ---------- paint QR ---------- */

  // Builds the QR canvas (and its embedded logo) from the current token using the
  // theme's CSS variables. Called on token rotation from `iterate` and on theme
  // change from the `theme_changed` listener so the QR repaints with the new
  // colors without waiting for the next 3-second polling tick.
  async function paintQR(token: Uint8Array | number[]) {
    if(!QRCodeStylingCtor) return;

    const encoded = bytesToBase64(token);
    const url = 'tg://login?token=' + fixBase64String(encoded, true) + (parameter ? '&blah=' + parameter : '');

    const style = window.getComputedStyle(document.documentElement);
    const surfaceColor = style.getPropertyValue('--light-filled-primary-color').trim();
    const textColor = style.getPropertyValue('--primary-text-color').trim();
    const primaryColor = style.getPropertyValue('--primary-color').trim();

    const {canvas} = await paintQrCode({
      data: url,
      size: QR_SIZE,
      host: stickerHost,
      background: surfaceColor,
      foreground: textColor,
      logoColor: primaryColor,
      canvasClass: styles.qrCanvas,
      QRCodeStylingCtor
    });

    // ! costyl, but the library doesn't expose any events
    if(preloader) {
      preloader.style.animation = 'hide-icon .4s forwards';

      canvas.style.display = 'none';
      canvas.style.animation = 'grow-icon .4s forwards';
      setTimeout(() => {
        canvas.style.display = '';
      }, 150);
      setTimeout(() => {
        canvas.style.animation = '';
      }, 500);
      preloader = undefined;
    } else {
      Array.from(stickerHost.children).slice(0, -1).forEach((el) => el.remove());
    }

    if(url !== linkURL()) { setLinkURL(url); setCopied(false); }
    lastDrawnToken = token;
  }

  /* ---------- theme_changed: repaint with new CSS-variable colors ---------- */

  const onThemeChanged = () => {
    if(stopped || needsPassword() || !lastDrawnToken) return;
    paintQR(lastDrawnToken);
  };
  rootScope.addEventListener('theme_changed', onThemeChanged);

  /* ---------- iterate loop ---------- */

  const options: {dcId?: DcId, ignoreErrors: true} = {ignoreErrors: true};
  let prevToken: Uint8Array | number[] | undefined;

  async function iterate(QRCodeStyling: any, isLoop: boolean): Promise<boolean> {
    try {
      if(blah) {
        const result = await managers.appAccountManager.blahDeviceLink(started ? {action: 'poll', attempt} :
          {action: 'begin', attempt, label: 'Blah Web', exceptIds: (await AccountController.getUserIds()).map((id) => id.toUserId())});
        started = true;
        if(await applyLinkedResult(result)) return true;
        if(result.loginToken?._ !== 'auth.loginToken') throw new Error('DEVICE_LINK_INVALID');
        if(!prevToken || !bytesCmp(prevToken, result.loginToken.token)) {
          prevToken = result.loginToken.token;
          QRCodeStylingCtor = QRCodeStyling;
          await paintQR(prevToken);
        }
        if(!stopped) await new Promise<void>((resolve) => {
          const timer = setTimeout(() => { wake = undefined; resolve(); }, FETCH_INTERVAL * 1000);
          wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
        });
        return false;
      }
      const userIds = await AccountController.getUserIds();
      let loginToken = await managers.apiManager.invokeApi('auth.exportLoginToken', {
        api_id: App.id,
        api_hash: App.hash,
        except_ids: userIds.map((userId) => userId.toUserId())
      }, {ignoreErrors: true});

      if(loginToken._ === 'auth.loginTokenMigrateTo') {
        if(!options.dcId) {
          options.dcId = loginToken.dc_id as DcId;
          managers.apiManager.setBaseDcId(loginToken.dc_id);
        }

        loginToken = await managers.apiManager.invokeApi('auth.importLoginToken', {
          token: loginToken.token
        }, options) as AuthLoginToken.authLoginToken;
      }

      if(loginToken._ === 'auth.loginTokenSuccess') {
        const authorization = loginToken.authorization as any as AuthAuthorization.authAuthorization;
        await managers.apiManager.setUser(authorization.user);
        toIm();
        return true;
      }

      if(!prevToken || !bytesCmp(prevToken, loginToken.token)) {
        prevToken = loginToken.token;
        QRCodeStylingCtor = QRCodeStyling;
        await paintQR(loginToken.token);
      }

      if(isLoop) {
        const timestamp = Date.now() / 1000;
        const diff = loginToken.expires - timestamp - await managers.timeManager.getServerTimeOffset();
        await pause(diff > FETCH_INTERVAL ? 1e3 * FETCH_INTERVAL : 1e3 * diff | 0);
      }
    } catch(err) {
      // * the card is gone: what was on its way is dropped, not an error of the login
      if(stopped) {
        return true;
      }

      switch((err as ApiError).type) {
        case 'SESSION_PASSWORD_NEEDED':
          navigate({name: 'password'});
          stopped = true;
          break;
        case 'AUTH_TOKEN_EXPIRED':
          console.warn('SignQRCard: AUTH_TOKEN_EXPIRED');
          return false;
        default:
          if(blah) setError((await import('@lib/blah/deviceLinkMessage')).deviceLinkMessage(err));
          else console.error('SignQRCard: default error:', err);
          stopped = true;
          break;
      }

      return true;
    }

    return false;
  }

  /* ---------- lifecycle ---------- */

  onMount(async() => {
    managers.appStateManager.pushToState('authState', {_: 'authStateSignQr'});

    preloader = putPreloader(stickerHost, true);

    const [{default: QRCodeStyling}] = await Promise.all([
      import('qr-code-styling' as any)
    ]);

    if(stopped) return;

    while(!stopped) {
      const needBreak = await iterate(QRCodeStyling, true);
      if(needBreak || stopped) break;
    }
  });

  onCleanup(() => {
    stopped = true;
    wake?.();
    rootScope.removeEventListener('blah_login_token', onLoginToken);
    if(blah) void managers.appAccountManager.blahDeviceLink({action: 'cancel', attempt}).catch(() => {});
    rootScope.removeEventListener('user_auth', onUserAuth);
    rootScope.removeEventListener('theme_changed', onThemeChanged);
  });

  /* ---------- render ---------- */

  return (
    <AuthCard
      class={styles.pageSignQR}
      inputWrapper={false}
      header={
        <MediaHeader>
          <Show when={!needsPassword()} fallback={<h1 class={`${mediaHeaderStyles.title} text-center text-overflow-wrap`}>{i18n('BlahLinkPasswordTitle')}</h1>}>
            <MediaHeader.Sticker ref={stickerHost} class={styles.qrContainer} size={QR_SIZE}/>
            <h1
              class={`${mediaHeaderStyles.title} text-center text-overflow-wrap`}
              style={{'margin-top': 0}}
            >
              {i18n('Login.QR.Title')}
            </h1>
            <MediaHeader.Subtitle class="secondary">{i18n('Login.QR.Subtitle')}</MediaHeader.Subtitle>
          </Show>
        </MediaHeader>
      }
    >
      <Show when={needsPassword()} fallback={helpList}>
        <LinkPassword onSubmit={finishLink} />
      </Show>
      <Show when={blah && !needsPassword()}>
        <Button class="btn-primary btn-secondary btn-primary-transparent primary" text={copied() ? 'LinkCopied' : 'CopyLink'}
          disabled={!linkURL() || stopped} onClick={async() => {
            try { await navigator.clipboard.writeText(linkURL()); setCopied(true); }
            catch{ setError(I18n.format('BlahLinkCopyFailed', true)); }
          }} />
      </Show>
      <p role="alert">{error()}</p>
      <Button
        class="btn-primary btn-secondary btn-primary-transparent primary"
        onClick={() => {
          stopped = true;
          navigate({name: 'signIn'});
        }}
        text={blah ? 'BlahUseIdentity' : 'Login.QR.Cancel'}
      />
      {accountNumber === 1 && <LanguageChangeButton />}
      {!blah && <PasskeyLoginButton />}
    </AuthCard>
  );
}
