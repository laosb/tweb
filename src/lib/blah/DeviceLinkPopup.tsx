import {createSignal, onCleanup, onMount, Show} from 'solid-js';
import Button from '@components/buttonTsx';
import CheckboxField from '@components/checkboxFieldTsx';
import Row from '@components/rowTsx';
import PopupElement, {createPopup, usePopupContext} from '@components/popups/indexTsx';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';
import type {AppManagers} from '@lib/managers';
import bindManagersToAccount from '@lib/accounts/bindManagersToAccount';
import {getManagersSession} from '@lib/accounts/getCurrentAccount';
import I18n, {i18n} from '@lib/langPack';
import getStream from '@lib/calls/helpers/getStream';
import IdentityInput from '@lib/blah/IdentityInput';
import {exportIdentityFile} from '@lib/blah/identityFiles';
import {deviceLinkMessage} from '@lib/blah/deviceLinkMessage';
import type {DeviceLinkResult} from '@lib/blah/deviceLinkTypes';
import styles from '@lib/blah/identity.module.scss';

if(import.meta.hot) import.meta.hot.accept();

type Detector = {detect(source: HTMLVideoElement): Promise<{rawValue: string}[]>};
type DetectorClass = {new(options: {formats: string[]}): Detector, getSupportedFormats?: () => Promise<string[]>};
type Props = {managers: AppManagers, id?: string, onLinked?: () => void | Promise<void>};

