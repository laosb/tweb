const storage = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@lib/sessionStorage', () => ({
  default: {
    get: vi.fn(async(key: string) => storage.get(key)),
    set: vi.fn(async(values: Record<string, unknown>) => {
      for(const [key, value] of Object.entries(values)) storage.set(key, structuredClone(value));
    }),
    delete: vi.fn(async(key: string) => { storage.delete(key); })
  }
}));
vi.mock('@lib/passcode/deferredIsUsingPasscode', () => ({
  default: {isUsingPasscode: async() => false}
}));
vi.mock('@config/debug', () => ({MOUNT_CLASS_TO: {}}));

beforeEach(() => {
  vi.resetModules();
  storage.clear();
  vi.stubGlobal('__BLAH_CONFIG__', {defaultDcId: 255, dcs: []});
});
afterEach(() => vi.unstubAllGlobals());

it('persists and reloads DC 255 keys, including legacy interoperability keys', async() => {
  const {default: AccountController} = await import('@lib/accounts/accountController');
  await AccountController.update(1, {dcId: 255, dc255_auth_key: 'a'.repeat(512), dc255_server_salt: 'b'.repeat(16)});
  expect(await AccountController.get(1)).toMatchObject({
    dcId: 255,
    dc255_auth_key: 'a'.repeat(512),
    dc255_server_salt: 'b'.repeat(16),
    auth_key_fingerprint: 'aaaaaaaa'
  });
  expect(storage.get('dc')).toBe(255);
  expect(storage.get('dc255_auth_key')).toBe('a'.repeat(512));
  expect(storage.get('dc255_server_salt')).toBe('b'.repeat(16));
});

it('clears high-DC legacy keys when enabling a passcode or switching accounts', async() => {
  const {default: AccountController} = await import('@lib/accounts/accountController');
  storage.set('dc255_auth_key', 'old-key');
  storage.set('dc255_server_salt', 'old-salt');
  await AccountController.updateStorageForLegacy(null);
  expect(storage.has('dc255_auth_key')).toBe(false);
  expect(storage.has('dc255_server_salt')).toBe(false);
});
