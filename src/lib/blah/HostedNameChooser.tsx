import {createEffect, createMemo, createSignal, onCleanup, Show} from 'solid-js';
import type {JSX} from 'solid-js';
import type {HostingPlanName} from '@blahdiem/diem';
import Button from '@components/buttonTsx';
import PopupElement, {createPopup, usePopupContext} from '@components/popups/indexTsx';
import blah from '@config/blah';
import {i18n} from '@lib/langPack';
import IdentityInput from '@lib/blah/IdentityInput';
import type {IdentityActions} from '@lib/blah/IdentityPanel';
import type {IdentityView} from '@lib/blah/identity';
import {solveHostedProof} from '@lib/blah/hostingSolver';
import {hostingMessage} from '@lib/blah/hostingMessage';
import styles from '@lib/blah/identity.module.scss';

type Props = {
  action: IdentityActions,
  identity?: IdentityView,
  signal: AbortSignal,
  disabled?: boolean,
  prepare?: (domain: string, label: string) => Promise<IdentityView>,
  onIdentity: (identity: IdentityView) => void,
  onComplete?: () => void,
  onBusy?: (busy: boolean) => void
};

/** Shared creation/details chooser; only public puzzles cross into the worker pool. */
export function HostedNameChooser(props: Props) {
  const [identity, setIdentity] = createSignal(props.identity);
  const identityID = createMemo(() => identity()?.id);
  const [host, setHost] = createSignal(props.identity?.hostedNames?.domain || blah?.profileHostingDomain || '');
  const [label, setLabel] = createSignal('');
  const [plan, setPlan] = createSignal<HostingPlanName>();
  const [checking, setChecking] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [publishing, setPublishing] = createSignal(false);
  const [attempts, setAttempts] = createSignal<number>();
  const [message, setMessage] = createSignal<JSX.Element>();
  let controller: AbortController;
  let sequence = 0;
  let closed = false;
  const cancel = () => controller?.abort();
  const close = () => { closed = true; sequence++; cancel(); };
  props.signal.addEventListener('abort', close, {once: true});
  onCleanup(() => { close(); props.signal.removeEventListener('abort', close); });
  const domain = () => host().trim().toLowerCase();
  const name = () => label().trim().toLowerCase();
  const claimable = () => plan()?.status === 'held' || plan()?.status === 'needsProof';

  createEffect(() => {
    const hosted = {domain: domain(), label: name()};
    const id = identityID();
    const ticket = ++sequence;
    setPlan(undefined); setMessage(undefined); setChecking(false);
    if(!hosted.domain || !hosted.label) return;
    setChecking(true);
    const timer = setTimeout(async() => {
      try {
        const result = await props.action({action: 'hostingPlan', id, hosted});
        if(!closed && ticket === sequence) setPlan(result.hostingPlan);
      } catch(error) {
        if(!closed && ticket === sequence) setMessage(hostingMessage(error));
      } finally {
        if(!closed && ticket === sequence) setChecking(false);
      }
    }, 350);
    onCleanup(() => clearTimeout(timer));
  });

  async function claim() {
    if(busy() || props.disabled || !claimable() || closed) return;
    setBusy(true); props.onBusy?.(true); setMessage(undefined); setAttempts(undefined);
    controller = new AbortController();
    const signal = controller.signal;
    let poll: ReturnType<typeof setInterval>;
    let polling = false;
    try {
      let current = identity();
      if(!current) {
        current = await props.prepare(domain(), name());
        setIdentity(current);
        props.onIdentity(current); // Custody survives cancellation or a lost availability race.
      }
      if(closed || signal.aborted) return;
      const id = current.id;
      poll = setInterval(async() => {
        if(polling) return;
        polling = true;
        try {
          if(!(await props.action({action: 'hostingStatus', id})).unlocked) cancel();
        } catch{ cancel(); } finally { polling = false; }
      }, 500);
      // The pre-create plan uses a placeholder ID. Always get the identity-bound puzzle now.
      const {hostingPlan: latest} = await props.action({action: 'hostingPlan', id, hosted: {domain: domain(), label: name()}});
      if(signal.aborted || closed) return;
      if(latest.status === 'taken') throw {type: 'BlahHostingTaken'};
      if(latest.status === 'invalid') throw {type: 'BlahHostingInvalid'};
      const proofs: Record<string, number[]> = {};
      if(latest.puzzle) proofs[name()] = await solveHostedProof(latest.puzzle, {signal, onProgress: setAttempts});
      if(signal.aborted || closed) return;
      setPublishing(true); setAttempts(undefined);
      const result = await props.action({action: 'hostingClaim', id, hosted: {domain: domain(), label: name(), proofs}});
      if(closed) return;
      setIdentity(result.identity); props.onIdentity(result.identity);
      setMessage(i18n('BlahHostingPublished'));
      props.onComplete?.();
    } catch(error) {
      if(!closed) setMessage(hostingMessage(error));
      // A refused PUT can follow a durable signed revision. Show that saved state on return.
      if(identity() && !closed) {
        try {
          const result = await props.action({action: 'inspect', id: identity().id});
          if(!closed) { setIdentity(result.identity); props.onIdentity(result.identity); }
        } catch{}
      }
    } finally {
      clearInterval(poll); cancel();
      setAttempts(undefined); setPublishing(false); setBusy(false); props.onBusy?.(false);
    }
  }

  return <div class={styles.panel}>
    <fieldset disabled={busy()}>
      <IdentityInput label="BlahHostingHost" value={host()} onInput={setHost} disabled={!!identity()?.hostedNames} ref={(input) => input.dir = 'ltr'} />
      <IdentityInput label="BlahHostingLabel" value={label()} onInput={setLabel} ref={(input) => input.dir = 'ltr'} />
      <p dir="ltr"><bdi>{name() && domain() ? `${name()}.${domain()}` : ''}</bdi></p>
      <p role="status">{checking() ? i18n('BlahHostingCheck') : plan() ? i18n(plan().status === 'taken' ? 'BlahHostingTaken' :
        plan().status === 'invalid' ? 'BlahHostingInvalid' : plan().status === 'held' ? 'BlahHostingHeld' : 'BlahHostingAvailable') : ''}</p>
      <Show when={plan()?.requiredBits > 0}>
        <p class={styles.footnote}>{i18n('BlahHostingEffort', [Math.pow(2, plan().requiredBits).toLocaleString()])}</p>
      </Show>
      <Button primaryFilled text="BlahHostingClaim" disabled={busy() || props.disabled || !claimable()} onClick={claim} />
    </fieldset>
    <Show when={busy()}>
      <p role="status">{attempts() === undefined ? i18n('PleaseWait') : i18n('BlahHostingProgress', [attempts().toLocaleString()])}</p>
      <Show when={!publishing()}><Button text="Cancel" onClick={() => { cancel(); setMessage(i18n('BlahHostingCancelled')); }} /></Show>
    </Show>
    {/* Details already offer the retry; only creation needs pointing there. */}
    <Show when={props.prepare && identity()?.publicationPending}><p class={styles.footnote}>{i18n('BlahHostingSaved')}</p></Show>
    <p role="status">{message()}</p>
  </div>;
}

export function showHostedNameChooser(props: Omit<Props, 'signal'>) {
  const controller = new AbortController();
  function Content() {
    const popup = usePopupContext();
    return <HostedNameChooser {...props} signal={controller.signal} onComplete={() => popup.hide()} />;
  }
  createPopup(() => <PopupElement class={styles.setupPopup} closable onClose={() => controller.abort()}>
    <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahHostingAdd" /></PopupElement.Header>
    <PopupElement.Scrollable><PopupElement.Body class={styles.setupBody}><Content /></PopupElement.Body></PopupElement.Scrollable>
  </PopupElement>);
}
