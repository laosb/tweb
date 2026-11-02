import {createSignal, For, onCleanup, onMount} from 'solid-js';
import Modes from '@config/modes';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';
import Button from '@components/buttonTsx';
import {InputFieldTsx} from '@components/inputFieldTsx';
import PopupElement, {createPopup, usePopupContext} from '@components/popups/indexTsx';
import confirmationPopup from '@components/confirmationPopup';
import {i18n} from '@lib/langPack';
import type {AppManagers} from '@lib/managers';
import type {IdentityActions} from '@lib/blah/identity';
import wordList from '@lib/blah/recoveryWordList';
import styles from '@lib/blah/identity.module.scss';

export function splitWords(phrase: string) {
  return phrase.trim().toLowerCase().split(/[\t\n\v\f\r ]+/).filter(Boolean);
}

export function verificationPositions() {
  const positions = new Set<number>();
  while(positions.size < 3) {
    const value = crypto.getRandomValues(new Uint8Array(1))[0];
    if(value < 240) positions.add(value % 24);
  }
  return [...positions].sort((a, b) => a - b);
}

export function WordGrid(props: {words: string[]}) {
  return <ol class={styles.recoveryWords} dir="ltr"><For each={props.words}>{(word) => <li>{word}</li>}</For></ol>;
}

export function focusWords(element: HTMLElement) {
  if(Modes.a11y) onCleanup(focusWhenSettled(element));
}

export function WordsDisplay(props: {words: string[], onDone: () => void}) {
  const [ready, setReady] = createSignal(false);
  onMount(() => {
    focusWords(description);
    const timer = setTimeout(() => setReady(true), 3000);
    onCleanup(() => clearTimeout(timer));
  });
  let description: HTMLParagraphElement;
  return <div class={styles.panel}>
    <p ref={description} tabIndex={-1}>{i18n('BlahRecoveryWordsWrite')}</p>
    <WordGrid words={props.words} />
    <Button primaryFilled text="Done" disabled={!ready()} onClick={props.onDone} />
  </div>;
}

/** The native datalist provides keyboard and pointer autocomplete on every word. */
export function WordsEntry(props: {onPhrase: (phrase: string) => void, disabled?: boolean, positions?: number[]}) {
  let firstInput: HTMLInputElement;
  onMount(() => focusWords(firstInput));
  const positions = props.positions || Array.from({length: 24}, (_, i) => i);
  const [values, setValues] = createSignal(Array(24).fill('') as string[]);
  const listId = 'recovery-words-' + crypto.randomUUID();
  const change = (position: number, value: string) => {
    const next = [...values()];
    next[position] = value.trim().toLowerCase();
    setValues(next);
    props.onPhrase(next.join(' '));
  };
  return <div class={styles.wordInputs} dir="ltr">
    <datalist id={listId}><For each={wordList}>{(word) => <option value={word}>{word}</option>}</For></datalist>
    <For each={positions}>{(position) => <InputFieldTsx plainText label="BlahRecoveryWord" labelOptions={[position + 1]}
      value={values()[position]} disabled={props.disabled} autocomplete="off" onRawInput={(value) => change(position, value)}
      instanceRef={(field) => {
        const input = field.input as HTMLInputElement;
        firstInput ||= input;
        input.setAttribute('list', listId);
        input.setAttribute('autocapitalize', 'none');
        input.spellcheck = false;
        input.addEventListener('paste', (event) => {
          const words = splitWords(event.clipboardData?.getData('text') || '');
          if(words.length !== 24 || props.positions) return;
          event.preventDefault();
          setValues(words);
          props.onPhrase(words.join(' '));
        });
      }} />}</For>
  </div>;
}

export function WordsVerify(props: {words: string[], busy?: boolean, onVerified: () => void}) {
  const positions = verificationPositions();
  const [phrase, setPhrase] = createSignal('');
  const matches = () => {
    const entered = phrase().split(' ');
    return positions.every((position) => entered[position] === props.words[position]);
  };
  return <form class={styles.panel} onSubmit={(event) => { event.preventDefault(); if(matches()) props.onVerified(); }}>
    <p>{i18n('BlahRecoveryWordsVerifyHelp')}</p>
    <WordsEntry positions={positions} disabled={props.busy} onPhrase={setPhrase} />
    <Button primaryFilled text="Continue" disabled={props.busy || !matches()} onClick={() => { if(matches()) props.onVerified(); }} />
  </form>;
}

/** Confirmation is the web device-auth boundary for showing the seed again. */
export async function showRecoveryWords(action: IdentityActions, managers: AppManagers, id?: string) {
  try {
    await confirmationPopup({titleLangKey: 'BlahRecoveryWords', descriptionLangKey: 'BlahShowWordsConfirm',
      button: {langKey: 'Continue'}});
  } catch{ return; }
  const result = await action({action: 'words', id});
  function Content() {
    const popup = usePopupContext();
    return <WordsDisplay words={result.words} onDone={() => popup.hide()} />;
  }
  createPopup(() => <PopupElement managers={managers} class={styles.setupPopup} closable>
    <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahRecoveryWords" /></PopupElement.Header>
    <PopupElement.Scrollable><PopupElement.Body class={styles.setupBody}><Content /></PopupElement.Body></PopupElement.Scrollable>
  </PopupElement>);
}

export function enterRecoveryWords(action: IdentityActions, onSaved: () => void, id?: string) {
  function Content() {
    const popup = usePopupContext();
    const [phrase, setPhrase] = createSignal('');
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal('');
    let closed = false;
    onCleanup(() => { closed = true; });
    async function submit() {
      if(busy()) return;
      setBusy(true); setError('');
      try {
        await action({action: 'enterWords', phrase: phrase(), id});
        if(!closed) { onSaved(); popup.hide(); }
      } catch(error) { if(!closed) setError((error as Error).message); }
      finally { if(!closed) setBusy(false); }
    }
    return <form class={styles.panel} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <WordsEntry onPhrase={setPhrase} disabled={busy()} />
      <Button primaryFilled text="Continue" disabled={busy() || splitWords(phrase()).length !== 24} onClick={submit} />
      <p role="alert">{error()}</p>
    </form>;
  }
  createPopup(() => <PopupElement class={styles.setupPopup} closable>
    <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahEnterRecoveryWords" /></PopupElement.Header>
    <PopupElement.Scrollable><PopupElement.Body class={styles.setupBody}><Content /></PopupElement.Body></PopupElement.Scrollable>
  </PopupElement>);
}
