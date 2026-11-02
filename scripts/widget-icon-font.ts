import {readFileSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Plugin} from 'vite';
import names from '../src/widget/iconNames.json';
import {subsetWidgetFont} from './widget-font-subset.mjs';

export function widgetIconCodes(source: string, allowlist = names) {
  const icons = Object.fromEntries([...source.matchAll(/^  (\w+): '([0-9a-f]+)'/gm)].map(([, name, hex]) => [name, parseInt(hex, 16)]));
  if(!Object.keys(icons).length || new Set(allowlist).size !== allowlist.length) throw new Error('invalid widget icon allowlist/table');
  for(const name of allowlist) {
    if(!Object.prototype.hasOwnProperty.call(icons, name)) throw new Error('widget allowlist icon absent upstream: ' + name);
  }
  return icons;
}

// Conservative scan of all emitted string literals: this includes icon arguments,
// option objects, tables, class-bearing ButtonIcon strings and template fragments.
// Keeping a few non-icon uses of the same words is preferable to inferring intent.
export function widgetIconValueGuard(icons: Record<string, number>, allowlist = names) {
  const allowed = new Set(allowlist);
  const codes = new Map(Object.entries(icons).map(([name, code]) => [code, name]));
  return (value: string) => {
    const tokens = [value.split(/\s/, 1)[0], ...[...value.matchAll(/\btgico-([a-z_0-9]+)/g)].map(match => match[1])];
    for(const token of tokens) {
      if(Object.prototype.hasOwnProperty.call(icons, token) && !allowed.has(token)) throw new Error('widget bundle icon not allowed: ' + token);
    }
    // A newly constructed family (for example `heading_${level}`) must retain
    // every upstream member, even when only the prefix survives as a literal.
    if(/^[a-z][a-z0-9_]*_$/.test(value)) {
      for(const name of Object.keys(icons)) {
        if(name.startsWith(value) && !allowed.has(name)) throw new Error('widget computed icon family not allowed: ' + name);
      }
    }
    for(const character of value.length <= 32 || value.includes('tgico') ? value : '') {
      const code = character.codePointAt(0);
      if(code < 0xe000 || code > 0xf8ff) continue;
      const name = codes.get(code);
      // Editors/codec tables also contain private-use sentinels unrelated to
      // tgico. Only the upstream font's own mappings establish icon usage.
      if(name && !allowed.has(name)) throw new Error('widget bundle glyph not allowed: U+' + code.toString(16));
    }
  };
}

export default function widgetIconFont(repo: string): Plugin {
  let font: Buffer, icons: Record<string, number>;
  return {
    name: 'widget-icon-font',
    apply: config => !config.build?.lib,
    buildStart() {
      icons = widgetIconCodes(readFileSync(resolve(repo, 'src/icons.ts'), 'utf8'));
      font = subsetWidgetFont(readFileSync(resolve(repo, 'public/assets/fonts/tgico.ttf')), names.map(name => icons[name]));
    },
    generateBundle(_, bundle) {
      const assertValue = widgetIconValueGuard(icons);
      const failures = new Set<string>();
      const checkValue = (value: string) => {
        try { assertValue(value); } catch(error) { failures.add(String(error)); }
      };
      const visit = (node: any) => {
        if(!node || typeof node !== 'object') return;
        if(node.type === 'Literal' && typeof node.value === 'string') checkValue(node.value);
        if(node.type === 'TemplateElement') checkValue(node.value.cooked || node.value.raw);
        for(const value of Object.values(node)) {
          if(Array.isArray(value)) value.forEach(visit);
          else if(value && typeof value === 'object') visit(value);
        }
      };
      // Worker JS is emitted as assets and has no DOM/font consumers; its
      // protocol/codec strings are not icon usages. Scan every page chunk.
      for(const item of Object.values(bundle)) {
        if(item.type === 'chunk') visit(this.parse(item.code));
        else if(item.fileName.endsWith('.css')) {
          const css = (typeof item.source === 'string' ? item.source : Buffer.from(item.source).toString('utf8')).replace(/\\([0-9a-f]{4})(?:\s)?/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
          // CSS content glyphs can occur anywhere in the emitted stylesheet.
          for(const glyph of css.match(/[\ue000-\uf8ff]/g) || []) checkValue(glyph);
          checkValue(css);
        }
      }
      if(failures.size) throw new Error([...failures].join('\n'));
    },
    // The public-assets plugin copies ordinary assets first; replace only this
    // emitted file. The source font and the normal client's output stay intact.
    writeBundle: {
      order: 'post',
      sequential: true,
      async handler(options) {
        await mkdir(resolve(options.dir, 'assets/fonts'), {recursive: true});
        await writeFile(resolve(options.dir, 'assets/fonts/tgico.ttf'), font);
      }
    }
  };
}
