// Recheck a saved browser trace without a DC or browser.
import {readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {readEnglishPack, checkLanguageCoverage} from '../tests/widget/languageCoverage.mjs';
import exceptions from '../tests/widget/languageExceptions.json' with {type: 'json'};

const directory = process.env.WIDGET_LANGPACK_DIR || process.argv[2];
const trace = process.argv[3] || process.env.WIDGET_LANGUAGE_TRACE;
if(!directory || !trace) throw new Error('Usage: node scripts/test-widget-language.mjs /path/to/webk_bfb/en /path/to/language-resolutions.json');
const records = JSON.parse(await readFile(trace, 'utf8'));
await checkLanguageCoverage(new Map(records.map(record => [record.key + '\0' + record.source, record])),
  await readEnglishPack(directory), dirname(trace), exceptions);
