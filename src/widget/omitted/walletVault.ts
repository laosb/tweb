// Account logout still asks to wipe Wallet custody. A widget never creates its database.
export default class WalletVault {
  constructor(_userId: UserId) {}
  wipe() { return Promise.resolve(); }
  static wipeAll() { return Promise.resolve(); }
}
