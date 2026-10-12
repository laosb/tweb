import {createSignal, Show} from 'solid-js';
import Modes from '@config/modes';
import Button from '@components/buttonTsx';
import PopupElement, {createPopup, usePopupContext} from '@components/popups/indexTsx';
import {i18n, LangPackKey} from '@lib/langPack';
import IdentityInput from '@lib/blah/IdentityInput';
import {PaperKeyWords} from '@lib/blah/IdentityDetails';
import {exportIdentityFile} from '@lib/blah/identityFiles';
import type {IdentityActions} from '@lib/blah/IdentityPanel';
import type {ChatIdentityChange, ChatIdentityRequest, ChatIdentityResponse, ChatIdentityResult} from '@lib/blah/chatIdentity';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';
import {chatIdentityError} from '@lib/blah/chatIdentityError';
import styles from '@lib/blah/identity.module.scss';

export {chatIdentityError} from '@lib/blah/chatIdentityError';

type Props = {
  domain: string,
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
    let finished = false;
    const settle = async() => {
      await pending;
      if(finished) return;
      finished = true;
      if(current?.identity) await props.identityAction({action: 'lock', id: current.identity.id}).catch(console.error);
      if(current?.result) resolve(current.result);
      else reject(new Error('BLAH_CHAT_CANCELLED'));
    };
    function Content() {
      const popup = usePopupContext();
      const [state, setState] = createSignal(current);
      const [busy, setBusy] = createSignal(false);
      const [message, setMessage] = createSignal('');
      const [password, setPassword] = createSignal('');
      let exportButton: HTMLElement;
      let primaryButton: HTMLElement;
      const [paper, setPaper] = createSignal(current?.paperKey);
      const identity = () => state()?.identity;
      const bound = () => !!state()?.result;
      const title: LangPackKey = props.change.action === 'edit' ? 'Save' :
        props.change.action === 'createChannel' && props.change.options.broadcast ? 'NewChannel' : 'NewGroup';
      const run = (operation: () => Promise<void>) => {
        if(busy() || closed) return;
        setBusy(true); setMessage('');
        pending = operation().catch((error) => { if(!closed) setMessage(chatIdentityError(error)); }).finally(() => setBusy(false));
      };
      const accept = (value: ChatIdentityResponse) => {
        current = value;
        if(!closed) {
          setState(value);
          if(Modes.a11y) focusWhenSettled(value.result ? primaryButton : exportButton, () => !closed);
        }
      };
      const generate = () => run(async() => {
        const result = await props.action({action: 'prepare', domain: props.domain, password: password(), attempt: props.attempt});
        setPassword('');
        accept(result);
        if(!closed) setPaper(result.paperKey);
      });
      const bind = () => run(async() => {
        const result = await props.action({action: 'bind', id: identity().id, change: props.change});
        accept(result);
        setPaper(undefined);
      });
      const recheck = () => run(async() => {
        let publication;
        try { ({publication} = await props.identityAction({action: 'publication', id: identity().id})); }
        catch{ throw new Error('BLAH_PUBLICATION_CHECK_FAILED'); }
        if(publication.pending) throw new Error('BLAH_PROFILE_NOT_PUBLISHED');
        if(!closed) popup.hide();
      });
      return <div class={styles.panel}>
        <Show when={identity()} fallback={<form onSubmit={(event) => { event.preventDefault(); generate(); }}>
          <p>{i18n('BlahChatIdentityIntro', [props.domain])}</p>
          <IdentityInput label="BlahIdentityPassword" type="password" autocomplete="new-password" value={password()} onInput={setPassword} disabled={busy()} />
          <Button primaryFilled text="BlahCreateIdentity" disabled={busy() || !password()} onClick={generate} />
          <p class={styles.footnote}>{i18n('BlahIdentityCustody')}</p>
        </form>}>
          <Show when={bound()}><p>{i18n('BlahChatPublishNumbered')}</p></Show>
          <fieldset disabled={busy()}>
            <Button primaryTransparent ref={(element) => exportButton = element} text="BlahSaveIdentityFile" onClick={() => run(async() => {
              const {backup} = await props.identityAction({action: 'backup', id: identity().id});
              if(!closed) exportIdentityFile(`${props.domain}-identity.cbor`, new Uint8Array(backup));
            })} />
            <Show when={paper()}>{(value) => <>
              <PaperKeyWords paper={value()} domain={props.domain} />
              <Button primaryTransparent text="BlahPaperKeyDone" onClick={() => setPaper(undefined)} />
            </>}</Show>
            <Button primaryTransparent text="BlahExportProfile" onClick={() => exportIdentityFile('profile.cbor', new Uint8Array(identity().profile))} />
            <p class={styles.footnote}>{i18n('BlahChatProfileHosting', [<code>{`https://${props.domain}/.well-known/blah/profile.cbor`}</code> as HTMLElement])}</p>
            <Button ref={(element) => primaryButton = element} primaryFilled text={bound() ? 'BlahCheckPublication' : title} onClick={bound() ? recheck : bind} />
          </fieldset>
        </Show>
        <p role="status">{busy() ? i18n('PleaseWait') : message()}</p>
      </div>;
    }
    createPopup(() => <PopupElement class={styles.setupPopup} closable onClose={() => { closed = true; void settle(); }}>
      <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahCrossServer" /></PopupElement.Header>
      <PopupElement.Scrollable><PopupElement.Body class={styles.setupBody}><Content /></PopupElement.Body></PopupElement.Scrollable>
    </PopupElement>);
  });
}
