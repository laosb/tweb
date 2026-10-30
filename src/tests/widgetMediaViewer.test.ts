import AppMediaViewer from '@components/mediaViewer';
import {restrictMediaViewer} from '@/widget/mediaViewerRestrictions';

const upstream = vi.hoisted(() => ({actions: vi.fn(), menu: vi.fn(), authors: [] as (() => void)[]}));
vi.mock('@lib/rootScope', () => ({default: {myId: 1}}));
vi.mock('@components/mediaViewer', () => ({default: class {
  public setMessageActionVisibility(options: object) { upstream.actions(options); }
  public setBtnMenuToggle(buttons: unknown[]) { upstream.menu(buttons); }
  public setAuthorInfo(fromId: number) {
    const viewer = this as any;
    const avatar = viewer.author.avatarEl = {};
    return new Promise<void>((resolve) => upstream.authors.push(() => {
      if(viewer.author.avatarEl === avatar) viewer.author.nameEl.textContent = fromId === 1 ? 'Customer name' : 'Support';
      resolve();
    }));
  }
}}));
beforeAll(restrictMediaViewer);
afterEach(() => { vi.clearAllMocks(); upstream.authors.length = 0; });
const viewer = () => Object.assign(Object.create(AppMediaViewer.prototype), {
  author: {nameEl: document.createElement('div')},
  buttons: {forward: document.createElement('button')}
});

it('removes forwarding on desktop and from the menu, including later page changes', () => {
  const instance = viewer();
  document.body.append(instance.buttons.forward);
  for(let i = 0; i < 2; ++i) {
    instance.setMessageActionVisibility({cantForward: false, cantDownload: false});
    expect(upstream.actions).toHaveBeenLastCalledWith({cantForward: true, cantDownload: false});
    expect(instance.buttons.forward.isConnected).toBe(false);
  }
  instance.setBtnMenuToggle([{icon: 'forward'}, {icon: 'download'}]);
  expect(upstream.menu).toHaveBeenCalledWith([{icon: 'download'}]);
});

it('uses the exact self label Me, preserving support titles and avatars', async() => {
  const instance = viewer();
  for(const [id, name] of [[1, 'Me'], [2, 'Support']]) {
    const promise = instance.setAuthorInfo(id, 123);
    const avatar = instance.author.avatarEl;
    upstream.authors.shift()();
    await promise;
    expect(instance.author.nameEl.textContent).toBe(name);
    expect(instance.author.avatarEl).toBe(avatar);
  }
});

it('does not overwrite a newer support title when an older self title resolves', async() => {
  const instance = viewer();
  const self = instance.setAuthorInfo(1, 123);
  const support = instance.setAuthorInfo(2, 124);
  upstream.authors[1]();
  await support;
  upstream.authors[0]();
  await self;
  expect(instance.author.nameEl.textContent).toBe('Support');
});

it('fails closed on an upstream rename', () => {
  const proto = AppMediaViewer.prototype as any;
  const original = proto.setMessageActionVisibility;
  try {
    proto.setMessageActionVisibility = undefined;
    expect(restrictMediaViewer).toThrow('WIDGET_RESTRICTION_TARGET_MISSING: setMessageActionVisibility');
  } finally {
    proto.setMessageActionVisibility = original;
  }
});
