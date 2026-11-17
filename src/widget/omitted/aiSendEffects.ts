// The AI editor is never opened in the widget, so no send style is kept and these
// effects of applying one never run. Inert stand-ins keep the shaders and the wallet
// motion helpers they share out of the release.
export default class WidgetAiSendEffect {
  public readonly element = document.createElement('span');
  constructor(..._args: unknown[]) {}
  setShown(_shown: boolean) {}
  setActive(_active: boolean) {}
  updateLevel() {}
  start() {}
  reveal(replace: () => boolean) { return Promise.resolve(replace()); }
  stop() {}
  depart() {}
  cancel() {}
}
