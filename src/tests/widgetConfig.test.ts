import {readConfig, readToken, validateConfig, type WidgetConfig} from '@/widget/config';
import {configureTransport, getBlahDc} from '@/widget/transportConfig';

export const config: WidgetConfig = {
  dcId: 1, url: 'wss://support.example/exact/path?route=widget',
  rsaKey: {modulus: 'ab'.repeat(256), exponent: '010001'},
  apiId: 12345, apiHash: 'ab'.repeat(16)
};

it('reads the deployment pins from head meta tags and preserves the exact endpoint', () => {
  document.head.innerHTML = Object.entries({
    'dc-id': config.dcId, 'dc-url': config.url, 'rsa-modulus': config.rsaKey.modulus,
    'rsa-exponent': config.rsaKey.exponent, 'api-id': config.apiId, 'api-hash': config.apiHash
  }).map(([name, value]) => `<meta name="blah-widget-${name}" content="${value}">`).join('');
  expect(readConfig()).toEqual(config);
  configureTransport(readConfig());
  expect(getBlahDc(1).url).toBe(config.url);
  expect(getBlahDc(1).rsaKey).toEqual(config.rsaKey);
  expect(() => getBlahDc(2)).toThrow('WIDGET_DC_MISMATCH');
  document.head.innerHTML = '';
  expect(() => readConfig()).toThrow();
});

it.each([
  {...config, url: 'ws://support.example/apiws'},
  {...config, url: 'wss://user:password@support.example/apiws'},
  {...config, url: 'wss://support.example/apiws#other'},
  {...config, dcId: 0}, {...config, dcId: 256},
  {...config, rsaKey: {...config.rsaKey, modulus: 'aa'}},
  {...config, rsaKey: {...config.rsaKey, exponent: '02'}},
  {...config, apiId: 0}, {...config, apiHash: ''}
])('refuses invalid configuration without a default DC', (value) => {
  expect(() => validateConfig(value)).toThrow();
});

it('requires one unambiguous, well-formed token in the fragment', () => {
  const token = '123:abcdefghijklmnopqrstuvwxyz_0123456789';
  expect(readToken('#token=' + encodeURIComponent(token))).toBe(token);
  for(const hash of ['', '#', '#token=', '#token=x', '#token=' + token + '&token=' + token, '#token=%E0%A4%A']) {
    expect(readToken(hash)).toBeUndefined();
  }
});
