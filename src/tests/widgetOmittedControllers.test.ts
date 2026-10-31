import Recording from '@/widget/omitted/recording';
import CommandsHelper from '@/widget/omitted/commandsHelper';
import PaidMessagesInterceptor, {PAYMENT_REJECTED} from '@/widget/omitted/paidMessagesInterceptor';
import PriceChangedInterceptor from '@/widget/omitted/priceChangedInterceptor';
import {disposeActiveAuthFlow, mountAuthFlow} from '@/widget/omitted/authFlow';
import showToggleReadDatePopup from '@/widget/omitted/readDate';
import memoryReport from '@/widget/omitted/memoryReport';
import {createPeakRecorder, readThreadMemory} from '@/widget/omitted/memoryStats';
import {getLogEntries, isLogBufferEnabled, setLogBufferEnabled} from '@/widget/omitted/logsBuffer';
import {getMemoryLogEntries, isMemoryWatchOn, startMemoryWatch} from '@/widget/omitted/memoryWatch';
import {assertWidgetCleanupAssets, assertWidgetCleanupModules} from '../../scripts/widget-cleanup-guards';

it('never acquires recording devices or creates panels', () => {
  const input = new Proxy({}, {get() { throw new Error('capture touched the input'); }});
  const recording = new Recording(input);
  expect(recording.active).toBe(false);
  expect(recording.hasAnyRecorder()).toBe(false);
  expect(recording.hasVoiceRecorder()).toBe(false);
  expect(recording.canSwitchRecordingMode()).toBe(false);
  expect(recording.consumeLongPressSuppression()).toBe(false);
  expect(recording.getActiveRecordingMediaType()).toBe('voice');
  recording.startActive();
  recording.handleSendButtonClick();
  recording.finishRecordingFromMenu();
  recording.destroy();
  expect(recording.active).toBe(false);
  expect(document.querySelector('.voice-recording-panel, .video-recording-panel')).toBeNull();
});

it('returns a false boolean from command checks without reading managers', async() => {
  const managers = new Proxy({}, {get() { throw new Error('unexpected command lookup'); }});
  const commands = new CommandsHelper(undefined, undefined, undefined, managers);
  expect(await commands.checkQuery('/help', 1)).toBe(false);
  commands.toggle();
  expect(commands.hidden).toBe(true);
});

it('keeps payment rejection identity and zero-price promises without manager lookups', async() => {
  const chat = {starsAmount: 0};
  const managers = new Proxy({}, {get() { throw new Error('unexpected payment lookup'); }});
  const paid = new PaidMessagesInterceptor(chat, managers);
  const priceChanged = new PriceChangedInterceptor({chat, managers});
  priceChanged.init();
  expect(PaidMessagesInterceptor.PaymentRejectedSymbol).toBe(PAYMENT_REJECTED);
  expect(typeof PAYMENT_REJECTED).toBe('symbol');
  expect(await paid.prepareStarsForPayment(1)).toBeUndefined();
  expect(await PaidMessagesInterceptor.prepareStarsForPayment({peerId: 1, messageCount: 1})).toBeUndefined();
  paid.dispose();
  priceChanged.cleanup();
});

it('keeps auth disposal and read-date opener callable without UI', async() => {
  disposeActiveAuthFlow(1000);
  const host = mountAuthFlow();
  await host.leave();
  host.back();
  host.dispose();
  await showToggleReadDatePopup();
  expect(document.querySelector('#auth-flow-root, #auth-pages, .popup')).toBeNull();
});

it('keeps worker diagnostic shapes without collecting, scheduling or registering console helpers', async() => {
  const recorder = createPeakRecorder();
  recorder.observe();
  recorder.reset();
  expect(recorder.events).toEqual([]);
  expect(readThreadMemory('lottie')).toEqual({thread: 'lottie'});
  expect(await memoryReport()).toEqual({threads: {}, metrics: {}, events: []});
  setLogBufferEnabled();
  startMemoryWatch();
  expect(isLogBufferEnabled()).toBe(false);
  expect(isMemoryWatchOn()).toBe(false);
  expect(getLogEntries()).toEqual([]);
  expect(getMemoryLogEntries()).toEqual([]);
  expect((window as any).memoryWatch).toBeUndefined();
  expect((window as any).memoryReport).toBeUndefined();
});

it.each([
  'src/components/sidebarLeft/newPanel.tsx',
  'src/components/sidebarRight/tabs/newProfile.tsx',
  'src/components/autonomousDialogList/renamedList.ts',
  'src/components/stories/newStore.ts',
  'src/components/solidJsTabs/providedTabs.ts',
  'src/helpers/qrCode/newQr.ts',
  'src/config/currencies.ts',
  'src/components/chat/recording/newRecorder.ts',
  'src/helpers/videoRecorder/newEncoder.ts',
  'src/components/chat/voiceRecording/newPanel.ts',
  'src/components/chat/topbarPlates.ts',
  'src/components/chat/priceChangedInterceptor/newTooltip.tsx',
  'src/components/chatTips/newCard.tsx',
  'src/pages/authFlow.tsx',
  'src/components/quizHint.ts',
  'src/lib/debug/newReporter.ts',
  'src/vendor/rnnoise/renamed.wasm?url'
])('rejects reintroduced feature code: %s', path => {
  expect(() => assertWidgetCleanupModules([path], [])).toThrow('widget omitted feature code is reachable');
});

it('allows the exact replacements and retained playback/editor code', () => {
  expect(() => assertWidgetCleanupModules([
    'src/components/chat/recording/chatRecording.ts',
    'src/components/audio.tsx',
    'src/components/wrappers/roundVideoBubble.ts',
    'src/components/mediaEditor/index.tsx'
  ], ['src/components/chat/recording/chatRecording.ts'])).not.toThrow();
});

it.each(['rnnoise-abc.wasm', 'assets/weights-abc.bin', 'src/vendor/rnnoise/renamed.bin', 'assets/img/EmptyChats.svg', 'assets/img/chat-thread-separator-dash-black.svg'])(
  'rejects emitted omitted assets: %s', path => {
    expect(() => assertWidgetCleanupAssets([path])).toThrow('widget omitted assets are emitted');
  }
);
