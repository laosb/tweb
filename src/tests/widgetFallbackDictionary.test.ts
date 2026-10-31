import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import I18n from '@lib/langPack';
import rootScope from '@lib/rootScope';
import {
  assertWidgetDictionaries, assertWidgetLanguageKeys, pruneWidgetDictionary,
  readWidgetDictionary, widgetFallbackKeys, widgetLanguageSignature, widgetPackKeys
} from '../../scripts/widget-language';
import manifest from '@/widget/languageKeys.json';
import exceptions from '../../tests/widget/languageExceptions.json';
import {pruneWidgetPeerTitle} from '../../scripts/widget-branches';
import widgetLanguage from '../../scripts/widget-language';

const sources = ['lang.ts', 'langSign.ts'].map((name) => readFileSync('src/' + name, 'utf8'));

it('removes only the topics pseudo-peer title and rejects a changed or duplicated branch', () => {
  const source = readFileSync('src/components/peerTitle.ts', 'utf8');
  const result = pruneWidgetPeerTitle(source);
  expect(result.toString()).not.toContain('i18n(\'AllMessages\')');
  expect(result.toString()).toContain('if(this.options.asAllChats === \'monoforum\')');
  expect(result.toString()).toContain('peerId === rootScope.myId && this.options.dialog');
  expect(result.generateMap({hires: true}).mappings).not.toBe('');
  expect(() => pruneWidgetPeerTitle(source.replace('i18n(\'AllMessages\')', 'i18n(\'Renamed\')'))).toThrow('WIDGET_BRANCH_TARGET_CHANGED');
  expect(() => pruneWidgetPeerTitle(source + source)).toThrow('WIDGET_BRANCH_TARGET_CHANGED');
});

it('prunes only definitions and preserves every allowed translation and plural form', () => {
  assertWidgetDictionaries(sources);
  const before = Object.assign({}, ...sources.map(readWidgetDictionary));
  const after = Object.assign({}, ...sources.map(pruneWidgetDictionary).map(readWidgetDictionary));
  expect(Object.keys(after).sort()).toEqual(widgetFallbackKeys);
  for(const key of widgetFallbackKeys) expect(after[key]).toEqual(before[key]);
  expect(after['Login.Title']).toBeUndefined();
  expect(after['PASSWORD_HASH_INVALID']).toBeUndefined();
  expect(Object.keys(readWidgetDictionary(pruneWidgetDictionary(sources[1])))).toEqual(manifest.startup.langSign);
});

it('fails closed when an allowlisted upstream key or dictionary contract disappears', () => {
  expect(() => assertWidgetDictionaries(sources.map((source) => source.replace('\'BfbSupport\':', '\'RenamedBfbSupport\':'))))
  .toThrow('WIDGET_LANGUAGE_KEY_MISSING: BfbSupport');
  expect(() => pruneWidgetDictionary('export default {};')).toThrow('WIDGET_LANGUAGE_DICTIONARY_CHANGED');
});

it('requires exactly the English pack and the documented hidden exceptions, without overlap', () => {
  expect(() => assertWidgetLanguageKeys(widgetPackKeys, Object.keys(exceptions))).not.toThrow();
  expect(() => assertWidgetLanguageKeys(widgetPackKeys.slice(1), Object.keys(exceptions))).toThrow('English pack');
  expect(() => assertWidgetLanguageKeys([...widgetPackKeys, 'Login.Title'], Object.keys(exceptions))).toThrow('English pack');
  expect(() => assertWidgetLanguageKeys(widgetPackKeys, [...Object.keys(exceptions), 'NewException'])).toThrow('hidden construction');
});

it('does not retain blocked consumers or computed fragments as customer labels', () => {
  for(const key of ['Files', 'Voice', 'Disable', 'AiEditor.StyleNotFound', 'BotCantAddToAttachMenu', 'LinkNotFound',
    'SharedFolder.Link.Expired', 'Error.RequestPeer.NoRights.Group', 'OpenEmojiSet', 'OpenMessage',
    'Media', 'Photos', 'Videos', 'Alert.BotAppDoesntExist', 'Alert.UserDoesntExists', 'NoUsernameFound',
    'NoStoryFound', 'Link.NotSupported', 'InviteExpired', 'PhoneCopied']) {
    expect(widgetFallbackKeys).not.toContain(key);
  }
  for(const key of ['ReplyToAnotherChat', 'AboveMessage', 'BelowMessage', 'LargerMedia', 'SmallerMedia', 'WebPage.RemovePreview']) {
    expect(widgetPackKeys).not.toContain(key);
    expect(Object.keys(exceptions)).toContain(key);
  }
  // A rejected content arm cannot resolve these; its literal is no exception.
  for(const key of ['OpenStickers', 'Media', 'Photos', 'Videos', 'Summary.Title', 'Stars']) {
    expect(widgetFallbackKeys).not.toContain(key);
  }
});

it('covers both directions and every subtype of computed checklist and TTL previews', () => {
  for(const suffix of ['', 'You']) {
    for(const stem of ['AddedTask', 'AddedTaskMany', 'MarkedDone', 'MarkedUndone', 'MarkedMixed']) {
      expect(widgetPackKeys).toContain('Checklist' + stem + suffix);
    }
  }
  for(const type of ['Photo', 'Video', 'Voice', 'Round']) {
    for(const suffix of ['', '.You', '.Expired']) expect(widgetPackKeys).toContain('SelfDestructingOnMobile.' + type + suffix);
  }
});

it('versions widget caches by retained strings, allowlist and upstream local version', () => {
  const signature = widgetLanguageSignature(sources, '12');
  expect(Number.isSafeInteger(signature)).toBe(true);
  expect(signature).not.toBe(12);
  expect(widgetLanguageSignature(sources, '13')).not.toBe(signature);
  expect(widgetLanguageSignature(sources.map((source) => source.replace('\'BfbSupport\': \'Support\'', '\'BfbSupport\': \'Help\'')), '12')).not.toBe(signature);
  expect(widgetLanguageSignature(sources.map((source) => source.replace('\'BfbSupport\': \'Support\',', '')), '12')).not.toBe(signature);
});

it('hashes the version delivered after the upstream generator, rather than an earlier file read', () => {
  const plugin = widgetLanguage(process.cwd());
  const source = 'const langPackLocalVersion = 999;export default langPackLocalVersion;';
  const transform = plugin.transform as Function;
  const result = transform.call({error: (message: string) => { throw new Error(message); }}, source, resolve('src/langPackLocalVersion.ts'));
  expect(result.code).toBe('export default ' + widgetLanguageSignature(sources, source) + ';');
});

it('loads the pruned fallback through the actual resolver, including errors and plurals', async() => {
  const pack = await I18n.loadLocalLangPack();
  expect(pack.strings.map((string) => string.key).sort()).toEqual(widgetFallbackKeys);
  const dispatch = vi.spyOn(rootScope, 'dispatchEvent').mockImplementation(() => {});
  I18n.setLangCode('en');
  I18n.applyLangPack(pack);
  for(const key of [...manifest.startup.lang, ...manifest.serverErrors.keys]) expect(I18n.format(key as any, true)).not.toBe(key);
  expect(I18n.format('Minutes', true, [1])).toBe('1 minute');
  expect(I18n.format('Minutes', true, [5])).toBe('5 minutes');
  dispatch.mockRestore();
});
