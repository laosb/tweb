import type {LangPackDifference, LangPackString} from '@layer';
import blah from '@config/blah';
import I18n from '@lib/langPack';
import commonStateStorage from '@lib/commonStateStorage';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {WIDGET_LANG_PACK} from '@/widget/config';
import {hotListen} from '@helpers/hotModule';
import withTimeout from '@helpers/schedulers/withTimeout';

type WidgetLangPack = LangPackDifference & {lang_pack: typeof WIDGET_LANG_PACK};
let english: LangPackDifference;
let englishStrings: Map<string, LangPackString>;
let applied: WidgetLangPack;
let loading: Promise<void>;
const LANGUAGE_DEADLINE = 5_000;

function validateLocale(lang: string) {
  // I18n uses both the full code and its base for dates/plurals.
  new Intl.PluralRules(lang);
  new Intl.PluralRules(lang.split('-')[0]);
  new Intl.DateTimeFormat(lang.split('-')[0]);
}

function validPack(pack: LangPackDifference) {
  return pack && Array.isArray(pack.strings) && Number.isSafeInteger(pack.version) && pack.version >= 0;
}

function validString(string: LangPackString) {
  if(!string || typeof(string.key) !== 'string') return false;
  const fallback = englishStrings.get(string.key);
  if(fallback && fallback._ !== string._) return false;
  if(string._ === 'langPackString') return typeof(string.value) === 'string';
  if(string._ !== 'langPackStringPluralized' || typeof(string.other_value) !== 'string') return false;
  return Object.entries(string).every(([key, value]) => !key.endsWith('_value') || typeof(value) === 'string');
}

/** Restore only the URL's language, with the current bundled English underneath it. */
export async function applyWidgetLanguage() {
  const lang = blah.widget.lang;
  const [pack, stored] = await Promise.all([
    I18n.loadLocalLangPack(),
    lang ? withTimeout(commonStateStorage.get('langPack'), LANGUAGE_DEADLINE).catch((): undefined => undefined) : undefined,
    I18n.polyfillPromise
  ]);
  english = pack;
  englishStrings = new Map(pack.strings.map((string) => [string.key, string]));
  applied = undefined;
  if(lang && blah.widget.lang === lang && validPack(stored) && stored.lang_code === lang && stored.localVersion === pack.localVersion &&
    (stored as WidgetLangPack).lang_pack === WIDGET_LANG_PACK && typeof stored.rtl === 'boolean') {
    try {
      validateLocale(lang);
      applied = overlayEnglish(stored);
    } catch{}
  }
  const initial = applied || english;
  I18n.setLangCode(initial.lang_code);
  I18n.applyLangPack(initial);
  const title = document.querySelector('title');
  if(title) I18n._i18n(title, 'BfbSupport', undefined, 'textContent');
  return initial;
}

function overlayEnglish(pack: LangPackDifference): WidgetLangPack {
  return {
    ...pack,
    lang_pack: WIDGET_LANG_PACK,
    localVersion: english.localVersion,
    strings: [
      ...english.strings.map((string) => ({...string, local: true})),
      ...pack.strings.filter((string: LangPackString & {local?: boolean}) => !string?.local && validString(string))
    ]
  };
}

/** A missing, unknown or unresponsive pack must not consume the widget's 45-second startup. */
export function loadWidgetLanguage(): Promise<void> {
  const lang = blah.widget.lang;
  if(!english || !lang || !blah.widget.param) return Promise.resolve();
  if(loading) return loading;
  const managers = bindManagersToSession(rootScope.managers);
  const base = applied?.lang_code === lang ? applied : undefined;
  loading = (async() => {
    let active = true;
    try {
      validateLocale(lang);
      const fetchPack = async(): Promise<WidgetLangPack> => {
        if(base) {
          try {
            const difference = await managers.appLangPackManager.getDifference(lang, base.version, WIDGET_LANG_PACK);
            if(!validPack(difference) || difference.lang_code !== lang || difference.from_version !== base.version || difference.version < base.version) {
              throw new Error('LANG_PACK_VERSION_MISMATCH');
            }
            if(difference.version === base.version) return base;
            // Replace by key as upstream does, but preserve the separate English layer:
            // deleting a remote key exposes its local fallback instead of a deletion marker.
            const strings = new Map(base.strings.filter((string: LangPackString & {local?: boolean}) => !string.local)
            .map((string) => [string.key, string]));
            for(const string of difference.strings) {
              if(string._ === 'langPackStringDeleted') strings.delete(string.key);
              else strings.set(string.key, string);
            }
            return overlayEnglish({...base, ...difference, rtl: difference.rtl ?? base.rtl, strings: [...strings.values()]});
          } catch{
            if(!active) return;
          }
        }
        // Full refreshes must bypass the manager's indefinite response cache (including
        // failed responses); invokeApiSingle still deduplicates concurrent requests.
        const [pack, language] = await Promise.all([
          managers.appLangPackManager.getLangPack(lang, WIDGET_LANG_PACK, 'no-store'),
          managers.appLangPackManager.getLanguage(lang, WIDGET_LANG_PACK, 'no-store')
        ]);
        if(!validPack(pack) || pack.lang_code !== lang || language.lang_code !== lang) return;
        return overlayEnglish({...pack, rtl: pack.rtl ?? !!language.pFlags.rtl});
      };
      const result = await withTimeout(fetchPack(), LANGUAGE_DEADLINE);
      // All application/persistence happens outside the race: late results have no effects.
      if(!result || result === base || blah.widget.lang !== lang) return;
      I18n.setLangCode(lang);
      I18n.applyLangPack(result);
      applied = result;
      // saveLangPack applies AFTER its storage write. Use its store directly so a blocked
      // or failed write cannot delay startup or apply an obsolete pack after a deadline.
      void commonStateStorage.set({langPack: result}).catch(() => {});
    } catch{
      // Keep bundled English (or the last successfully applied pack on a push refresh).
    } finally {
      active = false;
    }
  })().finally(() => { loading = undefined; });
  return loading;
}

// The upstream handlers use the ordinary client's pack; widget pushes catch up from ours.
hotListen(import.meta.hot, rootScope, 'langpack_update', ({difference}) => {
  if(difference.lang_code === blah.widget.lang) void loadWidgetLanguage();
});
hotListen(import.meta.hot, rootScope, 'langpack_update_too_long', ({lang_code}) => {
  if(lang_code === blah.widget.lang) void loadWidgetLanguage();
});
