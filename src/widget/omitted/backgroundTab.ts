import noop from '@helpers/noop';

export class AppBackgroundTab {
  static tempId = 0;
  static setBackgroundDocument() { return Promise.resolve(); }
  static addWallPaper() {
    return {container: document.createElement('div'), media: document.createElement('div'), loadPromise: Promise.resolve(), dispose: noop};
  }
}
export default function ChatBackground() {}
