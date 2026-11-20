import type Upstream from '@components/mediaViewer/static';

type Viewer = InstanceType<typeof Upstream>;
let loading: Promise<typeof import('@components/mediaViewer/static')>;

/** The poll-answer viewer, `new AppMediaViewerStatic().openMedia(…)`, opened from the deferred chunk. */
export default class AppMediaViewerStatic {
  public openMedia(...args: Parameters<Viewer['openMedia']>) {
    loading ??= import('@components/mediaViewer/static?widget-original').catch((error) => {
      loading = undefined;
      throw error;
    });
    return loading.then(({default: Viewer}) => new Viewer().openMedia(...args));
  }
}
