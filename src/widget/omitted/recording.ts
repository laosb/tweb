// Capture is unavailable; received voice and round-video playback keep their own graph.
export default class WidgetRecording {
  constructor(..._args: unknown[]) {}
  active = false;
  hasVoiceRecorder() { return false; }
  hasAnyRecorder() { return false; }
  canSwitchRecordingMode() { return false; }
  consumeLongPressSuppression() { return false; }
  getActiveRecordingMediaType() { return 'voice'; }
  setVoiceRecordingMenuGuard() {}
  finishRecordingFromMenu() {}
  handleSendButtonClick() {}
  startActive() {}
  setRecordingMediaType() {}
  destroy() {}
}
