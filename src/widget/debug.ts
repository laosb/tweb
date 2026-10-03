// Credentials and customer messages must never enter tweb's debug log buffer,
// including on dev builds and URLs carrying ?debug=1.
export const DEBUG = false;
export const IS_BETA = false;
export const IS_PREVIEW = false;
export const IS_POPUP_SANDBOX = false;
export const MOUNT_CLASS_TO = {};
export default DEBUG;
