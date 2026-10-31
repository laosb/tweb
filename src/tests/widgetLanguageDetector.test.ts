import {createRoot} from 'solid-js';
import detectLanguage from '@/widget/omitted/languageDetector';
import usePeerLanguage, {processMessageForTranslation} from '@stores/peerLanguage';

const messages = vi.hoisted(() => new Map());
vi.mock('@lib/tinyld/detect', async() => import('@/widget/omitted/languageDetector'));
vi.mock('@lib/apiManagerProxy', () => ({default: {getMessageByPeer: (_peer: PeerId, mid: number) => messages.get(mid)}}));
vi.mock('@lib/rootScope', () => ({default: {addEventListener() {}}}));
vi.mock('@lib/richMessage', () => ({flattenRichMessageContent: (message: any) => ({text: message.message})}));
vi.mock('@lib/langPack', () => ({default: {langCodeNormalized: () => 'en'}}));
vi.mock('@stores/appSettings', () => ({useAppSettings: () => [{translations: {doNotTranslate: [] as TranslatableLanguageISO[]}}]}));

it('settles to no language and releases every operation in the actual translation store', async() => {
  await expect(detectLanguage('Support text')).resolves.toBeUndefined();
  let pending: Map<string, unknown>;
  const set = Map.prototype.set;
  const spy = vi.spyOn(Map.prototype, 'set').mockImplementation(function(this: Map<string, any>, key, value) {
    if(typeof(key) === 'string' && key.startsWith('42_') && value?.promise) pending = this;
    return set.call(this, key, value);
  });
  let dispose: () => void;
  try {
    const language = createRoot(cleanup => {
      dispose = cleanup;
      return usePeerLanguage(() => 42 as PeerId, true);
    });
    const operations = Array.from({length: 100}, (_, index) => {
      const mid = index + 1;
      const message = {_: 'message', mid, peerId: 42, message: 'Support text ' + mid, pFlags: {}};
      messages.set(mid, message);
      return processMessageForTranslation(42 as PeerId, mid, message as any);
    });
    expect(pending.size).toBe(100);
    await Promise.all(operations);
    expect(pending.size).toBe(0);
    expect(language()).toBeUndefined();
  } finally {
    spy.mockRestore();
    dispose?.();
  }
});
