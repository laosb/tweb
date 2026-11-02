import {expect, it, vi} from 'vitest';
import {detailsSession} from '@lib/blah/detailsSession';

it('waits for settings saves and prevents further actions after closing', async() => {
  let finish: () => void;
  const action = vi.fn(() => new Promise<Record<string, never>>((resolve) => { finish = () => resolve({}); }));
  const session = detailsSession(action, 'identity', vi.fn());
  void session.action({action: 'renewal'});
  const closed = session.close();
  let done = false; void closed.then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false);
  finish(); await closed; expect(done).toBe(true);
  await expect(session.action({action: 'inspect'})).rejects.toThrow('closed');
  expect(action).toHaveBeenCalledOnce();
});

it('does not delay closing for a public publication check', async() => {
  const action = vi.fn(() => new Promise<Record<string, never>>(() => {}));
  const session = detailsSession(action, 'identity', vi.fn());
  void session.action({action: 'publication'});
  await session.close();
  expect(action).toHaveBeenCalledOnce();
});
