declare module '@components/wrappers/messageActionTextNew?widget-original' {
  const wrap: typeof import('@components/wrappers/messageActionTextNew').default;
  export default wrap;
}

declare module '@components/wrappers/messageForReply?widget-original' {
  const wrap: typeof import('@components/wrappers/messageForReply').default;
  export default wrap;
}

declare module '@helpers/addAnchorListener?widget-original' {
  const add: typeof import('@helpers/addAnchorListener').default;
  export default add;
  export const UNSAFE_ANCHOR_LINK_TYPES: typeof import('@helpers/addAnchorListener').UNSAFE_ANCHOR_LINK_TYPES;
  export const listenForMaskedAnchorAuxClicks: typeof import('@helpers/addAnchorListener').listenForMaskedAnchorAuxClicks;
}

declare module '@lib/richTextProcessor/wrapUrl?widget-original' {
  const wrap: typeof import('@lib/richTextProcessor/wrapUrl').default;
  export default wrap;
  export const PROXY_LINK_TYPES: typeof import('@lib/richTextProcessor/wrapUrl').PROXY_LINK_TYPES;
  export const getAnchorHandlerName: typeof import('@lib/richTextProcessor/wrapUrl').getAnchorHandlerName;
  export const isAnchorHandlerName: typeof import('@lib/richTextProcessor/wrapUrl').isAnchorHandlerName;
}

declare module '@components/wrappers/keyboardButton?widget-original' {
  const wrap: typeof import('@components/wrappers/keyboardButton').default;
  export default wrap;
  export const getKeyboardButtonHandler: typeof import('@components/wrappers/keyboardButton').getKeyboardButtonHandler;
  export const getRichPageButtonHandler: typeof import('@components/wrappers/keyboardButton').getRichPageButtonHandler;
}

declare module '@components/mediaViewer/index?widget-original' {
  const viewer: typeof import('@components/mediaViewer').default;
  export default viewer;
  export const onMediaCaptionClick: typeof import('@components/mediaViewer').onMediaCaptionClick;
}

declare module '@components/mediaViewer/static?widget-original' {
  const viewer: typeof import('@components/mediaViewer/static').default;
  export default viewer;
}

declare module '@components/popups/newMedia?widget-original' {
  const show: typeof import('@components/popups/newMedia').default;
  export default show;
  export const getCurrentNewMediaPopup: typeof import('@components/popups/newMedia').getCurrentNewMediaPopup;
  export const canSendNewMedia: typeof import('@components/popups/newMedia').canSendNewMedia;
}
