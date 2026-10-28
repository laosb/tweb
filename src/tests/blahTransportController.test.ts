vi.mock('@lib/mtproto/dcConfigurator', () => ({DcConfigurator: class {
  chooseServer() { throw new Error('Unexpected transport before discovery'); }
}}));
vi.mock('@lib/blah/discovery', () => ({savedDC: vi.fn(), restoreDC: vi.fn()}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('__BLAH_CONFIG__', {discovery: true, defaultDcId: 1, dcs: []});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('does not probe a fresh slot with no saved DC', async() => {
  const {savedDC} = await import('@lib/blah/discovery');
  vi.mocked(savedDC).mockResolvedValue(undefined);
  const {DcConfigurator} = await import('@lib/mtproto/dcConfigurator');
  const choose = vi.spyOn(DcConfigurator.prototype, 'chooseServer');
  const {MTTransportController} = await import('@lib/mtproto/transports/controller');
  const controller = new MTTransportController();
  void controller.waitForWebSocket();
  await vi.advanceTimersByTimeAsync(30000);
  expect(savedDC).toHaveBeenCalledWith(1);
  expect(choose).not.toHaveBeenCalled();
});

it('waits for verification and retries a rejected probe without getting stuck', async() => {
  const {savedDC, restoreDC} = await import('@lib/blah/discovery');
  vi.mocked(savedDC).mockResolvedValue({} as any);
  vi.mocked(restoreDC).mockRejectedValueOnce(new Error('Expired profile'));
  const {MTTransportController} = await import('@lib/mtproto/transports/controller');
  const controller = new MTTransportController();
  const ping = vi.spyOn(controller, 'pingTransports');
  const change = vi.fn();
  controller.addEventListener('transport', change);
  const waiting = controller.waitForWebSocket();
  await vi.advanceTimersByTimeAsync(0);
  expect(restoreDC).toHaveBeenCalledWith(1);
  expect(change).not.toHaveBeenCalled();
  ping.mockResolvedValue({https: true, websocket: true});
  await vi.advanceTimersByTimeAsync(10000);
  await waiting;
  expect(ping).toHaveBeenCalledTimes(2);
  expect(change).toHaveBeenCalledWith('websocket');
  await controller.waitForWebSocket();
  expect(ping).toHaveBeenCalledTimes(3);
});
