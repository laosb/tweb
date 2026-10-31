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
}

declare module '@components/wrappers/keyboardButton?widget-original' {
  const wrap: typeof import('@components/wrappers/keyboardButton').default;
  export default wrap;
  export const getKeyboardButtonHandler: typeof import('@components/wrappers/keyboardButton').getKeyboardButtonHandler;
  export const getRichPageButtonHandler: typeof import('@components/wrappers/keyboardButton').getRichPageButtonHandler;
}
