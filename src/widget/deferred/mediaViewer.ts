import type Upstream from '@components/mediaViewer';
import type {MyDocument} from '@appManagers/appDocsManager';
import type {MyPhoto} from '@appManagers/appPhotosManager';
import MEDIA_MIME_TYPES_SUPPORTED from '@environment/mediaMimeTypesSupport';
import {MAX_FILE_SAVE_SIZE} from '@appManagers/constants';
import {restrictMediaViewer} from '@/widget/mediaViewerRestrictions';

type Module = typeof import('@components/mediaViewer');
type Viewer = InstanceType<typeof Upstream>;
let loading: Promise<Module>, loaded: Module;

/** The upstream viewer, from the deferred chunk, restricted before its first use. */
export function loadMediaViewer() {
  return loading ??= import('@components/mediaViewer/index?widget-original').then((module) => {
    restrictMediaViewer(module.default);
    return loaded = module;
  }, (error) => {
    loading = undefined;
    throw error;
  });
}

/**
 * The viewer as its callers build it, `new AppMediaViewer(…).setSearchContext(…).openMedia(…)`
 * (widgetDeferred.test.ts checks every call site), opened once the upstream module arrives.
 */
export default class AppMediaViewer {
  private args: ConstructorParameters<typeof Upstream>;
  private searchContext: Parameters<Viewer['setSearchContext']>;

  constructor(...args: ConstructorParameters<typeof Upstream>) {
    this.args = args;
  }

  public setSearchContext(...args: Parameters<Viewer['setSearchContext']>) {
    this.searchContext = args;
    return this;
  }

  public openMedia(...args: Parameters<Viewer['openMedia']>) {
    return loadMediaViewer().then(({default: Viewer}) => {
      const viewer = new Viewer(...this.args);
      if(this.searchContext) viewer.setSearchContext(...this.searchContext);
      return viewer.openMedia(...args);
    });
  }

  // Synchronous: bubbles filter their viewer targets with it before opening.
  public static isMediaCompatibleForDocumentViewer(media: MyPhoto | MyDocument) {
    return (media._ === 'photo' || MEDIA_MIME_TYPES_SUPPORTED.has(media.mime_type) && media.size <= MAX_FILE_SAVE_SIZE);
  }
}

// Only sticker, translation, Premium and story popups call it, all left out of the widget.
export const onMediaCaptionClick: Module['onMediaCaptionClick'] = (caption, e) => loaded?.onMediaCaptionClick(caption, e);
