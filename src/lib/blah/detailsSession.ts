import type {IdentityActions} from '@lib/blah/IdentityPanel';

/** Closing must win over an unlock or save that is still in flight. */
export function detailsSession(action: IdentityActions, id: string, onLock: () => void) {
  let closed = false;
  let closing: Promise<unknown>;
  const pending = new Set<Promise<unknown>>();
  const session = {
    isClosed: () => closed,
    beforeClose: () => {},
    action: ((request) => {
      if(closed) return Promise.reject(new Error('Identity details are closed.'));
      const result = action({...request, id});
      // Public network checks do not hold keys and must not delay locking.
      if(request.action !== 'publication') {
        pending.add(result);
        void result.finally(() => pending.delete(result)).catch(() => {});
      }
      return result;
    }) as IdentityActions,
    close: () => {
      if(closing) return closing;
      session.beforeClose();
      closed = true;
      onLock();
      closing = Promise.allSettled([...pending]).then(() => action({action: 'lock', id}));
      return closing;
    }
  };
  return session;
}
