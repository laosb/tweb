import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';

/** Observe real icon elements across frames/reloads, including transient menus. */
export async function installIconCoverage(context) {
  const observed = new Set();
  await context.exposeBinding('__recordWidgetIcons', (_, codes) => {
    for(const code of codes) observed.add(code);
  });
  await context.addInitScript(() => {
    const seen = new Set();
    const inspect = (node) => {
      if(node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
      if(!node) return;
      const icons = [...node.querySelectorAll('.tgico')];
      if(node.matches('.tgico')) icons.push(node);
      const codes = [];
      for(const icon of icons) {
        for(const glyph of icon.textContent) {
          const code = glyph.codePointAt(0);
          if((code === 0 || code >= 0xe000 && code <= 0xf8ff) && !seen.has(code)) {
            seen.add(code);
            codes.push(code);
          }
        }
      }
      if(codes.length) void window.__recordWidgetIcons(codes);
    };
    new MutationObserver(records => {
      for(const record of records) {
        if(record.type === 'childList') {
          for(const node of record.addedNodes) inspect(node);
        } else inspect(record.target);
      }
    }).observe(document, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class']});
  });
  return observed;
}

/** Every retained glyph, plus every icon observed in the actual screens, must
 * rasterize exactly as the original font. Blank glyphs and tofu fail as well. */
export async function checkIconCoverage({frame, observed, repo, artifacts}) {
  const original = await readFile(repo + '/public/assets/fonts/tgico.ttf');
  const names = JSON.parse(await readFile(repo + '/src/widget/iconNames.json', 'utf8'));
  const iconSource = await readFile(repo + '/src/icons.ts', 'utf8');
  const all = Object.fromEntries([...iconSource.matchAll(/\b(\w+): '(\w+)'/g)].map(([, name, hex]) => [name, parseInt(hex, 16)]));
  assert(observed.size > 20, 'icon observer did not cover the widget screens');
  const result = await frame.evaluate(async({original, names, all, observed}) => {
    const reference = new FontFace('widget-icon-reference', new Uint8Array(original));
    document.fonts.add(await reference.load());
    await document.fonts.load('48px tgico');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 80;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    const raster = (font, code) => {
      context.clearRect(0, 0, 80, 80);
      context.font = `48px "${font}"`;
      context.fillText(String.fromCodePoint(code), 8, 60);
      return [...context.getImageData(0, 0, 80, 80).data];
    };
    const equal = (a, b) => a.every((value, index) => value === b[index]);
    const tofu = raster('tgico', 0xffff);
    const failures = [];
    for(const code of new Set([...names.map(name => all[name]), ...observed])) {
      const actual = raster('tgico', code), expected = raster('widget-icon-reference', code);
      if(!actual.some(Boolean) || equal(actual, tofu) || !equal(actual, expected)) failures.push(code);
    }
    return {failures, observed, retained: names.length};
  }, {original: [...original], names, all, observed: [...observed].sort((a, b) => a - b)});
  result.observedNames = result.observed.map(code => Object.keys(all).find(name => all[name] === code) || `U+${code.toString(16)}`);
  await writeFile(artifacts + '/icon-coverage.json', JSON.stringify(result, null, 2) + '\n');
  assert.deepEqual(result.failures, [], 'blank, tofu or changed icon glyphs');
  console.log(`PASS widget icons: ${observed.size} observed glyphs and all ${names.length} retained glyphs match the original font`);
}
