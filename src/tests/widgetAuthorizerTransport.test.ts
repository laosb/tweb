import type {BlahConfig} from '@config/blah';

const dc = {id: 1, url: 'wss://dc.example.org/apiws', rsaKey: {modulus: '', exponent: ''}};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_MTPROTO_AUTO', '1');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('@config/blah');
  vi.restoreAllMocks();
});

async function transportWait(config: BlahConfig) {
  vi.doMock('@config/blah', async(importOriginal) => ({...await importOriginal<object>(), default: config}));
  const {default: Modes} = await import('@config/modes');
  Modes.multipleTransports = true;
  const {default: transportController} = await import('@lib/mtproto/transports/controller');
  const ping = vi.spyOn(transportController, 'pingTransports').mockResolvedValue({https: true, websocket: true});
  const {Authorizer} = await import('@lib/mtproto/authorizer');
  const authorizer = new Authorizer({timeManager: undefined, dcConfigurator: {accountNumber: 1} as any});
  await (authorizer as any).getTransportType();
  return ping;
}

it('starts the widget key exchange without waiting for the transport probe', async() => {
  expect(await transportWait({defaultDcId: 1, dcs: [dc], widget: {param: 'pinned'}})).not.toHaveBeenCalled();
});

it('keeps the probe before key exchange for the full client', async() => {
  expect(await transportWait({defaultDcId: 1, dcs: [dc]})).toHaveBeenCalledOnce();
});
