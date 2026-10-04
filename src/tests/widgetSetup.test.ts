import {readFileSync} from 'node:fs';
import {readConfig} from '@/widget/config';
import {generateWidgetIndex, themeDeclarations} from '@/widget/setup';

const config = {
  dcId: 1, url: 'wss://support.example/exact/path?route=widget&other=%22quoted%22',
  rsaKey: {modulus: 'ab'.repeat(256), exponent: '010001'},
  apiId: 12345, apiHash: 'cd'.repeat(16)
};
const template = readFileSync('widget/index.html', 'utf8')
  .replace('../src/widget/index.tsx', './assets/widget-hash.js')
  .replace('</head>', '<link rel="stylesheet" href="./assets/widget-hash.css"></head>');

beforeEach(() => vi.stubGlobal('CSS', {supports: () => true}));
afterEach(() => vi.unstubAllGlobals());

it('generates a configured document without changing the compiled assets or runtime entry', () => {
  const result = generateWidgetIndex(template, config, {'bubble-radius': '8px', 'accent-color': '#235347'});
  const doc = new DOMParser().parseFromString(result, 'text/html');
  expect(result.startsWith('<!doctype html>')).toBe(true);
  expect(readConfig(doc)).toEqual(config);
  expect(doc.querySelector('script')?.getAttribute('src')).toBe('./assets/widget-hash.js');
  expect(doc.querySelector('link')?.getAttribute('href')).toBe('./assets/widget-hash.css');
  expect(doc.querySelector('#blah-widget-theme')?.textContent).toContain('--widget-bubble-radius: 8px;');
  expect(doc.querySelector('#blah-widget-theme')?.textContent).toContain('--widget-accent-color: #235347;');
  expect(doc.querySelectorAll('script')).toHaveLength(1);
  expect(doc.querySelector('#widget')).not.toBeNull();
});

it('reconfigures an existing generated index without keeping duplicate pins or old overrides', () => {
  const before = generateWidgetIndex(template, config, {'bubble-radius': '8px'});
  const next = {...config, apiId: 456, url: 'wss://other.example/apiws'};
  const after = generateWidgetIndex(before.replace('</head>', '<meta name="blah-widget-api-id" content="999"></head>'), next, {});
  const doc = new DOMParser().parseFromString(after, 'text/html');
  expect(readConfig(doc)).toEqual(next);
  expect(doc.querySelectorAll('meta[name="blah-widget-api-id"]')).toHaveLength(1);
  expect(doc.querySelectorAll('#blah-widget-theme')).toHaveLength(1);
  expect(after).not.toContain('--widget-bubble-radius');
});

it('rejects broken templates and invalid credentials', () => {
  expect(() => generateWidgetIndex('<html><body>Not found</body></html>', config, {})).toThrow('index.html');
  expect(() => generateWidgetIndex(template, {...config, apiHash: ''}, {})).toThrow();
});

it('rejects CSS that can escape the declaration or style element, even if accepted as a CSS value', () => {
  for(const value of ['red; color: blue', 'url("</style><script>alert(1)</script>")', 'red}body{color:red']) {
    expect(() => themeDeclarations({'accent-color': value})).toThrow();
  }
  vi.stubGlobal('CSS', {supports: () => false});
  expect(() => themeDeclarations({'bubble-radius': 'not-a-length'})).toThrow('radius');
  expect(themeDeclarations({'bubble-radius': '   '})).toBe('');
});
