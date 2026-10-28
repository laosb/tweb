beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubEnv('VITE_MTPROTO_HAS_WS', '1');
  vi.stubEnv('VITE_MTPROTO_HAS_HTTP', '1');
  vi.stubEnv('VITE_MTPROTO_AUTO', '1');
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  ['&http=1', '1', {http: true, transport: 'https', multipleTransports: false}],
  ['', '1', {http: true, transport: 'https', multipleTransports: true}],
  ['', '', {http: false, transport: 'websocket', multipleTransports: false}]
])('keeps widget protections while following upstream transport selection (%s, auto=%s)', async(query, auto, expected) => {
  vi.stubEnv('VITE_MTPROTO_AUTO', auto);
  vi.stubGlobal('location', {search: '?test=1&debug=1&logs=1&noWorker=1&noSharedWorker=1&ssl=0' + query});
  const {default: modes} = await import('@/widget/modes');
  expect(modes).toMatchObject({
    ...expected, test: false, debug: false, logs: false, pfs: false,
    noWorker: false, noSharedWorker: true, ssl: true
  });
});

it('keeps persisted experimental flags from enabling widget credential logs', async() => {
  localStorage.setItem('experimental_flags', JSON.stringify(['debug', 'logs', 'noWorker', 'http']));
  const {default: modes, getLoadedWorkerFlags, isPageOnlyFlag, getURLWithoutFlags} = await import('@/widget/modes');
  expect(modes).toMatchObject({debug: false, logs: false, noWorker: false, http: true});
  expect(getLoadedWorkerFlags()).toContain('http');
  expect(isPageOnlyFlag('rtl')).toBe(true);
  expect(getURLWithoutFlags([])).toBeUndefined();
});
