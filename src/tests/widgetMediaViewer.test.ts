import AppMediaViewer from '@components/mediaViewer';
import {restrictMediaViewer} from '@/widget/mediaViewerRestrictions';

const upstream = vi.hoisted(() => ({actions: vi.fn(), menu: vi.fn()}));
vi.mock('@components/mediaViewer', () => ({default: class {
  public setMessageActionVisibility(options: object) { upstream.actions(options); }
  public setBtnMenuToggle(buttons: unknown[]) { upstream.menu(buttons); }
}}));
beforeAll(restrictMediaViewer);
afterEach(() => { vi.clearAllMocks(); });
const viewer = () => Object.assign(Object.create(AppMediaViewer.prototype), {
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
