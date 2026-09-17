import {generateKeyPairSync} from 'node:crypto';
import blahBuildDefines, {parseBlahServerConfig} from '../../scripts/blah-config.mjs';

const {publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
const rsaPublicKey = publicKey.export({type: 'pkcs1', format: 'pem'});
const dc = (id = 2) => ({
  id,
  rsaPublicKey,
  endpoints: [
    {ip: '192.0.2.1', port: 1521, wsTlsOnly: false},
    {ip: `dc${id}.example.org`, port: 443, wsTlsOnly: true}
  ]
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Blah release configuration', () => {
  it('prefers TLS, converts public RSA keys and supports the full DC byte', () => {
    const config = parseBlahServerConfig({dcs: [dc(255), dc(6)]});
    expect(config.defaultDcId).toBe(255);
    expect(config.dcs.map(({id}: {id: number}) => id)).toEqual([255, 6]);
    expect(config.dcs[0].url).toBe('wss://dc255.example.org/apiws');
    const jwk = publicKey.export({format: 'jwk'});
    expect(config.dcs[0].rsaKey).toEqual({
      modulus: Buffer.from(jwk.n, 'base64url').toString('hex'),
      exponent: '010001'
    });
  });

  it('supports IPv6 and nonstandard TLS ports', () => {
    const entry = dc();
    entry.endpoints = [{ip: '2001:db8::1', port: 8443, wsTlsOnly: true}];
    expect(parseBlahServerConfig({dcs: [entry]}).dcs[0].url).toBe('wss://[2001:db8::1]:8443/apiws');
  });

  it.each([0, -1, 256, 1.5, NaN, '2'])('rejects invalid DC id %s', (id) => {
    expect(() => parseBlahServerConfig({dcs: [{...dc(), id}]})).toThrow();
  });

  it('rejects empty, duplicate, keyless and non-TLS configurations', () => {
    for(const dcs of [
      [],
      [dc(), dc()],
      [{...dc(), rsaPublicKey: ''}],
      [{...dc(), endpoints: []}],
      [{...dc(), endpoints: [{ip: '192.0.2.1', port: 1521}]}]
    ]) {
      expect(() => parseBlahServerConfig({dcs})).toThrow();
    }
  });

  it.each(['host/path', 'host@evil.example', 'host?x=1', 'host#x', 'host\n'])('rejects endpoint injection: %s', (ip) => {
    expect(() => parseBlahServerConfig({dcs: [{...dc(), endpoints: [{ip, port: 443}]}]})).toThrow();
  });

  it('does not fetch C3 or override Telegram flags in an ordinary build', async() => {
    vi.stubEnv('VITE_BLAH', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await blahBuildDefines('test', process.cwd())).toEqual({
      __BLAH_CONFIG__: 'undefined'
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  function enableBlah() {
    vi.stubEnv('VITE_BLAH', '1');
    vi.stubEnv('BLAH_API_ID', '123');
    vi.stubEnv('BLAH_API_HASH', 'test-only-not-a-credential');
    vi.stubEnv('BLAH_SERVER_CONFIG_URL', 'https://c3.example.org/api/dcs');
    vi.stubEnv('BLAH_VAPID_PUBLIC_KEY', '');
  }

  it('requires explicit Blah credentials instead of the inherited Telegram ones', async() => {
    enableBlah();
    vi.stubEnv('BLAH_API_HASH', '');
    await expect(blahBuildDefines('test', process.cwd())).rejects.toThrow('BLAH_API_ID and BLAH_API_HASH');
  });

  it('fails closed on insecure C3 URLs and HTTP errors', async() => {
    enableBlah();
    vi.stubEnv('BLAH_SERVER_CONFIG_URL', 'http://c3.example.org/api/dcs');
    await expect(blahBuildDefines('test', process.cwd())).rejects.toThrow('HTTPS');
    vi.stubEnv('BLAH_SERVER_CONFIG_URL', 'https://c3.example.org/api/dcs');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: false, status: 503}));
    await expect(blahBuildDefines('test', process.cwd())).rejects.toThrow('HTTP 503');
  });

  it('embeds the topology and forces WS-only transport with no Telegram push key', async() => {
    enableBlah();
    const fetch = vi.fn().mockResolvedValue({ok: true, json: async() => ({dcs: [dc()]})});
    vi.stubGlobal('fetch', fetch);
    const defines = await blahBuildDefines('test', process.cwd());
    // C3 responses become trust anchors: never allow a redirect to downgrade HTTPS.
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({redirect: 'error'}));
    const value = (key: string) => JSON.parse(defines[`import.meta.env.${key}`]);
    expect(JSON.parse(defines.__BLAH_CONFIG__).defaultDcId).toBe(2);
    expect(value('VITE_API_ID')).toBe('123');
    expect(value('VITE_MTPROTO_HAS_WS')).toBe('1');
    for(const key of ['VITE_PUSH_SERVER_KEY', 'VITE_MTPROTO_HAS_HTTP', 'VITE_MTPROTO_AUTO', 'VITE_MTPROTO_HTTP', 'VITE_MTPROTO_HTTP_UPLOAD']) {
      expect(value(key)).toBe('');
    }
  });
});
