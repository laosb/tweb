import type {AuthState} from '@types';
import blah from '@config/blah';
import rootScope from '@lib/rootScope';
import AccountController from '@lib/accounts/accountController';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import appNavigationController from '@components/appNavigationController';
import {readToken} from '@/widget/config';
import {restrictToSupport} from '@/widget/restrictions';
import {applyWidgetTheme} from '@/widget/theme';
import {widgetRevision} from '@/widget/revision';
import I18n, {LangPackKey} from '@lib/langPack';
import {loadWidgetLanguage} from '@/widget/langPack';
import '@/widget/style.scss';

const AUTH_ERRORS = new Set(['ACCESS_TOKEN_INVALID', 'ACCESS_TOKEN_EXPIRED', 'AUTH_KEY_UNREGISTERED', 'MANAGED_ACCOUNT_REQUIRED']);

function errorText(code: string): LangPackKey {
  if(AUTH_ERRORS.has(code) || code?.startsWith('USER_MIGRATE_')) {
    return 'BfbTokenInvalid';
  }
  if(code === 'STARTUP_TIMEOUT') return 'BfbConnectingTimeout';
  if(code === 'SUPPORT_UNAVAILABLE') return 'BfbSupportUnavailable';
  return 'BfbConnectionFailed';
}

/** The only UI before the chat opens: a status line, or an error with a retry. Never a login form. */
function showStatus(key: LangPackKey, error?: boolean) {
  const container = document.getElementById('widget');
  const message = document.createElement('p');
  I18n._i18n(message, key);
  message.setAttribute('role', error ? 'alert' : 'status');
  container.replaceChildren(message);
  if(error) {
    const retry = document.createElement('button');
    retry.type = 'button';
    I18n._i18n(retry, 'BfbReconnect');
    retry.addEventListener('click', () => location.reload());
    container.append(retry);
  }
}

function logOut() {
  showStatus('BfbSigningOut');
  return rootScope.managers.apiManager.logOut();
}

/**
 * Runs instead of the auth flow: the URL fragment's managed-account token is the only
 * credential, revalidated on every load, and the client then shows one conversation
 * with the home DC's support account. Returns once the chat is open or a status shows.
 */
export async function startWidget(authState: AuthState) {
  console.info('Blah widget', widgetRevision());
  document.body.classList.add('blah-widget');
  const token = readToken(location.hash);
  // A token change runs the same path as a fresh load.
  window.addEventListener('hashchange', () => {
    if(readToken(location.hash) !== token) location.reload();
  });
  // Logging out reloads without the fragment; keep the replacement token for that load.
  const reload = appNavigationController.reload.bind(appNavigationController);
  appNavigationController.reload = (url?: boolean | URL) => {
    if(url instanceof URL) url.hash = location.hash;
    reload(url === true ? undefined : url);
  };

  const managers = bindManagersToSession(rootScope.managers);
  const language = loadWidgetLanguage();
  const signedIn = authState._ === 'authStateSignedIn';
  if(!blah.widget.param) {
    showStatus('BfbNotConfigured');
    return;
  }
  if(!token) {
    if(signedIn) await logOut();
    else showStatus('BfbTokenRequired');
    return;
  }
  showStatus('BfbConnecting');
  // Keep partially constructed chat UI hidden and unfocusable until every stage succeeds.
  const chats = document.getElementById('page-chats');
  chats.inert = true;
  document.body.classList.add('widget-starting');
  const attempt = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      attempt.abort();
      reject(new Error('STARTUP_TIMEOUT'));
    }, 45_000);
  });
  try {
    await Promise.race([timeout, (async() => {
      await language;
      attempt.signal.throwIfAborted();
      // `<user id>:<secret>`: another account's session goes before this one signs in.
      const {userId} = await AccountController.get(getCurrentAccount());
      attempt.signal.throwIfAborted();
      if(signedIn && String(userId) !== token.split(':')[0]) {
        await logOut();
        return;
      }
      // Also for a restored session: a revoked or rotated token must not reopen the chat.
      await managers.appAccountManager.importManagedAccountAuthorization(token);
      attempt.signal.throwIfAborted();
      const result = await managers.apiManager.invokeApi('help.getSupport', {});
      attempt.signal.throwIfAborted();
      const user = result.user;
      await managers.appUsersManager.saveApiUser(user);
      attempt.signal.throwIfAborted();
      if(user._ !== 'user' || user.pFlags?.deleted || user.id === +token.split(':')[0]) {
        throw new Error('SUPPORT_UNAVAILABLE');
      }
      const peerId = user.id.toPeerId(false);
      const appImManager = restrictToSupport(peerId);
      const {bootstrapIm} = await import('@/pages/bootstrapIm');
      attempt.signal.throwIfAborted();
      await bootstrapIm();
      attempt.signal.throwIfAborted();
      applyWidgetTheme();
      await appImManager.setInnerPeer({peerId});
      attempt.signal.throwIfAborted();
      // Without the opt-in a11y layer, the history is otherwise not keyboard-scrollable.
      appImManager.chat.bubbles.scrollable.container.tabIndex = 0;
      document.getElementById('widget').replaceChildren();
      chats.inert = false;
      document.body.classList.remove('widget-starting');
    })()]);
  } catch(error) {
    // Pending RPCs may still settle. They must neither advance startup nor clear this status.
    attempt.abort();
    const code = (error as ApiError)?.type || (error as Error)?.message;
    if(AUTH_ERRORS.has(code) && signedIn) {
      await logOut();
      return;
    }
    showStatus(errorText(code), true);
  } finally {
    clearTimeout(timer);
  }
}
