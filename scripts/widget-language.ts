import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import MagicString from 'magic-string';
import type {Plugin} from 'vite';
import manifest from '../src/widget/languageKeys.json';
import exceptions from '../tests/widget/languageExceptions.json';
import {widgetFallbackKeys, assertWidgetLanguageKeys} from '../src/widget/languageKeys.mjs';
export {widgetPackKeys, widgetFallbackKeys, assertWidgetLanguageKeys} from '../src/widget/languageKeys.mjs';

type Dictionary = Record<string, string | Record<string, string>>;
export function readWidgetDictionary(source: string): Dictionary {
  // Both upstream modules are data-only. A new export or executable setup needs review.
  if(!/^const lang = \{[\s\S]*\};\s*export default lang;\s*$/.test(source)) {
    throw new Error('WIDGET_LANGUAGE_DICTIONARY_CHANGED');
  }
  return runInNewContext(source.replace('export default lang;', 'lang;'));
}

export function pruneWidgetDictionary(source: string) {
  const dictionary = readWidgetDictionary(source);
  const allowed = new Set(widgetFallbackKeys);
  const strings = Object.fromEntries(Object.entries(dictionary).filter(([key]) => allowed.has(key)));
  return 'const lang = ' + JSON.stringify(strings) + ';\nexport default lang;\n';
}

export function widgetLanguageSignature(sources: string[], version: string) {
  // A widget allowlist/translation edit must invalidate a full-client or old-widget cache too.
  return parseInt(createHash('sha256').update(JSON.stringify([version, ...sources.map(pruneWidgetDictionary)]))
  .digest('hex').slice(0, 12), 16);
}

export function assertWidgetDictionaries(sources: string[]) {
  const dictionaries = sources.map(readWidgetDictionary);
  const all = Object.assign({}, ...dictionaries);
  for(const key of widgetFallbackKeys) {
    const value = all[key];
    if(typeof(value) !== 'string' && !(value && typeof(value.other_value) === 'string')) {
      throw new Error('WIDGET_LANGUAGE_KEY_MISSING: ' + key);
    }
  }
  for(const [index, name] of ['lang', 'langSign'].entries()) {
    for(const key of manifest.startup[name as 'lang' | 'langSign']) {
      if(!Object.prototype.hasOwnProperty.call(dictionaries[index], key)) throw new Error('WIDGET_LANGUAGE_STARTUP_KEY_MISSING: ' + key);
    }
  }
}

export default function widgetLanguage(root: string): Plugin {
  const filenames = ['lang.ts', 'langSign.ts'];
  const paths = filenames.map((name) => resolve(root, 'src', name));
  const versionPath = resolve(root, 'src/langPackLocalVersion.ts');
  return {
    name: 'widget-language',
    enforce: 'pre',
    apply: (config) => !config.build?.lib,
    buildStart() {
      const directory = process.env.WIDGET_LANGPACK_DIR;
      assertWidgetLanguageKeys(directory ? readdirSync(directory, {withFileTypes: true})
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name) : undefined, Object.keys(exceptions));
      const sources = paths.map((path) => readFileSync(path, 'utf8'));
      assertWidgetDictionaries(sources);
    },
    transform(source, id) {
      if(paths.includes(id)) {
        const result = new MagicString(source).overwrite(0, source.length, pruneWidgetDictionary(source));
        return {code: result.toString(), map: result.generateMap({hires: true})};
      }
      if(id !== versionPath) return;
      if(!/^const langPackLocalVersion = \d+;\s*export default langPackLocalVersion;\s*$/.test(source)) {
        this.error('WIDGET_LANGUAGE_VERSION_CHANGED');
      }
      // Use the version delivered after upstream's language generator has run.
      const signature = widgetLanguageSignature(paths.map((path) => readFileSync(path, 'utf8')), source);
      return {code: 'export default ' + signature + ';', map: {mappings: ''}};
    }
  };
}
