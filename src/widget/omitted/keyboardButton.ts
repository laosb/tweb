import wrap, {getKeyboardButtonHandler as keyboard, getRichPageButtonHandler as rich} from '@components/wrappers/keyboardButton?widget-original';

const denied = new Set([
  'inlineButtonTypeSwitchInline', 'buttonTypeRequestPeer', 'buttonTypeRequestPhone',
  'buttonTypeRequestGeoLocation', 'buttonTypeRequestPoll', 'inlineButtonTypeUrlAuth',
  'buttonTypeSimpleWebView', 'inlineButtonTypeWebView', 'inlineButtonTypeBuy', 'inlineButtonTypeGame',
  'inlineButtonTypeUserProfile'
]);
export const getKeyboardButtonHandler: typeof keyboard = options => denied.has(options.button.type._) ? undefined : keyboard(options);
export const getRichPageButtonHandler: typeof rich = options => denied.has(options.button.type._) ? undefined : rich(options);
const wrapKeyboardButton: typeof wrap = options => denied.has(options.button.type._) ? undefined : wrap(options);
export default wrapKeyboardButton;
