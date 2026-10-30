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
