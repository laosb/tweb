import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function checkHiddenControllers(frame) {
  const result = await frame.evaluate(async() => {
    const {chat} = window.appImManager;
    const {input, topbar, selection} = chat;
    const recording = input.recordingController;
    const paid = input.paidMessageInterceptor;
    let captures = 0;
    const devices = navigator.mediaDevices;
    const getUserMedia = devices?.getUserMedia;
    if(devices) devices.getUserMedia = () => { ++captures; throw new Error('unexpected capture'); };
    try {
      recording.startActive();
      recording.handleSendButtonClick();
      recording.finishRecordingFromMenu();
      recording.setVoiceRecordingMenuGuard(true);
      const commandResult = await input.commandsHelper.checkQuery('/help', chat.peerId);
      const payment = await paid.prepareStarsForPayment(1);
      const staticPayment = await paid.constructor.prepareStarsForPayment({peerId: chat.peerId, messageCount: 1});
      return {
        commandResult,
        paymentAbsent: payment === undefined && staticPayment === undefined,
        paymentSymbol: typeof paid.constructor.PaymentRejectedSymbol,
        captures,
        active: recording.active,
        recorder: recording.hasAnyRecorder(),
        topbarDetached: !topbar.container.isConnected,
        topbarEmpty: !topbar.container.childNodes.length && !topbar.menuButtons.length,
        selectionEmpty: !selection.isSelecting && !selection.selectedMids.size,
        diagnostics: ['memoryWatch', 'memoryReport', 'downloadMemoryWatch', 'downloadLogs', 'collectLogs']
        .filter(key => typeof window[key] === 'function')
      };
    } finally {
      if(devices) devices.getUserMedia = getUserMedia;
    }
  });
  assert.deepEqual(result, {
    commandResult: false,
    paymentAbsent: true,
    paymentSymbol: 'symbol',
    captures: 0,
    active: false,
    recorder: false,
    topbarDetached: true,
    topbarEmpty: true,
    selectionEmpty: true,
    diagnostics: []
  });
  const editor = frame.getByRole('textbox', {name: 'Message'});
  await editor.fill('/help');
  await editor.press('End');
  await expect(frame.locator('.commands-helper, .chat-tips, .voice-recording-panel, .video-recording-panel, #auth-flow-root, #auth-pages')).toHaveCount(0);
  await editor.fill('');
  assert.equal(await frame.evaluate(() => localStorage.getItem('memory_watch_log')), null);
  console.log('PASS hidden controllers: no capture/commands/auth/tips/debug UI, zero-price promises, detached topbar');
}
