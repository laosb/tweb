import type Original from '@appManagers/appStoriesManager';
import {AppManager} from '@appManagers/manager';
import unavailable from '@/widget/managers/unavailable';

type Contract = Pick<Original, 'saveApiPeerStories' | 'saveStoryItems' | 'saveStoryItem' | 'getPeerStoriesCache' |
  'getStoryById' | 'getPeerStories' | 'getPeerStoriesSegments' | 'getUnreadType' | 'report'>;

// Blah's DC has no stories API and the widget renders story media, mentions and
// replies as unsupported. Keep no story cache, update listeners, feed polling or
// expiry timer; peers and messages keep their story descriptors as received.
export default class AppStoriesManager extends AppManager implements Contract {
  public saveApiPeerStories(..._args: Parameters<Contract['saveApiPeerStories']>): ReturnType<Contract['saveApiPeerStories']> {
    return undefined;
  }

  public getPeerStoriesCache(..._args: Parameters<Contract['getPeerStoriesCache']>): ReturnType<Contract['getPeerStoriesCache']> {
    return undefined;
  }

  // As upstream, a deleted story is no item.
  public saveStoryItem(...[storyItem]: Parameters<Contract['saveStoryItem']>): ReturnType<Contract['saveStoryItem']> {
    return storyItem?._ === 'storyItemDeleted' ? undefined : storyItem;
  }

  public saveStoryItems(...[storyItems]: Parameters<Contract['saveStoryItems']>) {
    return storyItems.map((storyItem) => this.saveStoryItem(storyItem, undefined)).filter(Boolean);
  }

  // Known not to exist: an expired-story quote, never a request.
  public getStoryById(..._args: Parameters<Contract['getStoryById']>): ReturnType<Contract['getStoryById']> {
    return undefined;
  }

  // No segments: avatars draw no story ring.
  public getPeerStoriesSegments(..._args: Parameters<Contract['getPeerStoriesSegments']>): ReturnType<Contract['getPeerStoriesSegments']> {
    return undefined;
  }

  public getUnreadType(..._args: Parameters<Contract['getUnreadType']>): ReturnType<Contract['getUnreadType']> {
    return undefined;
  }

  public getPeerStories(..._args: Parameters<Contract['getPeerStories']>): ReturnType<Contract['getPeerStories']> {
    return unavailable();
  }

  public report(..._args: Parameters<Contract['report']>): ReturnType<Contract['report']> {
    return unavailable();
  }
}
