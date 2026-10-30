import blah from '@config/blah';
import I18n, {i18n} from '@lib/langPack';
import rootScope from '@lib/rootScope';
import commonStateStorage from '@lib/commonStateStorage';
import {applyWidgetEnglish, loadWidgetLanguage} from '@/widget/langPack';

vi.mock('@config/blah', () => ({default: {widget: {param: 'pins', lang: 'ar'}}}));
vi.mock('@lib/accounts/bindManagersToAccount', () => ({bindManagersToSession: (managers: unknown) => managers}));
const pack = vi.fn(), language = vi.fn();
const remote = (lang = 'ar') => ({
  _: 'langPackDifference', lang_code: lang, from_version: 0, version: 1,
  strings: [
    {_: 'langPackString', key: 'BfbConnecting', value: 'جارٍ الاتصال بالدعم…'},
    {_: 'langPackString', key: 'BfbSupport', value: 'الدعم'}
  ]
});

beforeEach(async() => {
  vi.useFakeTimers();
  vi.spyOn(rootScope, 'dispatchEvent').mockImplementation(() => {});
  rootScope.managers = {appLangPackManager: {getLangPack: pack, getLanguage: language}} as any;
  blah.widget.lang = 'ar';
  document.head.innerHTML = '<title>Support</title>';
  document.body.replaceChildren();
  pack.mockResolvedValue(remote());
  language.mockResolvedValue({lang_code: 'ar', pFlags: {rtl: true}});
  await applyWidgetEnglish();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('fetches only webk_bfb, overlays English and updates existing status elements in RTL', async() => {
  const status = i18n('BfbConnecting'), retry = i18n('BfbReconnect');
  document.body.append(status, retry);
  expect(status.textContent).toBe('Connecting to support…');
  await loadWidgetLanguage();
  expect(pack).toHaveBeenCalledExactlyOnceWith('ar', 'webk_bfb', true);
  expect(language).toHaveBeenCalledExactlyOnceWith('ar', 'webk_bfb');
  expect(status.textContent).toBe('جارٍ الاتصال بالدعم…');
  expect(retry.textContent).toBe('Reconnect');
  expect(retry.querySelector('[dir="ltr"]')).not.toBeNull();
  expect(document.documentElement.dir).toBe('rtl');
  expect(document.documentElement.lang).toBe('ar');
  expect(document.title).toBe('الدعم');
  expect(I18n.getLastRequestedLangCode()).toBe('ar');
});

it('starts fresh in English without consulting or writing a cached pack', async() => {
  const read = vi.spyOn(commonStateStorage, 'get');
  const write = vi.spyOn(commonStateStorage, 'set');
  await loadWidgetLanguage();
  blah.widget.lang = undefined;
  await applyWidgetEnglish();
  await loadWidgetLanguage();
  expect(I18n.format('BfbConnecting', true)).toBe('Connecting to support…');
  expect(document.documentElement.lang).toBe('en');
  expect(document.documentElement.dir).toBe('ltr');
  expect(pack).toHaveBeenCalledTimes(1);
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  blah.widget.lang = 'de';
  pack.mockRejectedValue({type: 'LANG_CODE_NOT_SUPPORTED'});
  await loadWidgetLanguage();
  expect(I18n.format('BfbConnecting', true)).toBe('Connecting to support…');
});

it.each(['pack', 'metadata', 'unknown', 'invalid-locale'])('keeps English on %s failure', async(failure) => {
  if(failure === 'pack') pack.mockRejectedValue({type: 'LANG_PACK_INVALID'});
  if(failure === 'metadata') language.mockRejectedValue(new Error('offline'));
  if(failure === 'unknown') language.mockResolvedValue({lang_code: 'en', pFlags: {}});
  if(failure === 'invalid-locale') {
    blah.widget.lang = '1';
    pack.mockResolvedValue(remote('1'));
    language.mockResolvedValue({lang_code: '1', pFlags: {}});
  }
  await loadWidgetLanguage();
  expect(I18n.format('BfbConnecting', true)).toBe('Connecting to support…');
  expect(document.documentElement.lang).toBe('en');
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds a hung fetch and ignores its eventual completion', async() => {
  let resolve: (value: unknown) => void;
  pack.mockReturnValue(new Promise((done) => { resolve = done; }));
  const loaded = loadWidgetLanguage();
  await vi.advanceTimersByTimeAsync(5_000);
  await loaded;
  resolve(remote());
  await vi.advanceTimersByTimeAsync(1);
  expect(I18n.format('BfbConnecting', true)).toBe('Connecting to support…');
  expect(document.documentElement.lang).toBe('en');
});

it('refreshes matching pushes and restores English for removed strings', async() => {
  await loadWidgetLanguage();
  pack.mockResolvedValue({...remote(), strings: [{_: 'langPackStringDeleted', key: 'BfbConnecting'}]});
  rootScope.dispatchEventSingle('langpack_update', {difference: remote('de') as any});
  expect(pack).toHaveBeenCalledTimes(1);
  rootScope.dispatchEventSingle('langpack_update', {difference: remote() as any});
  await loadWidgetLanguage();
  expect(pack).toHaveBeenCalledTimes(2);
  expect(I18n.format('BfbConnecting', true)).toBe('Connecting to support…');
  rootScope.dispatchEventSingle('langpack_update_too_long', {lang_code: 'ar'});
  await loadWidgetLanguage();
  expect(pack).toHaveBeenCalledTimes(3);
});
