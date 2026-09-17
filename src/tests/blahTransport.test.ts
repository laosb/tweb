import type {BlahConfig} from '@config/blah';

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
