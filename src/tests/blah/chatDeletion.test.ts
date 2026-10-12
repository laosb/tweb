import {beforeEach, describe, expect, it, vi} from 'vitest';

const mock = vi.hoisted(() => ({toast: vi.fn(), close: undefined as (() => void)}));
vi.mock('@components/toast', () => ({toastNew: mock.toast}));
vi.mock('@components/buttonTsx', () => ({default: (): undefined => undefined}));
vi.mock('@lib/blah/IdentityInput', () => ({default: (): undefined => undefined}));
vi.mock('@lib/langPack', () => ({i18n: (key: string) => key}));
vi.mock('@helpers/dom/focusWhenSettled', () => ({default: vi.fn()}));
vi.mock('@components/popups/indexTsx', () => ({
  default: (props: {onClose: () => void, onCloseAfterTimeout: () => void}) => {
    mock.close = () => { props.onClose(); props.onCloseAfterTimeout(); };
  },
  createPopup: (factory: () => void) => factory()
}));

import deleteChatWithIdentity, {tryDeleteChatWithIdentity} from '@lib/blah/chatDeletion';

beforeEach(() => {
  mock.toast.mockClear();
  mock.close = undefined;
});

describe.each([
  {caller: 'delete dialog', remove: deleteChatWithIdentity, rejectsCancellation: true},
  {caller: 'community editor', remove: tryDeleteChatWithIdentity, rejectsCancellation: false}
])('$caller deletion', ({remove, rejectsCancellation}) => {
  function managers() {
    return {appChatsManager: {delete: vi.fn().mockResolvedValue(undefined)}, appAccountManager: {blahIdentity: vi.fn()}};
  }

  function invoke(manager: ReturnType<typeof managers>) {
    return remove(manager as unknown as Parameters<typeof remove>[0], 25);
  }

  async function expectNotDeleted(result: Promise<boolean>) {
    if(rejectsCancellation) await expect(result).rejects.toThrow('BLAH_CHAT_CANCELLED');
    else await expect(result).resolves.toBe(false);
  }

  it('resolves true only after the manager deletes the chat', async() => {
    const manager = managers();
    await expect(invoke(manager)).resolves.toBe(true);
    expect(manager.appChatsManager.delete).toHaveBeenCalledExactlyOnceWith(25);
    expect(mock.toast).not.toHaveBeenCalled();
  });

  it('cancels without retrying deletion or showing an error toast', async() => {
    const manager = managers();
    manager.appChatsManager.delete.mockRejectedValue({type: 'BLAH_CHAT_IDENTITY_LOCKED', id: 'chat', domain: 'news.example.org'});
    const result = invoke(manager);
    await vi.waitFor(() => expect(mock.close).toBeTypeOf('function'));
    mock.close();
    await expectNotDeleted(result);
    expect(manager.appChatsManager.delete).toHaveBeenCalledOnce();
    expect(manager.appAccountManager.blahIdentity).not.toHaveBeenCalled();
    expect(mock.toast).not.toHaveBeenCalled();
  });

  it.each(['CHAT_IDENTITY_REQUIRED', 'IDENTITY_PROOF_REQUIRED'])('explains %s without reporting deletion', async(type) => {
    const manager = managers();
    manager.appChatsManager.delete.mockRejectedValue({type});
    await expectNotDeleted(invoke(manager));
    expect(manager.appChatsManager.delete).toHaveBeenCalledOnce();
    expect(mock.toast).toHaveBeenCalledExactlyOnceWith({langPackKey: 'BlahDeleteChatIdentityRequired'});
  });

  it('preserves real deletion failures', async() => {
    const manager = managers();
    const error = {type: 'CHAT_ADMIN_REQUIRED'};
    manager.appChatsManager.delete.mockRejectedValue(error);
    await expect(invoke(manager)).rejects.toBe(error);
    expect(mock.toast).not.toHaveBeenCalled();
  });
});
