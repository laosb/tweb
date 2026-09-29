import {detailsSession} from '@lib/blah/detailsSession';
import type {IdentityResponse} from '@lib/blah/identity';

it('waits for a late unlock and autosave before locking, and closes only once', async() => {
  let unlock: (result: IdentityResponse) => void;
  let save: (result: IdentityResponse) => void;
  const action = vi.fn((request) => request.action === 'unlock' ? new Promise<IdentityResponse>((resolve) => unlock = resolve) :
    request.action === 'renewal' ? new Promise<IdentityResponse>((resolve) => save = resolve) : Promise.resolve({}));
  const onLock = vi.fn();
  const session = detailsSession(action, 'identity', onLock);
  void session.action({action: 'unlock'});
  session.beforeClose = () => { void session.action({action: 'renewal'}); };
  const closing = session.close();
  expect(session.close()).toBe(closing);
  expect(onLock).toHaveBeenCalledOnce();
  expect(action).not.toHaveBeenCalledWith({action: 'lock', id: 'identity'});
  unlock({});
  await Promise.resolve();
  expect(action).not.toHaveBeenCalledWith({action: 'lock', id: 'identity'});
  save({});
  await closing;
  expect(action).toHaveBeenLastCalledWith({action: 'lock', id: 'identity'});
  await expect(session.action({action: 'unlock'})).rejects.toThrow('closed');
});

it('locks even when an operation failed and a public host never responds', async() => {
  const action = vi.fn((request) => request.action === 'publication' ? new Promise<IdentityResponse>(() => {}) :
    request.action === 'renewal' ? Promise.reject(new Error('Save failed')) : Promise.resolve({}));
  const session = detailsSession(action, 'identity', () => {});
  void session.action({action: 'publication'});
  await expect(session.action({action: 'renewal'})).rejects.toThrow('Save failed');
  await session.close();
  expect(action).toHaveBeenLastCalledWith({action: 'lock', id: 'identity'});
});
