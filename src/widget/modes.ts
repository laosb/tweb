import upstream from '@/config/modes';
import {IS_SAFARI} from '@environment/userAgent';

// URL switches such as ?test=1, ?debug=1 or ?noWorker=1 must not move the widget off its
// pinned transport or put customer credentials into the debug log buffer.
export default {
  ...upstream,
  test: false,
  debug: false,
  http: false,
  ssl: true,
  transport: 'websocket' as const,
  multipleTransports: false,
  pfs: false,
  // WebKit cannot read iframe-owned Blobs in a SharedWorker (FileReader returns
  // null). Keep media uploads in a dedicated worker in this embedded client.
  noSharedWorker: IS_SAFARI || upstream.noSharedWorker,
  noWorker: false
};
