import type {BlahConfig} from '@config/blah';

vi.mock('@lib/crypto/cryptoMessagePort', () => ({default: {
  invokeCrypto: async(_method: string, buffer: ArrayBuffer) => {
    const {createHash} = await import('node:crypto');
    return new Uint8Array(createHash('sha1').update(new Uint8Array(buffer)).digest());
  }
}}));

vi.mock('@lib/mtproto/transports/http', () => ({default: class {}}));
vi.mock('@lib/mtproto/transports/websocket', () => ({default: class {}}));
vi.mock('@lib/mtproto/transports/tcpObfuscated', () => ({default: class {}}));
vi.mock('@lib/mtproto/transports/socketProxied', () => ({default: class {}}));

const config: BlahConfig = {
  defaultDcId: 6,
  dcs: [6, 255].map((id) => ({
    id,
    url: `wss://dc${id}.example.org/apiws`,
    rsaKey: {modulus: '', exponent: ''}
  }))
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('__BLAH_CONFIG__', config);
  vi.stubEnv('VITE_MTPROTO_HAS_WS', '1');
  vi.stubEnv('VITE_MTPROTO_HAS_HTTP', '');
  vi.stubEnv('VITE_MTPROTO_AUTO', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('routes client, upload and download connections to C3, including DC 255', async() => {
  const {constructTelegramWebSocketUrl} = await import('@lib/mtproto/dcConfigurator');
  for(const type of ['client', 'upload', 'download'] as const) {
    expect(constructTelegramWebSocketUrl(255, type)).toBe('wss://dc255.example.org/apiws');
  }
  expect(constructTelegramWebSocketUrl(255, 'download', true)).toBe('wss://dc255.example.org/apiws_premium');
});

it('uses the default C3 endpoint for an unknown DC without dialing Telegram', async() => {
  const {constructTelegramWebSocketUrl} = await import('@lib/mtproto/dcConfigurator');
  expect(constructTelegramWebSocketUrl(2, 'client')).toBe('wss://dc6.example.org/apiws');
  const {default: App} = await import('@config/app');
  expect(App.baseDcId).toBe(6);
});

it('validates the entire byte range before constructing URLs', async() => {
  const {assertValidDcId} = await import('@lib/mtproto/dcConfigurator');
  expect(assertValidDcId(255)).toBe(255);
  for(const id of [0, 256, -1, 1.2, NaN, '1.evil.example/']) {
    expect(() => assertValidDcId(id as number)).toThrow('invalid dcId');
  }
  const {DC_IDS} = await import('@config/dc');
  expect(DC_IDS).toHaveLength(255);
  expect(DC_IDS[254]).toBe(255);
});

it('leaves Telegram routing and validation unchanged without Blah', async() => {
  vi.stubGlobal('__BLAH_CONFIG__', undefined);
  const {assertValidDcId, constructTelegramWebSocketUrl} = await import('@lib/mtproto/dcConfigurator');
  expect(constructTelegramWebSocketUrl(2, 'download')).toBe('wss://kws2-1.web.telegram.org/apiws');
  expect(() => assertValidDcId(6)).toThrow('invalid dcId');
  const {DC_IDS} = await import('@config/dc');
  expect(DC_IDS).toEqual([1, 2, 3, 4, 5]);
});

it('uses the exact signed home endpoint for every connection and never falls back to Telegram', async() => {
  vi.stubGlobal('__BLAH_CONFIG__', {discovery: true, defaultDcId: 1, expiresAt: '9999999999',
    home: {domain: 'dc.example.org', identity: 'ab'.repeat(32), generation: '1'},
    dcs: [{id: 1, url: 'wss://dc.example.org/custom/ws?route=one', rsaKey: {modulus: '', exponent: ''}}]});
  const {setBlahConfig} = await import('@config/blah');
  setBlahConfig(1, (globalThis as any).__BLAH_CONFIG__);
  const {constructTelegramWebSocketUrl} = await import('@lib/mtproto/dcConfigurator');
  for(const type of ['client', 'upload', 'download'] as const) {
    expect(constructTelegramWebSocketUrl(1, type, true)).toBe('wss://dc.example.org/custom/ws?route=one');
  }
  expect(() => constructTelegramWebSocketUrl(2, 'client')).toThrow('DC1');
});

it('refuses transport before discovery or after profile expiry', async() => {
  const config: BlahConfig = {discovery: true, defaultDcId: 1, dcs: [], home: undefined, expiresAt: '1'};
  vi.stubGlobal('__BLAH_CONFIG__', config);
  const {getBlahDc, setBlahConfig} = await import('@config/blah');
  expect(() => getBlahDc(1)).toThrow('refresh');
  setBlahConfig(1, config);
  config.home = {domain: 'dc.example.org', identity: 'ab'.repeat(32), generation: '1'};
  expect(() => getBlahDc(1)).toThrow('refresh');
});

it('routes concurrent account transports independently even when both homes are DC1', async() => {
  vi.stubGlobal('__BLAH_CONFIG__', {discovery: true, defaultDcId: 1, dcs: []});
  const {setBlahConfig, getBlahDc} = await import('@config/blah');
  const {constructTelegramWebSocketUrl} = await import('@lib/mtproto/dcConfigurator');
  for(const slot of [1, 2]) {
    setBlahConfig(slot, {discovery: true, defaultDcId: 1, expiresAt: '9999999999',
      home: {domain: `dc${slot}.example.org`, identity: String(slot).repeat(64), generation: '1'},
      dcs: [{id: 1, url: `wss://dc${slot}.example.org/exact?home=${slot}`, rsaKey: {modulus: String(slot), exponent: '010001'}}]});
  }
  for(const type of ['client', 'upload', 'download'] as const) {
    for(const slot of [2, 1, 2]) {
      expect(constructTelegramWebSocketUrl(1, type, true, slot)).toBe(`wss://dc${slot}.example.org/exact?home=${slot}`);
      expect(getBlahDc(1, slot).rsaKey.modulus).toBe(String(slot));
      expect(() => constructTelegramWebSocketUrl(2, type, false, slot)).toThrow('DC1');
    }
  }
  expect(() => constructTelegramWebSocketUrl(1, 'client', false, 3)).toThrow('refresh');
});

it('keeps RSA trust scoped to the account home in a shared worker', async() => {
  vi.stubGlobal('__BLAH_CONFIG__', {discovery: true, defaultDcId: 1, dcs: []});
  const {setBlahConfig} = await import('@config/blah');
  for(const slot of [1, 2]) {
    setBlahConfig(slot, {discovery: true, defaultDcId: 1, expiresAt: '9999999999',
      home: {domain: 'dc' + slot + '.example.org', identity: String(slot).repeat(64), generation: '1'},
      dcs: [{id: 1, url: '', rsaKey: {modulus: slot === 1 ? 'aa' : 'bb', exponent: '010001'}}]});
  }
  const {RSAKeysManager} = await import('@lib/mtproto/rsaKeysManager');
  const first = new RSAKeysManager(1), second = new RSAKeysManager(2);
  await Promise.all([first.prepare(), second.prepare()]);
  // SHA-1 fingerprints of the TL-encoded fixture public keys.
  const fingerprints = ['7337623569885318065', '4901851974651628626'];
  expect(await first.select(fingerprints)).toMatchObject({modulus: 'aa'});
  expect(await second.select(fingerprints)).toMatchObject({modulus: 'bb'});
  expect(await first.select([fingerprints[1]])).toBeUndefined();
  expect(await second.select([fingerprints[0]])).toBeUndefined();
});
