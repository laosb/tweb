import {createSignal, onMount, Show, type JSX} from 'solid-js';
import Modes from '@config/modes';
import Button from '@components/buttonTsx';
import PopupElement, {createPopup, usePopupContext} from '@components/popups/indexTsx';
import {i18n, LangPackKey} from '@lib/langPack';
import {hostingMessage} from '@lib/blah/hostingMessage';
import {HostedNameChooser} from '@lib/blah/HostedNameChooser';
import {WordsDisplay, WordsVerify} from '@lib/blah/RecoveryWords';
import {exportProfile} from '@lib/blah/profileFiles';
import type {IdentityActions} from '@lib/blah/identity';
import type {ChatIdentityChange, ChatIdentityRequest, ChatIdentityResponse, ChatIdentityResult} from '@lib/blah/chatIdentity';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';
import {chatIdentityError} from '@lib/blah/chatIdentityError';
import styles from '@lib/blah/identity.module.scss';

if(import.meta.hot) import.meta.hot.accept();

export {chatIdentityError} from '@lib/blah/chatIdentityError';

type Props = {
  domain?: string,
  hosted?: boolean,
  attempt: string,
  change: ChatIdentityChange,
  action: (request: ChatIdentityRequest) => Promise<ChatIdentityResponse>,
  identityAction: IdentityActions,
  initial?: ChatIdentityResponse
};

