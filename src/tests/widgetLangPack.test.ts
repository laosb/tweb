import type {LangPackDifference} from '@layer';
import blah from '@config/blah';
import I18n, {i18n} from '@lib/langPack';
import rootScope from '@lib/rootScope';
import commonStateStorage from '@lib/commonStateStorage';
import {applyWidgetLanguage, loadWidgetLanguage} from '@/widget/langPack';

vi.mock('@config/blah', () => ({default: {widget: {param: 'pins', lang: 'ar'}}}));
vi.mock('@lib/accounts/bindManagersToAccount', () => ({bindManagersToSession: (managers: unknown) => managers}));
const pack = vi.fn(), language = vi.fn(), difference = vi.fn();
let stored: LangPackDifference & {lang_pack?: string};
let local: LangPackDifference;
const remote = (lang = 'ar'): LangPackDifference => ({
  _: 'langPackDifference', lang_code: lang, from_version: 0, version: 1,
  strings: [
    {_: 'langPackString', key: 'BfbConnecting', value: 'جارٍ الاتصال بالدعم…'},
    {_: 'langPackString', key: 'BfbSupport', value: 'الدعم'}
  ]
});
const cached = (lang = 'ar') => ({
  ...remote(lang), lang_pack: 'webk_bfb', localVersion: local.localVersion, rtl: true,
  strings: [...local.strings.map((string) => ({...string, local: true})), ...remote(lang).strings]
});
const deferred = <T>() => {
  let resolve: (value: T) => void, reject: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
};

