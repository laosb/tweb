import type {IdentityActions} from '@lib/blah/identity';

/** Closing waits for settings saves already in flight. */
export function detailsSession(action: IdentityActions, id: string, onClose: () => void) {
  let closed = false;
  let closing: Promise<unknown>;
  const pending = new Set<Promise<unknown>>();
  const session = {
    isClosed: () => closed,
    beforeClose: () => {},
    action: ((request) => {
      if(closed) return Promise.reject(new Error('Identity details are closed.'));
      const result = action({...request, id});
      // Public network checks do not hold keys and must not delay closing.
      if(!['publication', 'hostingPlan', 'hostingStatus'].includes(request.action)) {
        pending.add(result);
        void result.finally(() => pending.delete(result)).catch(() => {});
      }
      return result;
    }) as IdentityActions,
    close: () => {
      if(closing) return closing;
      session.beforeClose();
      closed = true;
      onClose();
      closing = Promise.allSettled([...pending]);
      return closing;
    }
  };
  return session;
}
