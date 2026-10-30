import type {LangPackDifference} from '@layer';
import blah from '@config/blah';
import I18n from '@lib/langPack';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {WIDGET_LANG_PACK} from '@/widget/config';
import {hotListen} from '@helpers/hotModule';

let english: LangPackDifference;
let loading: Promise<void>;

/** Never restore a previous page's language: the embedding page chooses it on every load. */
export async function applyWidgetEnglish() {
  const [pack] = await Promise.all([I18n.loadLocalLangPack(), I18n.polyfillPromise]);
  english = pack;
  I18n.setLangCode('en');
  I18n.applyLangPack(pack);
  const title = document.querySelector('title');
  if(title) I18n._i18n(title, 'BfbSupport', undefined, 'textContent');
  return pack;
}

/** A missing, unknown or unresponsive pack must not consume the widget's 45-second startup. */
export function loadWidgetLanguage(): Promise<void> {
  const lang = blah.widget.lang;
  if(!english || !lang || !blah.widget.param) return Promise.resolve();
  if(loading) return loading;
  const managers = bindManagersToSession(rootScope.managers);
  loading = (async() => {
    let timer: ReturnType<typeof setTimeout>;
    try {
      const result = await Promise.race([
        Promise.all([
          managers.appLangPackManager.getLangPack(lang, WIDGET_LANG_PACK, true),
          managers.appLangPackManager.getLanguage(lang, WIDGET_LANG_PACK)
        ]),
        new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), 5_000); })
      ]);
      // Late RPC completions cannot apply a pack after the timeout.
      if(!result) return;
      const [pack, language] = result;
      if(pack.lang_code !== lang || language.lang_code !== lang) return;
      // I18n uses both the full code and its base for dates/plurals. Reject unusable codes
      // before changing its state, even if a DC accepts an arbitrary custom language name.
      new Intl.PluralRules(lang);
      new Intl.PluralRules(lang.split('-')[0]);
      new Intl.DateTimeFormat(lang.split('-')[0]);
      const localizedPack: LangPackDifference = {
        ...pack,
        rtl: !!language.pFlags.rtl,
        strings: [
          ...english.strings.map((string) => ({...string, local: true})),
          ...pack.strings.filter((string) => string._ !== 'langPackStringDeleted')
        ]
      };
      I18n.setLangCode(lang);
      I18n.applyLangPack(localizedPack);
    } catch{
      // Keep bundled English (or the last successfully applied pack on a push refresh).
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => { loading = undefined; });
  return loading;
}

// Full replacement is small for this platform and also restores English for deleted keys.
// The upstream handlers use the ordinary client's stored `web` pack, so the widget owns these.
hotListen(import.meta.hot, rootScope, 'langpack_update', ({difference}) => {
  if(difference.lang_code === blah.widget.lang) void loadWidgetLanguage();
});
hotListen(import.meta.hot, rootScope, 'langpack_update_too_long', ({lang_code}) => {
  if(lang_code === blah.widget.lang) void loadWidgetLanguage();
});
