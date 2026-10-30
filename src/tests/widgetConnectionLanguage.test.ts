import blah from '@config/blah';
import App from '@config/app';
import {NetworkerFactory} from '@appManagers/networkerFactory';
import {AppLangPackManager} from '@appManagers/appLangPackManager';

vi.mock('@config/blah', () => ({default: {widget: {param: 'pins', lang: 'zh-hans'}}}));
vi.mock('@lib/mtproto/networker', () => ({default: class {}}));
vi.mock('@environment/utils', () => ({getEnvironment: () => ({USER_AGENT: 'Widget test'})}));

it('reports webk_bfb and the URL language even before the pack is applied', () => {
  const factory = new NetworkerFactory();
  factory.language = 'de'; // a restored ordinary-client language cannot win
  const params = (factory as any).getCommonOptions().getInitConnectionParams();
  expect(params.langPack).toBe('webk_bfb');
  expect(params.langCode).toBe('zh-hans');
  blah.widget.lang = undefined;
  expect((factory as any).getCommonOptions().getInitConnectionParams().langCode).toBe('en');
});

it('keeps the ordinary client connection parameters unchanged', () => {
  const widget = blah.widget;
  blah.widget = undefined;
  try {
    const factory = new NetworkerFactory();
    factory.language = 'fr';
    const params = (factory as any).getCommonOptions().getInitConnectionParams();
    expect(params.langPack).toBe(App.langPack);
    expect(params.langCode).toBe('fr');
  } finally {
    blah.widget = widget;
  }
});

it('passes the widget platform through both manager RPCs', async() => {
  const manager = new AppLangPackManager();
  const invoke = vi.fn().mockResolvedValue({});
  Object.assign(manager, {apiManager: {invokeApiCacheable: invoke}});
  await manager.getLangPack('zh-hans', 'webk_bfb', true);
  await manager.getLanguage('zh-hans', 'webk_bfb');
  expect(invoke).toHaveBeenNthCalledWith(1, 'langpack.getLangPack', {lang_code: 'zh-hans', lang_pack: 'webk_bfb'}, {override: true});
  expect(invoke).toHaveBeenNthCalledWith(2, 'langpack.getLanguage', {lang_code: 'zh-hans', lang_pack: 'webk_bfb'});
});

it('selects the widget difference platform without changing the ordinary default', async() => {
  const manager = new AppLangPackManager();
  const invoke = vi.fn().mockResolvedValue({});
  Object.assign(manager, {apiManager: {invokeApi: invoke}});
  await manager.getDifference('ar', 7, 'webk_bfb');
  await manager.getDifference('de', 4);
  expect(invoke).toHaveBeenNthCalledWith(1, 'langpack.getDifference', {lang_code: 'ar', from_version: 7, lang_pack: 'webk_bfb'});
  expect(invoke).toHaveBeenNthCalledWith(2, 'langpack.getDifference', {lang_code: 'de', from_version: 4, lang_pack: App.langPack});
});

it('allows fresh full packs and metadata without changing existing cached calls', async() => {
  const manager = new AppLangPackManager();
  const fresh = vi.fn().mockResolvedValue({}), cached = vi.fn().mockResolvedValue({});
  Object.assign(manager, {apiManager: {invokeApiSingle: fresh, invokeApiCacheable: cached}});
  await manager.getLangPack('ar', 'webk_bfb', 'no-store');
  await manager.getLanguage('ar', 'webk_bfb', 'no-store');
  expect(fresh).toHaveBeenNthCalledWith(1, 'langpack.getLangPack', {lang_code: 'ar', lang_pack: 'webk_bfb'});
  expect(fresh).toHaveBeenNthCalledWith(2, 'langpack.getLanguage', {lang_code: 'ar', lang_pack: 'webk_bfb'});
  expect(cached).not.toHaveBeenCalled();
  await manager.getLangPack('de', 'web');
  await manager.getLanguage('de', 'web');
  expect(cached).toHaveBeenNthCalledWith(1, 'langpack.getLangPack', {lang_code: 'de', lang_pack: 'web'}, {override: undefined});
  expect(cached).toHaveBeenNthCalledWith(2, 'langpack.getLanguage', {lang_code: 'de', lang_pack: 'web'});
});
