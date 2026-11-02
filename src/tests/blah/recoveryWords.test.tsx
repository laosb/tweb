import {createEffect} from 'solid-js';
import {render} from 'solid-js/web';
import {afterEach, describe, expect, it, vi} from 'vitest';
vi.mock('@lib/langPack', () => ({i18n: (key: string) => key}));
vi.mock('@components/buttonTsx', () => ({default: (props: any) => <button type="button" disabled={props.disabled} onClick={props.onClick}>{props.text}</button>}));
vi.mock('@components/inputFieldTsx', () => ({InputFieldTsx: (props: any) => {
  const input = document.createElement('input');
  input.setAttribute('aria-label', 'Word ' + props.labelOptions[0]);
  props.instanceRef?.({input});
  input.addEventListener('input', () => props.onRawInput(input.value));
  createEffect(() => { input.value = props.value || ''; });
  return input;
}}));
vi.mock('@components/popups/indexTsx', () => ({default: {}, createPopup: vi.fn()}));
vi.mock('@components/confirmationPopup', () => ({default: vi.fn()}));
import {splitWords, verificationPositions, WordsDisplay, WordsEntry, WordsVerify} from '@lib/blah/RecoveryWords';
import wordList from '@lib/blah/recoveryWordList';
let dispose: () => void;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('recovery word controls', () => {
  it('vendors the complete sorted BIP 39 English list for autocomplete', () => {
    expect(wordList).toHaveLength(2048); expect(new Set(wordList).size).toBe(2048);
    expect(wordList[0]).toBe('abandon'); expect(wordList[2047]).toBe('zoo');
    expect([...wordList].sort()).toEqual(wordList);
  });
  it('normalizes a whole pasted phrase using ASCII whitespace and case', () => {
    expect(splitWords('  ABANDON\tability\r\nZoo  ')).toEqual(['abandon', 'ability', 'zoo']);
  });
  it('rejects biased bytes and duplicates before selecting sorted positions', () => {
    const bytes = [255, 240, 23, 23, 0, 46];
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => { new Uint8Array(array.buffer, array.byteOffset, array.byteLength)[0] = bytes.shift(); return array; });
    expect(verificationPositions()).toEqual([0, 22, 23]);
    expect(bytes).toHaveLength(0);
  });
  it('numbers all words and delays Done before verification', async() => {
    vi.useFakeTimers(); const done = vi.fn();
    dispose = render(() => <WordsDisplay words={Array(24).fill('abandon')} onDone={done} />, document.body);
    expect(document.querySelectorAll('ol[dir=ltr] li')).toHaveLength(24);
    const button = document.querySelector('button'); expect(button.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(3000); expect(button.disabled).toBe(false);
    button.click(); expect(done).toHaveBeenCalledOnce();
  });
  it('fills every field from a whole-phrase paste without losing positions', () => {
    const changed = vi.fn();
    dispose = render(() => <WordsEntry onPhrase={changed} />, document.body);
    const words = Array(23).fill('abandon').concat('art');
    const event = new Event('paste', {bubbles: true, cancelable: true});
    Object.defineProperty(event, 'clipboardData', {value: {getData: () => words.join(' ').toUpperCase()}});
    document.querySelector('input').dispatchEvent(event);
    expect([...document.querySelectorAll('input')].map((input) => input.value)).toEqual(words);
    expect(document.querySelectorAll('datalist option')).toHaveLength(2048);
    expect(changed).toHaveBeenLastCalledWith(words.join(' '));
  });
  it('requires all three selected words before advancing', () => {
    const verified = vi.fn();
    dispose = render(() => <WordsVerify words={wordList.slice(0, 24)} onVerified={verified} />, document.body);
    const inputs = [...document.querySelectorAll('input')];
    expect(inputs).toHaveLength(3);
    const button = document.querySelector('button'); expect(button.disabled).toBe(true);
    for(const input of inputs) {
      const index = Number(input.getAttribute('aria-label').match(/\d+/)[0]) - 1;
      input.value = wordList[index]; input.dispatchEvent(new Event('input', {bubbles: true}));
    }
    expect(button.disabled).toBe(false); button.click(); expect(verified).toHaveBeenCalledOnce();
  });
});
