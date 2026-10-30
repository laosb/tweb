import PeerTitle from '@components/peerTitle';
import {useWidgetSelfTitle} from '@/widget/selfTitle';
import I18n from '@lib/langPack';
import rootScope from '@lib/rootScope';

beforeAll(async() => {
  vi.spyOn(rootScope, 'dispatchEvent').mockImplementation(() => {});
  await I18n.getCacheLangPackAndApply();
  rootScope.myId = 1 as PeerId;
});
vi.mock('@components/peerTitle', () => ({default: class {
  public element = document.createElement('span');
  public options = {};
  public async update(options = {}) {
    Object.assign(this.options, options);
    await Promise.resolve();
    this.element.innerHTML = '<span class="peer-title-inner">Original</span><i class="badge"></i>';
  }
}}));
beforeAll(useWidgetSelfTitle);

it('labels self identity titles, preserving badges and later peer updates', async() => {
  const title = new PeerTitle();
  await title.update({peerId: 1 as PeerId, onlyFirstName: true});
  expect(title.element.textContent).toBe('Me');
  expect(title.element.querySelector('.badge')).not.toBeNull();
  await title.update();
  expect(title.element.textContent).toBe('Me');
  await title.update({peerId: 2 as PeerId});
  expect(title.element.textContent).toBe('Original');
});

it.each([{dialog: true}, {username: true}, {threadId: 10}, {fromName: 'Explicit'}, {asAllChats: 'topics' as const}])(
  'preserves non-identity titles: %j', async(options) => {
    const title = new PeerTitle();
    await title.update({peerId: 1 as PeerId, ...options});
    expect(title.element.textContent).toBe('Original');
  }
);

it('fails closed if upstream removes the rendering method', () => {
  const update = PeerTitle.prototype.update;
  try {
    PeerTitle.prototype.update = undefined;
    expect(useWidgetSelfTitle).toThrow('WIDGET_RESTRICTION_TARGET_MISSING: update');
  } finally {
    PeerTitle.prototype.update = update;
  }
});
