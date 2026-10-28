import upstream from '@/config/modes';
import {IS_SAFARI} from '@environment/userAgent';

export * from '@/config/modes';

// URL switches such as ?test=1, ?debug=1 or ?noWorker=1 must not move the widget off its
// pinned DC or put customer credentials into the debug log buffer. HTTP and WebSocket
// to that same DC are both allowed.
export default {
  ...upstream,
  test: false,
  debug: false,
  logs: false,
  ssl: true,
  pfs: false,
  // WebKit cannot read iframe-owned Blobs in a SharedWorker (FileReader returns
  // null). Keep media uploads in a dedicated worker in this embedded client.
  noSharedWorker: IS_SAFARI || upstream.noSharedWorker,
  noWorker: false
};