/** Closing before binding preserves custody; closing after binding returns the committed chat. */
export default function showChatIdentitySetup(props: Props): Promise<ChatIdentityResult> {
  return new Promise((resolve, reject) => {
    let closed = false;
    let pending: Promise<void>;
    let current = props.initial;
    const controller = new AbortController();
    const operations = new Set<Promise<unknown>>();
    const track = <T,>(operation: Promise<T>) => {
      operations.add(operation);
      void operation.finally(() => operations.delete(operation)).catch(() => {});
      return operation;
    };
    let finished = false;
    const settle = async() => {
      await pending;
      await Promise.allSettled([...operations]);
      if(finished) return;
      finished = true;
      if(current?.result) resolve(current.result);
      else reject(new Error('BLAH_CHAT_CANCELLED'));
    };
    function Content() {
      const popup = usePopupContext();
      const [state, setState] = createSignal(current);
      const [busy, setBusy] = createSignal(false);
      const [message, setMessage] = createSignal<JSX.Element>('');
      const [words, setWords] = createSignal<string[]>();
      const [wordsStep, setWordsStep] = createSignal<'display' | 'verify' | 'done'>(current?.identity ? 'done' : 'display');
      onMount(() => {
        void track((async() => {
          if(!current?.identity) {
            const saved = await props.identityAction({action: 'attempt', kind: 'channel', attempt: props.attempt});
            if(closed) return;
            if(saved.identity) {
              accept(saved);
              setWordsStep('done');
              focusSaved();
              return;
            }
            const result = await props.identityAction({action: 'generateWords'});
            if(!closed) setWords(result.words);
          }
        })()).catch((error) => { if(!closed) setMessage(error.message); });
      });
      const [claimed, setClaimed] = createSignal(false);
      let exportButton: HTMLElement;
      let primaryButton: HTMLElement;
      const identity = () => state()?.identity;
      const bound = () => !!state()?.result;
      const domain = () => identity()?.domain || props.domain;
      const title: LangPackKey = props.change.action === 'edit' ? 'Save' :
        props.change.action === 'createChannel' && props.change.options.broadcast ? 'NewChannel' : 'NewGroup';
      const run = (operation: () => Promise<void>) => {
        if(busy() || closed) return;
        setBusy(true); setMessage('');
        pending = operation().catch((error) => {
          if(!closed) setMessage((error as {type?: string}).type?.startsWith('BlahHosting') ? hostingMessage(error) : chatIdentityError(error));
        }).finally(() => setBusy(false));
      };
      const focusSaved = () => {
        const target = bound() ? primaryButton : exportButton;
        if(Modes.a11y && target) focusWhenSettled(target, () => !closed);
      };
      const accept = (value: ChatIdentityResponse) => {
        current = value;
        if(!closed) {
          setState(value);
          focusSaved();
        }
      };
      const generate = () => run(async() => {
        const result = await props.action({action: 'prepare', domain: props.domain, phrase: words().join(' '), attempt: props.attempt});
        accept(result);
        if(!closed) setWords(undefined);
      });
      const bind = () => run(async() => {
        const result = await props.action({action: 'bind', id: identity().id, change: props.change});
        accept(result);
      });
      const recheck = () => run(async() => {
        let publication;
        try { ({publication} = await props.identityAction({action: 'publication', id: identity().id})); }
        catch{ throw new Error('BLAH_PUBLICATION_CHECK_FAILED'); }
        if(publication.pending) throw new Error('BLAH_PROFILE_NOT_PUBLISHED');
        if(!closed) popup.hide();
      });
      return <div class={styles.panel}>
        <Show when={wordsStep() === 'display' && words()}><WordsDisplay words={words()} onDone={() => setWordsStep('verify')} /></Show>
        <Show when={wordsStep() === 'verify'}><WordsVerify words={words()} onVerified={() => {
          setWordsStep('done'); if(!props.hosted) generate();
        }} /></Show>
        <Show when={wordsStep() === 'done'}>
        <Show when={identity()} fallback={<Show when={!props.hosted}>
          <p>{i18n('BlahChatIdentityIntro', [domain()])}</p>
          <Button primaryFilled text="BlahCreateIdentity" disabled={busy()} onClick={generate} />
        </Show>}>
          <Show when={bound()}><p>{i18n('BlahChatPublishNumbered')}</p></Show>
          <fieldset disabled={busy()}>
            <Button ref={(element) => exportButton = element} primaryTransparent text="BlahExportProfile" onClick={() => exportProfile('profile.cbor', new Uint8Array(identity().profile))} />
            <Show when={!identity().hostedNames} fallback={
              <p role="status">{i18n(identity().publicationPending ? 'BlahHostingPending' : 'BlahHostingPublished')}</p>
            }><p class={styles.footnote}>{i18n('BlahChatProfileHosting', [<code dir="ltr">{`https://${domain()}/.well-known/blah/profile.cbor`}</code> as HTMLElement])}</p></Show>
            <Show when={identity().hostedNames && identity().publicationPending}>
              <Button primaryTransparent text="BlahHostingRetry" onClick={() => run(async() => {
                const result = await props.identityAction({action: 'retryPublication', id: identity().id});
                accept({...current, identity: result.identity});
              })} />
            </Show>
            <Button ref={(element) => primaryButton = element} primaryFilled text={bound() ? 'BlahCheckPublication' : title} onClick={bound() ? recheck : bind} />
          </fieldset>
        </Show>
        <Show when={props.hosted && !claimed() && !bound()}>
          <HostedNameChooser signal={controller.signal} disabled={busy()} onBusy={setBusy}
            identity={identity()}
            action={(request) => {
              const operation = props.identityAction({...request, kind: 'channel'});
              return ['hostingPlan', 'hostingStatus'].includes(request.action) ? operation : track(operation);
            }}
            prepare={(host, label) => track((async() => {
              const result = await props.action({action: 'prepare', domain: label + '.' + host, phrase: words().join(' '),
                attempt: props.attempt, hosted: {domain: host, label}});
              accept(result);
              if(!closed) setWords(undefined);
              return result.identity;
            })())}
            onIdentity={(value) => accept({...current, identity: value})} onComplete={() => {
              setClaimed(true);
              if(Modes.a11y) focusWhenSettled(exportButton, () => !closed);
            }} />
        </Show>
        </Show>
        <p role="status">{busy() ? i18n('PleaseWait') : message()}</p>
      </div>;
    }
    createPopup(() => <PopupElement class={styles.setupPopup} closable onClose={() => { closed = true; controller.abort(); void settle(); }}>
      <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahCrossServer" /></PopupElement.Header>
      <PopupElement.Scrollable><PopupElement.Body class={styles.setupBody}><Content /></PopupElement.Body></PopupElement.Scrollable>
    </PopupElement>);
  });
}
