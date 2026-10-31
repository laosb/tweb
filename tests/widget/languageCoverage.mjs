import assert from 'node:assert/strict';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

export async function readEnglishPack(directory) {
  const strings = [];
  for(const entry of await readdir(directory, {withFileTypes: true})) {
    if(!entry.isDirectory()) continue;
    const forms = await readdir(join(directory, entry.name));
    assert(forms.length && (forms.length === 1 && forms[0] === 'value' ||
      forms.includes('other') && forms.every(form => ['zero', 'one', 'two', 'few', 'many', 'other'].includes(form))), entry.name + ': invalid forms');
    const string = {_: forms[0] === 'value' ? 'langPackString' : 'langPackStringPluralized', key: entry.name};
    for(const form of forms) {
      const value = await readFile(join(directory, entry.name, form), 'utf8');
      assert(value.endsWith('\n') && !value.endsWith('\n\n'), entry.name + ': expected one final newline');
      string[form === 'value' ? form : form + '_value'] = value.slice(0, -1);
    }
    strings.push(string);
  }
  return strings;
}

// A harness-only transform at the resolver catches plain text, DOM/ARIA, plurals
// and computed keys alike. No hook or recorder is shipped to customers.
export function languageCoveragePlugin(strings) {
  const originals = {};
  for(const filename of ['lang.ts', 'langSign.ts']) {
    const source = readFileSync(new URL('../../src/' + filename, import.meta.url), 'utf8');
    Object.assign(originals, runInNewContext(source.replace('export default lang;', 'lang;')));
  }
  for(const string of strings) {
    const value = originals[string.key];
    const expected = typeof value === 'string' ? {_: 'langPackString', key: string.key, value} :
      {_: 'langPackStringPluralized', key: string.key, ...value};
    assert.deepEqual(string, expected, 'Widget English differs from source: ' + string.key);
  }
  let resolver = false, overlay = false;
  return {
    name: 'widget-language-coverage',
    enforce: 'pre',
    transform(source, id) {
      if(id.endsWith('/src/lib/langPack.ts')) {
        const needle = 'const str = strings.get(key);';
        assert.equal(source.split(needle).length, 2, 'I18n resolver changed');
        resolver = true;
        return source.replace(needle, needle + '\n(globalThis as any).__widgetLangRecord?.(key, !str ? "missing" : (str as any).local ? "bundled" : "pack");');
      }
      if(id.endsWith('/src/widget/index.ts')) {
        return source + '\n(window as any).widgetLanguageFixtures = () => import("../../tests/widget/languageFixtures");';
      }
      if(id.endsWith('/src/widget/langPack.ts')) {
        const needle = 'const initial = applied || english;';
        assert.equal(source.split(needle).length, 2, 'Widget language bootstrap changed');
        overlay = true;
        return source.replace(needle, `const fixtureStrings = ${JSON.stringify(strings)};
        const initial = {...english, strings: [...english.strings.map(string => ({...string, local: true})), ...fixtureStrings]} as typeof english;`);
      }
    },
    buildEnd() {
      assert(resolver && overlay, 'Language recorder must instrument both resolver and widget bootstrap');
    }
  };
}

export async function installLanguageRecorder(context, records) {
  context.on('console', message => {
    const text = message.text();
    if(!text.startsWith('WIDGET_I18N ')) return;
    const record = JSON.parse(text.slice(12));
    const id = record.key + '\0' + record.source;
    records.set(id, record);
  });
  await context.addInitScript(() => {
    if(!window.parent || window.parent === window) return;
    const seen = new Set();
    window.__widgetLangRecord = (key, source) => {
      const id = key + '\0' + source;
      if(seen.has(id)) return;
      seen.add(id);
      console.debug('WIDGET_I18N ' + JSON.stringify({key, source}));
    };
  });
}

export async function checkLanguageCoverage(records, strings, artifacts, exceptions = {}) {
  const entries = [...records.values()].sort((a, b) => a.key.localeCompare(b.key) || a.source.localeCompare(b.source));
  await writeFile(join(artifacts, 'language-resolutions.json'), JSON.stringify(entries, null, 2) + '\n');
  const keys = new Set(strings.map(string => string.key));
  const missing = [...new Set(entries.filter(record => !keys.has(record.key)).map(record => record.key))];
  await writeFile(join(artifacts, 'language-missing.json'), JSON.stringify(missing, null, 2) + '\n');
  assert(entries.length, 'No widget I18n resolutions recorded');
  assert.deepEqual(missing.filter(key => !Object.hasOwn(exceptions, key) || !exceptions[key]), [], 'Widget resolved keys missing from WIDGET_LANGPACK_DIR');
  console.log(`PASS language coverage: ${new Set(entries.map(record => record.key)).size} resolved keys, ${missing.length} documented hidden-construction exceptions`);
}

export async function checkVisibleLanguage(frame, strings, surface, artifacts) {
  const keys = await frame.evaluate(() => [...new Set([...document.querySelectorAll('.i18n')]
    .filter(element => element.checkVisibility({checkVisibilityCSS: true, checkOpacity: true}))
    .map(element => window.I18n.weakMap.get(element)?.key).filter(Boolean))].sort());
  const pack = new Set(strings.map(string => string.key));
  await writeFile(join(artifacts, 'language-visible-' + surface + '.json'), JSON.stringify(keys, null, 2) + '\n');
  await writeFile(join(artifacts, 'language-accessible-' + surface + '.txt'), await frame.locator('body').ariaSnapshot());
  assert.deepEqual(keys.filter(key => !pack.has(key)), [], surface + ': visible strings cannot use construction exceptions');
}
