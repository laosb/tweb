import type {ButtonMenuItemOptionsVerifiable} from '@components/buttonMenu';

// Shared-media infrastructure is constructed by the hidden sidebar. Its profile
// menus are empty; no profile opener can reach the gift or story tab renderers.
export const profileStarGiftsButtonMenu = (): ButtonMenuItemOptionsVerifiable[] => [];
export const profileStoriesButtonMenu = profileStarGiftsButtonMenu;
export const isStoryReorderTarget = () => false;
export function StarGiftsProfileTab() {
  return {render: undefined as HTMLElement, store: {loading: false, loaded: true},
    actions: {loadNext: () => Promise.resolve()}, setCollection: () => {}};
}
export function StoriesProfileList() {
  return {render: undefined as HTMLElement, state: {}, actions: {load: () => Promise.resolve()}, setAlbum: () => {}};
}
