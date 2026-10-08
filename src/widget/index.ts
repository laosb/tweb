import type {AuthState} from '@types';
import type {User} from '@layer';
import blah from '@config/blah';
import rootScope from '@lib/rootScope';
import AccountController from '@lib/accounts/accountController';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import appNavigationController from '@components/appNavigationController';
import {readToken} from '@/widget/config';
import {restrictToSupport} from '@/widget/restrictions';
import {applyWidgetTheme} from '@/widget/theme';
import '@/widget/style.scss';

const AUTH_ERRORS = new Set(['ACCESS_TOKEN_INVALID', 'ACCESS_TOKEN_EXPIRED', 'AUTH_KEY_UNREGISTERED', 'MANAGED_ACCOUNT_REQUIRED']);

function errorText(code: string) {
  if(AUTH_ERRORS.has(code) || code?.startsWith('USER_MIGRATE_')) {
    return 'This customer token is no longer valid. Please reopen support from the application.';
  }
  if(code === 'SUPPORT_UNAVAILABLE') return 'Support is currently unavailable.';
  return 'Could not connect to support. Please try again.';
}

/** The only UI before the chat opens: a status line, or an error with a retry. Never a login form. */
function showStatus(text: string, error?: boolean) {
  const container = document.getElementById('widget');
  const message = document.createElement('p');
  message.textContent = text;
  message.setAttribute('role', error ? 'alert' : 'status');
  container.replaceChildren(message);
  if(error) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Reconnect';
    retry.addEventListener('click', () => location.reload());
    container.append(retry);
  }
}

function logOut() {
  showStatus('Signing out…');
  return rootScope.managers.apiManager.logOut();
}

/**
 * Runs instead of the auth flow: the URL fragment's managed-account token is the only
 * credential, revalidated on every load, and the client then shows one conversation
 * with the home DC's support account. Returns once the chat is open or a status shows.
 */
export async function startWidget(authState: AuthState) {
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

  const signedIn = authState._ === 'authStateSignedIn';
  if(!blah.widget.param) {
    showStatus('Support has not been configured.');
    return;
  }
  if(!token) {
    if(signedIn) await logOut();
    else showStatus('This support chat requires a customer token.');
    return;
  }
  // `<user id>:<secret>`: another account's session goes before this one signs in.
  const {userId} = await AccountController.get(getCurrentAccount());
  if(signedIn && String(userId) !== token.split(':')[0]) {
    await logOut();
    return;
  }

  showStatus('Connecting to support…');
  let support: User.user;
  try {
    // Also for a restored session: a revoked or rotated token must not reopen the chat.
    await rootScope.managers.appAccountManager.importManagedAccountAuthorization(token);
    const result = await rootScope.managers.apiManager.invokeApi('help.getSupport', {});
    const user = result.user;
    if(user._ !== 'user' || user.pFlags?.deleted || user.id === +token.split(':')[0]) {
      throw new Error('SUPPORT_UNAVAILABLE');
    }
    await rootScope.managers.appUsersManager.saveApiUser(user);
    support = user;
  } catch(error) {
    const code = (error as ApiError)?.type || (error as Error)?.message;
    if(AUTH_ERRORS.has(code) && signedIn) {
      await logOut();
      return;
    }
    showStatus(errorText(code), true);
    return;
  }

  const peerId = support.id.toPeerId(false);
  const appImManager = restrictToSupport(peerId);
  const {bootstrapIm} = await import('@/pages/bootstrapIm');
  await bootstrapIm();
  applyWidgetTheme();
  await appImManager.setInnerPeer({peerId});
  // Without the opt-in a11y layer, the history is otherwise not keyboard-scrollable.
  appImManager.chat.bubbles.scrollable.container.tabIndex = 0;
  document.getElementById('widget').replaceChildren();
}