beforeEach(async() => {
  vi.useFakeTimers();
  vi.spyOn(rootScope, 'dispatchEvent').mockImplementation(() => {});
  stored = undefined;
  vi.spyOn(commonStateStorage, 'get').mockImplementation(async() => structuredClone(stored) as any);
  vi.spyOn(commonStateStorage, 'set').mockImplementation(async({langPack}) => { stored = structuredClone(langPack); });
  rootScope.managers = {appLangPackManager: {getLangPack: pack, getLanguage: language, getDifference: difference}} as any;
  blah.widget.lang = 'ar';
  document.head.innerHTML = '<title>Support</title>';
  document.body.replaceChildren();
  pack.mockResolvedValue(remote());
  language.mockResolvedValue({lang_code: 'ar', pFlags: {rtl: true}});
  difference.mockResolvedValue({...remote(), from_version: 1, version: 2, strings: []});
  local = await I18n.loadLocalLangPack();
  await applyWidgetLanguage();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it('fetches and persists webk_bfb, overlays English and updates existing status elements in RTL', async() => {
  const status = i18n('BfbConnecting'), retry = i18n('BfbReconnect');
  document.body.append(status, retry);
  expect(status.textContent).toBe('Connecting to support…');
  await loadWidgetLanguage();
  expect(pack).toHaveBeenCalledExactlyOnceWith('ar', 'webk_bfb', 'no-store');
  expect(language).toHaveBeenCalledExactlyOnceWith('ar', 'webk_bfb', 'no-store');
  expect(difference).not.toHaveBeenCalled();
  expect(status.textContent).toBe('جارٍ الاتصال بالدعم…');
  expect(retry.textContent).toBe('Reconnect');
  expect(retry.querySelector('[dir="ltr"]')).not.toBeNull();
  expect(document.documentElement.dir).toBe('rtl');
  expect(document.documentElement.lang).toBe('ar');
  expect(document.title).toBe('الدعم');
  expect(stored).toMatchObject({lang_pack: 'webk_bfb', lang_code: 'ar', version: 1, rtl: true, localVersion: local.localVersion});
});

it('applies the persisted matching pack before any RPC and fetches only its difference', async() => {
  await loadWidgetLanguage();
  vi.clearAllMocks();
  await applyWidgetLanguage();
  expect(i18n('BfbConnecting').textContent).toBe('جارٍ الاتصال بالدعم…');
  expect(document.title).toBe('الدعم');
  expect(document.documentElement.dir).toBe('rtl');
  expect(pack).not.toHaveBeenCalled();
  expect(language).not.toHaveBeenCalled();
  expect(difference).not.toHaveBeenCalled();
  await loadWidgetLanguage();
  expect(difference).toHaveBeenCalledExactlyOnceWith('ar', 1, 'webk_bfb');
  expect(pack).not.toHaveBeenCalled();
  expect(language).not.toHaveBeenCalled();
  expect(stored.version).toBe(2);
});

it.each(['another-language', 'no-language', 'stale-local-version', 'ordinary-pack', 'invalid-locale'])(
  'ignores a cached %s without deleting it', async(reason) => {
    stored = cached();
    if(reason === 'another-language') stored.lang_code = 'de';
    if(reason === 'no-language') blah.widget.lang = undefined;
    if(reason === 'stale-local-version') stored.localVersion--;
    if(reason === 'ordinary-pack') delete stored.lang_pack;
    if(reason === 'invalid-locale') stored.lang_code = blah.widget.lang = '1';
    const previous = structuredClone(stored);
    await applyWidgetLanguage();
    expect(I18n.format('BfbConnecting', true)).toBe('Connecting to support…');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(stored).toEqual(previous);
    await loadWidgetLanguage();
    expect(difference).not.toHaveBeenCalled();
    expect(pack).toHaveBeenCalledTimes(['no-language', 'invalid-locale'].includes(reason) ? 0 : 1);
  }
);

it('merges changed and plural strings, retains unchanged strings and exposes English on deletion', async() => {
  stored = cached();
  await applyWidgetLanguage();
  difference.mockResolvedValue({...remote(), from_version: 1, version: 3, strings: [
    {_: 'langPackStringDeleted', key: 'BfbConnecting'},
    {_: 'langPackString', key: 'BfbReconnect', value: 'إعادة الاتصال'},
    {_: 'langPackStringPluralized', key: 'Minutes', one_value: 'دقيقة', other_value: 'دقائق'}
  ]});
  await loadWidgetLanguage();
  expect(I18n.format('BfbConnecting', true)).toBe('Connecting to support…');
  expect(i18n('BfbConnecting').querySelector('[dir="ltr"]')).not.toBeNull();
  expect(I18n.format('BfbReconnect', true)).toBe('إعادة الاتصال');
  expect(I18n.format('BfbSupport', true)).toBe('الدعم');
  expect(stored).toMatchObject({version: 3, from_version: 1, rtl: true, localVersion: local.localVersion});
  expect(stored.strings.filter((string) => string.key === 'BfbReconnect' && !(string as any).local)).toHaveLength(1);
  expect(stored.strings.some((string) => string._ === 'langPackStringDeleted')).toBe(false);
  expect(stored.strings).toContainEqual({_: 'langPackStringPluralized', key: 'Minutes', one_value: 'دقيقة', other_value: 'دقائق'});
  await applyWidgetLanguage();
  expect(I18n.format('BfbConnecting', true)).toBe('Connecting to support…');
  expect(I18n.format('BfbReconnect', true)).toBe('إعادة الاتصال');
});

it.each(['error', 'version-mismatch', 'wrong-language'])('falls back to a fresh full pack after difference %s', async(reason) => {
  stored = cached();
  await applyWidgetLanguage();
  if(reason === 'error') difference.mockRejectedValue(new Error('offline'));
  else difference.mockResolvedValue({...remote(reason === 'wrong-language' ? 'de' : 'ar'), from_version: 0});
  pack.mockResolvedValue({...remote(), version: 5, strings: []});
  language.mockResolvedValue({lang_code: 'ar', pFlags: {}});
  await loadWidgetLanguage();
  expect(pack).toHaveBeenCalledExactlyOnceWith('ar', 'webk_bfb', 'no-store');
  expect(language).toHaveBeenCalledExactlyOnceWith('ar', 'webk_bfb', 'no-store');
  expect(stored.version).toBe(5);
  expect(document.documentElement.dir).toBe('ltr');
  expect(I18n.format('BfbConnecting', true)).toBe('Connecting to support…');
});

it('honours explicit pack RTL over metadata and keeps it at the next boot', async() => {
  pack.mockResolvedValue({...remote(), rtl: false});
  await loadWidgetLanguage();
  await applyWidgetLanguage();
  expect(document.documentElement.dir).toBe('ltr');
  expect(stored.rtl).toBe(false);
});

it.each(['pack', 'metadata', 'unknown', 'invalid-locale'])('keeps English on %s failure', async(failure) => {
  if(failure === 'pack') pack.mockRejectedValue({type: 'LANG_PACK_INVALID'});
  if(failure === 'metadata') language.mockRejectedValue(new Error('offline'));
  if(failure === 'unknown') language.mockResolvedValue({lang_code: 'en', pFlags: {}});
  if(failure === 'invalid-locale') blah.widget.lang = '1';
  await loadWidgetLanguage();
  expect(I18n.format('BfbConnecting', true)).toBe('Connecting to support…');
  expect(document.documentElement.lang).toBe('en');
  expect(stored).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['resolve', 'reject'])('bounds a hung difference and ignores its late %s', async(completion) => {
  stored = cached();
  await applyWidgetLanguage();
  const pending = deferred<LangPackDifference>();
  difference.mockReturnValue(pending.promise);
  const loaded = loadWidgetLanguage();
  await vi.advanceTimersByTimeAsync(5_000);
  await loaded;
  if(completion === 'resolve') pending.resolve({...remote(), from_version: 1, version: 2, strings: []});
  else pending.reject(new Error('offline'));
  await vi.advanceTimersByTimeAsync(1);
  expect(stored.version).toBe(1);
  expect(pack).not.toHaveBeenCalled();
  expect(I18n.format('BfbConnecting', true)).toBe('جارٍ الاتصال بالدعم…');
  expect(commonStateStorage.set).not.toHaveBeenCalled();
});

it.each([false, true])('bounds full fetch including fallback=%s within one deadline and ignores late completion', async(fallback) => {
  if(fallback) {
    stored = cached();
    await applyWidgetLanguage();
    difference.mockImplementation(async() => {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      throw new Error('offline');
    });
  }
  const pending = deferred<LangPackDifference>();
  pack.mockReturnValue(pending.promise);
  const loaded = loadWidgetLanguage();
  await vi.advanceTimersByTimeAsync(5_000);
  await loaded;
  pending.resolve({...remote(), version: 8});
  await vi.advanceTimersByTimeAsync(1);
  expect(document.documentElement.lang).toBe(fallback ? 'ar' : 'en');
  expect(stored?.version).toBe(fallback ? 1 : undefined);
  expect(commonStateStorage.set).not.toHaveBeenCalled();
});

it('bounds a hung cache read and ignores its late completion', async() => {
  const pending = deferred<LangPackDifference>();
  vi.mocked(commonStateStorage.get).mockReturnValue(pending.promise as any);
  const boot = applyWidgetLanguage();
  await vi.advanceTimersByTimeAsync(5_000);
  await boot;
  pending.resolve(cached());
  await vi.advanceTimersByTimeAsync(1);
  expect(document.documentElement.lang).toBe('en');
  expect(pack).not.toHaveBeenCalled();
});

it.each(['read', 'write', 'hung-write'])('does not fail startup on storage %s failure', async(failure) => {
  if(failure === 'read') vi.mocked(commonStateStorage.get).mockRejectedValue(new Error('unavailable'));
  else vi.mocked(commonStateStorage.set).mockImplementation(() => failure === 'hung-write' ? new Promise(() => {}) : Promise.reject(new Error('unavailable')));
  await applyWidgetLanguage();
  await loadWidgetLanguage();
  expect(document.documentElement.lang).toBe('ar');
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['langpack_update', 'langpack_update_too_long'] as const)('catches up matching %s pushes with difference then full on failure', async(event) => {
  stored = cached();
  await applyWidgetLanguage();
  const push = (lang: string) => {
    if(event === 'langpack_update') rootScope.dispatchEventSingle(event, {difference: remote(lang)});
    else rootScope.dispatchEventSingle(event, {lang_code: lang});
  };
  push('de');
  expect(difference).not.toHaveBeenCalled();
  difference.mockResolvedValue({...remote(), from_version: 1, version: 2, strings: [{_: 'langPackStringDeleted', key: 'BfbConnecting'}]});
  push('ar');
  await loadWidgetLanguage();
  expect(difference).toHaveBeenCalledExactlyOnceWith('ar', 1, 'webk_bfb');
  expect(I18n.format('BfbConnecting', true)).toBe('Connecting to support…');
  expect(pack).not.toHaveBeenCalled();
  difference.mockRejectedValue(new Error('offline'));
  pack.mockResolvedValue({...remote(), version: 3});
  push('ar');
  await loadWidgetLanguage();
  expect(difference).toHaveBeenLastCalledWith('ar', 2, 'webk_bfb');
  expect(pack).toHaveBeenCalledTimes(1);
  expect(stored.version).toBe(3);
});

it('keeps the applied cache when both difference and full fetch fail', async() => {
  stored = cached();
  const original = structuredClone(stored);
  await applyWidgetLanguage();
  difference.mockRejectedValue(new Error('offline'));
  pack.mockRejectedValue(new Error('offline'));
  await loadWidgetLanguage();
  expect(stored).toEqual(original);
  expect(I18n.format('BfbConnecting', true)).toBe('جارٍ الاتصال بالدعم…');
  expect(commonStateStorage.set).not.toHaveBeenCalled();
});

it('does not apply or persist a result after the URL language changes', async() => {
  const pending = deferred<LangPackDifference>();
  pack.mockReturnValue(pending.promise);
  const loaded = loadWidgetLanguage();
  blah.widget.lang = undefined;
  pending.resolve(remote());
  await loaded;
  expect(document.documentElement.lang).toBe('en');
  expect(commonStateStorage.set).not.toHaveBeenCalled();
});

it('does not reapply or rewrite a cache already at the server version', async() => {
  stored = cached();
  await applyWidgetLanguage();
  const apply = vi.spyOn(I18n, 'applyLangPack');
  difference.mockResolvedValue({...remote(), from_version: 1, strings: []});
  await loadWidgetLanguage();
  expect(apply).not.toHaveBeenCalled();
  expect(commonStateStorage.set).not.toHaveBeenCalled();
  expect(pack).not.toHaveBeenCalled();
  expect(language).not.toHaveBeenCalled();
});
