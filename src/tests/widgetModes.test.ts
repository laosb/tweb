beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_MTPROTO_HAS_WS', '1');
  vi.stubEnv('VITE_MTPROTO_HAS_HTTP', '1');
  vi.stubEnv('VITE_MTPROTO_AUTO', '1');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  ['&http=1', '1', {http: true, transport: 'https', multipleTransports: false}],
  ['', '1', {http: true, transport: 'https', multipleTransports: true}],
  ['', '', {http: false, transport: 'websocket', multipleTransports: false}]
])('keeps widget protections while following upstream transport selection (%s, auto=%s)', async(query, auto, expected) => {
  vi.stubEnv('VITE_MTPROTO_AUTO', auto);
  vi.stubGlobal('location', {search: '?test=1&debug=1&noWorker=1&noSharedWorker=1&ssl=0' + query});
  const {default: modes} = await import('@/widget/modes');
  expect(modes).toMatchObject({
    ...expected, test: false, debug: false, pfs: false,
    noWorker: false, noSharedWorker: true, ssl: true
  });
});