export default function showDeviceLinkPopup(props: Props) {
  const attempt = crypto.randomUUID();
  const manager = props.managers.appAccountManager;
  const custodyManager = bindManagersToAccount(props.managers, getManagersSession(props.managers).accountNumber).appAccountManager;
  let closed = false;
  let stream: MediaStream;
  let cameraGeneration = 0;
  let scanTimer: ReturnType<typeof setTimeout>;
  let unlockedHere: string;
  let pending: Promise<void>;
  function stopCamera() {
    ++cameraGeneration;
    clearTimeout(scanTimer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
  }
  function Content() {
    const popup = usePopupContext();
    const [busy, setBusy] = createSignal(false);
    const [message, setMessage] = createSignal('');
    const [phase, setPhase] = createSignal<'scan' | 'confirm' | 'unlock' | 'publish'>('scan');
    const [link, setLink] = createSignal('');
    const [info, setInfo] = createSignal<DeviceLinkResult>();
    const [transfer, setTransfer] = createSignal(true);
    const [scanning, setScanning] = createSignal(false);
    const [cameraAvailable, setCameraAvailable] = createSignal(false);
    let input: HTMLInputElement;
    let password: HTMLInputElement;
    let video: HTMLVideoElement;
    let actionButton: HTMLElement;
    const Detector = (globalThis as typeof globalThis & {BarcodeDetector?: DetectorClass}).BarcodeDetector;
    onMount(async() => {
      focusWhenSettled(input, () => !closed);
      if(Detector && navigator.mediaDevices) {
        try { setCameraAvailable(!Detector.getSupportedFormats || (await Detector.getSupportedFormats()).includes('qr_code')); }
        catch{ setCameraAvailable(false); }
      }
    });
    onCleanup(stopCamera);
    const focusAction = () => focusWhenSettled(actionButton, () => !closed);
    function run(action: () => Promise<void>) {
      if(busy() || closed) return;
      setBusy(true); setMessage('');
      pending = action().catch((error) => {
        if(!closed) setMessage(phase() === 'unlock' && !info().unlocked ? I18n.format('BlahLinkUnlockFailed', true) : deviceLinkMessage(error));
      })
      .finally(() => { if(!closed) setBusy(false); });
    }
    async function inspect(value: string) {
      stopCamera(); setScanning(false);
      const result = await manager.blahDeviceLink({action: 'inspect', attempt, link: value, id: props.id});
      if(closed) return;
      setInfo(result); setPhase('confirm'); focusAction();
    }
    async function scan() {
      const generation = ++cameraGeneration;
      setMessage('');
      setScanning(true);
      try {
        const detector = new Detector({formats: ['qr_code']});
        const camera = await getStream({video: {facingMode: {ideal: 'environment'}}, audio: false});
        if(closed || generation !== cameraGeneration || phase() !== 'scan' || !scanning()) { camera.getTracks().forEach((track) => track.stop()); return; }
        stream = camera;
        video.srcObject = stream;
        await video.play();
        const detect = async() => {
          if(closed || generation !== cameraGeneration || !stream || phase() !== 'scan') return;
          try {
            const codes = await detector.detect(video);
            if(closed || generation !== cameraGeneration || !stream) return;
            if(codes.length) {
              setLink(codes[0].rawValue);
              run(() => inspect(codes[0].rawValue));
              return;
            }
          } catch{
            if(!closed && generation === cameraGeneration) { setMessage(I18n.format('BlahLinkCameraUnavailable', true)); stopCamera(); setScanning(false); }
            return;
          }
          scanTimer = setTimeout(detect, 250);
        };
        void detect();
      } catch{
        if(generation !== cameraGeneration) return;
        stopCamera(); setScanning(false);
        if(!closed) setMessage(I18n.format('BlahLinkCameraUnavailable', true));
      }
    }
    async function accept() {
      await manager.blahDeviceLink({action: 'accept', attempt});
      if(closed) return;
      await props.onLinked?.();
      if(closed) return;
      popup.hide();
    }
    async function prepare() {
      const result = await manager.blahDeviceLink({action: 'prepare', attempt, transferIdentity: transfer()});
      if(closed) return;
      setInfo((previous) => ({...previous, ...result}));
      if(result.manualPublication) { setPhase('publish'); focusAction(); }
      else await accept();
    }
    async function confirm() {
      if(!info().unlocked) {
        setPhase('unlock');
        focusWhenSettled(password, () => !closed);
      } else await prepare();
    }
    async function unlock() {
      if(!password.value) return;
      const value = password.value;
      password.value = '';
      await custodyManager.blahIdentity({action: 'unlock', id: info().id, password: value});
      unlockedHere = info().id;
      if(closed) return;
      setInfo((previous) => ({...previous, unlocked: true}));
      await prepare();
    }
    return <div class={styles.panel} aria-busy={busy()}>
      <Show when={phase() === 'scan'}>
        <form onSubmit={(event) => { event.preventDefault(); run(() => inspect(link())); }}>
          <p dir="auto">{i18n('BlahLinkScanHelp')}</p>
          <IdentityInput label="BlahLinkPaste" value={link()} onInput={setLink} disabled={busy()} ref={(element) => { input = element; element.dir = 'ltr'; }} />
          <Show when={cameraAvailable()}>
            <Button text={scanning() ? 'BlahLinkStopCamera' : 'BlahLinkCamera'} disabled={busy()} onClick={() => {
              if(scanning()) { stopCamera(); setScanning(false); } else void scan();
            }} />
          </Show>
          <Show when={scanning()}><video ref={video} muted playsinline style={{width: '100%', 'max-height': '240px'}} /></Show>
          <Button primaryFilled text="Continue" disabled={busy() || !link().trim()} onClick={() => run(() => inspect(link()))} />
        </form>
      </Show>
      <Show when={phase() === 'confirm'}>
        <p dir="auto">{i18n('BlahLinkConfirm', [<b dir="auto">{info().label}</b> as HTMLElement])}</p>
        <Row>
          <Row.CheckboxField><CheckboxField checked={transfer()} disabled={busy()} onChange={setTransfer} /></Row.CheckboxField>
          <Row.Title>{i18n('BlahLinkTransfer')}</Row.Title>
        </Row>
        <Button ref={actionButton} primaryFilled text="BlahLinkApprove" disabled={busy()} onClick={() => run(confirm)} />
      </Show>
      <Show when={phase() === 'unlock'}>
        <form onSubmit={(event) => { event.preventDefault(); run(unlock); }}>
          <p dir="auto">{i18n('BlahLinkUnlock', [<bdi dir="ltr">{info().domain || info().id}</bdi> as HTMLElement])}</p>
          <IdentityInput label="BlahIdentityPassword" type="password" autocomplete="current-password" disabled={busy()} ref={(input) => password = input} />
          <Button primaryFilled text="BlahUnlockIdentity" disabled={busy()} onClick={() => run(unlock)} />
        </form>
      </Show>
      <Show when={phase() === 'publish'}>
        <p dir="auto">{i18n('BlahLinkPublish', [<bdi dir="ltr">{`https://${info().identity.domain}/.well-known/blah/profile.cbor`}</bdi> as HTMLElement])}</p>
        <Button text="BlahExportProfile" onClick={() => exportIdentityFile('profile.cbor', new Uint8Array(info().identity.profile))} />
        <Button ref={actionButton} primaryFilled text="Continue" disabled={busy()} onClick={() => run(accept)} />
      </Show>
      <p role="status">{busy() ? i18n('PleaseWait') : message()}</p>
    </div>;
  }
  createPopup(() => <PopupElement managers={props.managers} class={styles.setupPopup} closable onClose={() => {
    closed = true;
    stopCamera();
    void custodyManager.blahDeviceLink({action: 'cancel', attempt}).catch(() => {});
    void Promise.resolve(pending).then(async() => {
      if(unlockedHere) await custodyManager.blahIdentity({action: 'lock', id: unlockedHere});
    }).catch(() => {});
  }}>
    <PopupElement.Header><PopupElement.CloseButton /><PopupElement.Title title="BlahLinkDevice" /></PopupElement.Header>
    <PopupElement.Scrollable><PopupElement.Body class={styles.setupBody}><Content /></PopupElement.Body></PopupElement.Scrollable>
  </PopupElement>);
}
