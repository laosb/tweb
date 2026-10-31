import {startWidgetDialogs} from '@/widget/dialogsBootstrap';
import PopupElementTsx from '@components/popups/indexTsx';
import rootScope from '@lib/rootScope';

const state = vi.hoisted(() => ({
  managers: {},
  constructDownloads: vi.fn(), constructIm: vi.fn(), constructLeft: vi.fn(), constructRight: vi.fn(),
  settings: {playbackParams: {volume: 1.04}}, normalized: {volume: 1, boost: 0.04},
  setSettings: vi.fn(), setPlayback: vi.fn(), listen: vi.fn()
}));
vi.mock('@components/popups/indexTsx', () => ({default: {}}));
vi.mock('@lib/rootScope', () => ({default: {managers: undefined}}));
vi.mock('@lib/getProxiedManagers', () => ({default: () => state.managers}));
vi.mock('@components/sidebarLeft', () => ({default: {construct: state.constructLeft}}));
vi.mock('@components/sidebarRight', () => ({default: {construct: state.constructRight}}));
vi.mock('@lib/appDownloadManager', () => ({default: {construct: state.constructDownloads}}));
vi.mock('@lib/appImManager', () => ({default: {construct: state.constructIm}}));
vi.mock('@stores/appSettings', () => ({useAppSettings: () => [state.settings, state.setSettings]}));
vi.mock('@components/appMediaPlaybackController', () => ({default: {
  setPlaybackParams: state.setPlayback, getPlaybackParams: () => state.normalized, addEventListener: state.listen
}}));

it('starts real IM/download lifecycle once and persists normalized and subsequent playback parameters', () => {
  startWidgetDialogs();
  startWidgetDialogs();
  expect(rootScope.managers).toBe(state.managers);
  expect(PopupElementTsx.MANAGERS).toBe(state.managers);
  for(const construct of [state.constructDownloads, state.constructIm, state.constructLeft, state.constructRight]) {
    expect(construct).toHaveBeenCalledExactlyOnceWith(state.managers);
  }
  expect(state.setPlayback).toHaveBeenCalledExactlyOnceWith(state.settings.playbackParams);
  expect(state.setSettings).toHaveBeenCalledWith('playbackParams', state.normalized);
  expect(state.listen).toHaveBeenCalledTimes(1);
  expect(state.listen.mock.calls[0][0]).toBe('playbackParams');
  const params = {volume: 0.5, muted: true, playbackRate: 1.5};
  state.listen.mock.calls[0][1](params);
  expect(state.setSettings).toHaveBeenLastCalledWith('playbackParams', params);
});
