import upstream from '@/config/modes';

export default {
  ...upstream,
  test: false,
  debug: false,
  http: false,
  ssl: true,
  transport: 'websocket' as const,
  multipleTransports: false,
  noSharedWorker: true,
  noServiceWorker: true,
  pfs: false
};
