import upstream from '@/config/modes';

// URL switches such as ?test=1 or ?debug=1 must not move the widget off its
// pinned transport or put customer credentials into the debug log buffer.
export default {
  ...upstream,
  test: false,
  debug: false,
  http: false,
  ssl: true,
  transport: 'websocket' as const,
  multipleTransports: false,
  pfs: false
};
