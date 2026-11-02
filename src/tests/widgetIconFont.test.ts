import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {widgetIconCodes, widgetIconValueGuard} from '../../scripts/widget-icon-font';
import {readTrueType, subsetWidgetFont, fontChecksum} from '../../scripts/widget-font-subset.mjs';
import names from '@/widget/iconNames.json';

const source = readFileSync('src/icons.ts', 'utf8');
const original = readFileSync('public/assets/fonts/tgico.ttf');
const icons = widgetIconCodes(source);

describe('widget icon font', () => {
  it('keeps glyph IDs, codepoints, outlines, metrics, composites and checksums', () => {
    const subset = subsetWidgetFont(original, names.map(name => icons[name]));
    const before = readTrueType(original), after = readTrueType(subset);
    expect(subset.length).toBeLessThan(original.length);
    expect(after.mapping).toEqual(before.mapping);
    expect(after.glyphCount).toBe(before.glyphCount);
    for(const name of names) {
      const id = before.mapping.get(icons[name]);
      expect(after.glyph(id), name).toEqual(before.glyph(id));
    }
    for(const [tag, data] of before.tables) {
      if(!['glyf', 'loca', 'head'].includes(tag)) expect(after.tables.get(tag), tag).toEqual(data);
    }
    expect(fontChecksum(subset)).toBe(0xb1b0afba);
    // Keeping all codes must reproduce every mapped glyph; unencoded slots
    // may be blanked, while the subsetter validates composite closure.
    const full = readTrueType(subsetWidgetFont(original, Object.values(icons)));
    for(const id of new Set([0, ...Object.values(icons).map(code => before.mapping.get(code))])) expect(full.glyph(id)).toEqual(before.glyph(id));
  });

  it('retains transitive composite components without renumbering them', () => {
    // Today's tgico has no composites. Exercise that future upstream contract
    // with two composite slots in a disposable copy of the actual font.
    const data = Buffer.from(original), before = readTrueType(data);
    const codes = Object.values(icons).filter(code => before.glyph(before.mapping.get(code)).length >= 18).slice(0, 3);
    const ids = codes.map(code => before.mapping.get(code));
    for(let index = 0; index < 2; ++index) {
      const glyph = before.glyph(ids[index]);
      glyph.fill(0);
      glyph.writeInt16BE(-1, 0);
      glyph.writeUInt16BE(3, 10); // word-sized x/y arguments, one component
      glyph.writeUInt16BE(ids[index + 1], 12);
    }
    const after = readTrueType(subsetWidgetFont(data, [codes[0]]));
    for(const id of ids) expect(after.glyph(id)).toEqual(before.glyph(id));
  });

  it('rejects missing allowlist names, absent upstream glyphs and newly used icons', () => {
    expect(() => widgetIconCodes(source, ['not_an_upstream_icon'])).toThrow('absent upstream');
    expect(() => subsetWidgetFont(original, [0xe000])).toThrow('missing from upstream font');
    const assertValue = widgetIconValueGuard(icons);
    const missing = Object.keys(icons).find(name => !names.includes(name));
    for(const value of [missing, missing + ' button-icon', 'tgico-' + missing, String.fromCodePoint(icons[missing])]) {
      expect(() => assertValue(value)).toThrow('not allowed');
    }
    expect(() => assertValue('check extra-class')).not.toThrow();
  });
});
