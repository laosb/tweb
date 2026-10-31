import {createContext, ParentProps} from 'solid-js';

export const STORY_DURATION = 5000;
export const StoriesContext = createContext();
export function StoriesProvider(props: ParentProps) { return props.children; }
export function createStoriesStore() { return [{peers: [], loaded: true}, {}] as const; }
export const useStories = createStoriesStore;
