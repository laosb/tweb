import {readConfig, readToken, readWidgetLanguage, validateConfig, widgetBlahConfig, WIDGET_CONFIG_QUERY_PARAM, type WidgetConfig} from '@/widget/config';

export const config: WidgetConfig = {
  dcId: 1, url: 'wss://support.example/exact/path?route=widget',
  rsaKey: {modulus: 'ab'.repeat(256), exponent: '010001'},
  apiId: 12345, apiHash: 'ab'.repeat(16)
};

function setMeta(value: WidgetConfig) {
  document.head.innerHTML = Object.entries({
    'dc-id': value.dcId, 'dc-url': value.url, 'rsa-modulus': value.rsaKey.modulus,
    'rsa-exponent': value.rsaKey.exponent, 'api-id': value.apiId, 'api-hash': value.apiHash
  }).map(([name, item]) => `<meta name="blah-widget-${name}" content="${item}">`).join('');
}

it('reads the deployment pins from head meta tags and preserves the exact endpoint', () => {
  setMeta(config);
  expect(readConfig()).toEqual(config);
  expect(widgetBlahConfig()).toEqual({
    widget: {param: JSON.stringify(config)}, app: {id: config.apiId, hash: config.apiHash},
    defaultDcId: 1, dcs: [{id: 1, url: config.url, rsaKey: config.rsaKey}]
  });
  document.head.innerHTML = '';
  expect(() => readConfig()).toThrow();
  expect(widgetBlahConfig()).toEqual({widget: {}, defaultDcId: 1, dcs: []});
});

it('dials only the pinned DC and hands workers the same pins', async() => {
  setMeta(config);
  vi.resetModules();
  vi.stubGlobal('__BLAH_WIDGET__', true);
  const {default: blah, getBlahDc} = await import('@config/blah');
  const {makeWorkerURL} = await import('@helpers/setWorkerProxy');
  expect(getBlahDc(1).url).toBe(config.url);
  expect(() => getBlahDc(2)).toThrow('WIDGET_DC_MISMATCH');
  const url = makeWorkerURL(new URL('https://support.example/worker.js?' + WIDGET_CONFIG_QUERY_PARAM + '=forged'));
  expect(url.searchParams.get(WIDGET_CONFIG_QUERY_PARAM)).toBe(blah.widget.param);
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
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

it.each([
  ['?lang=zh-Hans', 'zh-hans'], ['?lang=PT_BR', 'pt-br'], ['?lang=en', 'en'],
  ['?lang=es-419', 'es-419'], ['?lang=abc-123-def', 'abc-123-def'],
  ['', undefined], ['?lang=', undefined], ['?lang=-en', undefined],
  ['?lang=en--us', undefined], ['?lang=en%20', undefined], ['?lang=en/x', undefined],
  ['?lang=en&lang=fr', undefined], ['?lang=%E0%A4%A', undefined]
])('parses the embedding page language %s', (search, expected) => {
  expect(readWidgetLanguage(search)).toBe(expected);
});

it('hands the authoritative normalized language to workers with the pins', () => {
  setMeta(config);
  history.replaceState(null, '', '?lang=ZH_HANT');
  try {
    const {widget} = widgetBlahConfig();
    expect(widget.lang).toBe('zh-hant');
    const workerConfig = validateConfig(JSON.parse(widget.param));
    expect(workerConfig.lang).toBe('zh-hant');
    expect(validateConfig({...workerConfig, lang: 'bad/lang'}).lang).toBeUndefined();
  } finally {
    history.replaceState(null, '', '/');
  }
});

it('reads the language from worker pins without a document', () => {
  const params = new URLSearchParams({[WIDGET_CONFIG_QUERY_PARAM]: JSON.stringify({...config, lang: 'PT_BR'}), lang: 'de'});
  history.replaceState(null, '', '?' + params);
  vi.stubGlobal('document', undefined);
  try {
    expect(widgetBlahConfig().widget.lang).toBe('pt-br');
  } finally {
    vi.unstubAllGlobals();
    history.replaceState(null, '', '/');
  }
});
