// Match cancellation: promise pickers reject; callback pickers close without selecting.
export default function showPickUserPopup(options: {onClose?: () => void, onCloseAfterTimeout?: () => void} = {}) {
  queueMicrotask(() => { options.onClose?.(); options.onCloseAfterTimeout?.(); });
  return {hide() {}, finalize: () => Promise.resolve(), selector: undefined as undefined};
}
export function showPickUser2Popup(..._args: unknown[]): Promise<never> { return Promise.reject(); }
export const showPickUser3Popup = showPickUser2Popup;
export const showSharingPicker2Popup = showPickUser2Popup;
export const showReplyPickerPopup = showPickUser2Popup;
export const showContactPickerPopup = showPickUser2Popup;
export const showSharingPickerPopup = showPickUserPopup;
