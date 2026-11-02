import {readFileSync} from 'node:fs';
import {parseSync} from '@babel/core';
import {describe, expect, it} from 'vitest';
import {assertWidgetEmojiSource, assertWidgetEmojiConsumer, assertWidgetEmojiModules} from '../../scripts/widget-emoji-guards';
import getEmojiUnified from '@lib/richTextProcessor/getEmojiUnified';
import parseEntities from '@lib/richTextProcessor/parseEntities';
import mergeEntities from '@lib/richTextProcessor/mergeEntities';
import fixEmoji from '@lib/richTextProcessor/fixEmoji';
import {areAllEmojiNative, isEmojiNative} from '@/widget/omitted/emojiImage';

const source = readFileSync('src/lib/richTextProcessor/getEmojiUnified.ts', 'utf8');
const parse = (source: string) => parseSync(source, {configFile: false, parserOpts: {plugins: ['typescript']}});

describe('Unicode native widget emoji', () => {
  it.each([
    ['🤼🏻', '1f93c-1f3fb'], // Emoji 17 wrestling tone, absent from the artwork table.
    ['🦰', '1f9b0'], // Standalone hair component, also absent from the table.
    ['😀', '1f600'],
    ['👍🏽', '1f44d-1f3fd'],
    ['👩🏽‍💻', '1f469-1f3fd-200d-1f4bb'],
    ['1️⃣', '0031-20e3'],
    ['🇨🇳', '1f1e8-1f1f3'],
    ['🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}', '1f3f4-e0067-e0062-e0065-e006e-e0067-e007f'],
    ['👩‍⚕️', '1f469-200d-2695'],
    ['©', '00a9']
  ])('accepts and normalizes %s as native emoji', (input, unified) => {
    expect(getEmojiUnified(input)).toBe(unified);
    expect(parseEntities(input)).toEqual([{_: 'messageEntityEmoji', offset: 0, length: input.length, unicode: unified}]);
  });

  it.each(['0123456789', '#', '*', 'hello'])('keeps %s as text', (input) => {
    expect(parseEntities(input)).toEqual([]);
  });

  it.each(['♀', '♂', '⚕', '♀️', '♂️', '⚕️'])('rejects standalone text sign %s after normalization', (input) => {
    expect(getEmojiUnified(input)).toBeUndefined();
    expect(parseEntities(input)).toEqual([]);
  });

  it('uses native emoji without artwork', () => {
    expect(areAllEmojiNative()).toBe(true);
    expect(isEmojiNative('1f93c-1f3fb')).toBe(true);
  });

  it('preserves a new emoji’s UTF-16 ranges through parsing, merge and fixEmoji', () => {
    const input = '🤼🏻';
    const unified = '1f93c-1f3fb';
    const text = 'A ' + input + ' Z';
    const entities = parseEntities(text);
    expect(entities).toEqual([{_: 'messageEntityEmoji', offset: 2, length: input.length, unicode: unified}]);
    expect(mergeEntities([{_: 'messageEntityBold', offset: 0, length: text.length}], entities))
    .toContainEqual(entities[0]);
    const shifted = parseEntities('♀ ' + input + ' Z');
    const fixed = fixEmoji('♀ ' + input + ' Z', shifted);
    expect(fixed).toBe('♀️ ' + input + ' Z');
    expect(shifted).toEqual([{_: 'messageEntityEmoji', offset: 3, length: input.length, unicode: unified}]);
    expect(parseEntities(fixed)).toEqual(shifted);
  });

  it('fails on signature, export, normalization, semantics, consumer and graph drift', () => {
    assertWidgetEmojiSource(source, parse);
    for(const changed of [source.replace('emojiCode: string', 'emojiCode: number'), source.replace('encodeEmoji(emojiCode)', 'emojiCode'),
      source.replace('/-?fe0f/g', '/fe0f/g'), source.replace('return unified;', 'return emojiCode;'), source + '\nexport const extra = 1;']) {
      expect(() => assertWidgetEmojiSource(changed, parse)).toThrow('export/signature/semantics');
    }
    assertWidgetEmojiConsumer('src/lib/richTextProcessor/parseEntities.ts');
    assertWidgetEmojiConsumer('src/components/chat/inputEditor/extensions/emojiImages.ts');
    expect(() => assertWidgetEmojiConsumer('src/components/newPicker.ts')).toThrow('consumer');
    assertWidgetEmojiModules(['src/lib/richTextProcessor/parseEntities.ts']);
    expect(() => assertWidgetEmojiModules(['src/config/emoji.ts?variant'])).toThrow('artwork emoji table');
  });
});
