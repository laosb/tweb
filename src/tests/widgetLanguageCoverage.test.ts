import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkLanguageCoverage, readEnglishPack, languageCoveragePlugin} from '../../tests/widget/languageCoverage.mjs';

let directory: string;
beforeEach(async() => {directory = await mkdtemp(join(tmpdir(), 'widget-language-'));});
afterEach(async() => {await rm(directory, {recursive: true, force: true});});

it('fails for a resolved key absent from the pack, even when bundled English rendered it', async() => {
  const records = new Map([['photo', {key: 'EditThisPhoto', source: 'bundled'}]]);
  await expect(checkLanguageCoverage(records, [], directory)).rejects.toThrow('missing from WIDGET_LANGPACK_DIR');
  await expect(checkLanguageCoverage(records, [{key: 'EditThisPhoto'}], directory)).resolves.toBeUndefined();
});

it('permits only specifically documented construction exceptions', async() => {
  const records = new Map([['sidebar', {key: 'AccDescr.ChatInfo', source: 'bundled'}]]);
  await expect(checkLanguageCoverage(records, [], directory, {'AccDescr.ChatInfo': 'The widget hides the constructed sidebar.'})).resolves.toBeUndefined();
  records.set('photo', {key: 'EditThisPhoto', source: 'bundled'});
  await expect(checkLanguageCoverage(records, [], directory, {'AccDescr.ChatInfo': 'hidden sidebar'})).rejects.toThrow();
});

it('reads plain strings and all plural forms without trimming meaningful whitespace', async() => {
  await mkdir(join(directory, 'Plain'));
  await writeFile(join(directory, 'Plain/value'), ' leading space \n');
  await mkdir(join(directory, 'Count'));
  await writeFile(join(directory, 'Count/one'), '%d item\n');
  await writeFile(join(directory, 'Count/other'), '%d items\n');
  expect(await readEnglishPack(directory)).toEqual([
    {_: 'langPackStringPluralized', key: 'Count', one_value: '%d item', other_value: '%d items'},
    {_: 'langPackString', key: 'Plain', value: ' leading space '}
  ]);
  await writeFile(join(directory, 'Count/value'), 'invalid mixed plural\n');
  await expect(readEnglishPack(directory)).rejects.toThrow('invalid forms');
});

it('fails if the upstream resolver changes, instead of silently recording no keys', () => {
  const plugin = languageCoveragePlugin([]);
  expect(() => plugin.transform('renamed resolver', '/src/lib/langPack.ts')).toThrow('I18n resolver changed');
  expect(() => plugin.buildEnd()).toThrow('instrument both');
});

it('rejects English that differs from the canonical source', () => {
  expect(() => languageCoveragePlugin([{_: 'langPackString', key: 'EditThisPhoto', value: 'wrong'}]))
  .toThrow('Widget English differs from source: EditThisPhoto');
});
