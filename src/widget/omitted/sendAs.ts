import noop from '@helpers/noop';

export default class WidgetSendAs {
  updateManual() { return Promise.resolve(noop); }
  update() {}
  setPeerId() {}
  getSendAsPeerId(): PeerId { return undefined; }
  destroy() {}
}
