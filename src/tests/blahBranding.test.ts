import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import path from 'node:path';
import blahBrandingPlugin, {brandBlahHtml, brandBlahManifest, brandBlahSource, brandBlahText} from '../../scripts/blah-branding.mjs';

const html = readFileSync('index.html', 'utf8').replace(/{{title}}/g, 'Telegram Web');
const parseHtml = (value: string) => new DOMParser().parseFromString(value, 'text/html');

it('brands the page title, metadata and every favicon without rewriting app code', () => {
  const branded = brandBlahHtml(html);
  const document = parseHtml(branded);
  expect(document.title).toBe('Blah');
  for(const selector of [
    '[name="application-name"]',
    '[name="mobile-web-app-title"]',
    '[name="apple-mobile-web-app-title"]',
    '[property="og:title"]',
    '[property="twitter:title"]'
  ]) {
    expect(document.querySelector(selector)?.getAttribute('content')).toBe('Blah');
  }
  expect(Array.from(document.querySelectorAll('link[rel="icon"], link[rel="alternate icon"], link[rel="apple-touch-icon"]'))
  .map((element) => element.getAttribute('href'))).toEqual([
    'assets/blah/icon-32.png',
    'assets/blah/logo.svg',
    'assets/blah/icon-512.png'
  ]);
  expect(document.querySelector('[property="og:image"]').getAttribute('content')).toBe('assets/blah/icon-512.png');
  expect(document.querySelector('script').outerHTML).toBe(parseHtml(html).querySelector('script').outerHTML);
  expect(brandBlahHtml(branded)).toBe(branded);
});

it.each(['site.webmanifest', 'site_apple.webmanifest'])('brands %s without mutating the upstream manifest or its identity', (file) => {
  const original = JSON.parse(readFileSync('public/' + file, 'utf8'));
  const branded = brandBlahManifest(original);
  expect(branded).toMatchObject({name: 'Blah', short_name: 'Blah', id: original.id, start_url: original.start_url});
  expect(branded.gcm_sender_id).toBeUndefined();
  expect(branded.icons).toEqual([192, 512].map((size) => ({
    src: `assets/blah/icon-${size}.png`,
    sizes: `${size}x${size}`,
    type: 'image/png'
  })));
  expect(original.name).toBe('Telegram Web');
  expect(original.gcm_sender_id).toBeDefined();
});

function plugin(enabled: boolean) {
  const result = blahBrandingPlugin(process.cwd()) as any;
  result.configResolved({define: {__BLAH_CONFIG__: enabled ? '{}' : 'undefined'}});
  return result;
}

it('leaves normal Telegram HTML and build output untouched', () => {
  const normal = plugin(false);
  expect(normal.transformIndexHtml.handler(html)).toBe(html);
  const emitFile = vi.fn();
  normal.generateBundle.call({emitFile});
  expect(emitFile).not.toHaveBeenCalled();
});

it('emits every referenced icon and branded manifest into dist', () => {
  const emitFile = vi.fn();
  const blah = plugin(true);
  blah.generateBundle.call({emitFile});
  const assets = new Map<string, Buffer | string>(emitFile.mock.calls.map(([asset]) => [asset.fileName, asset.source]));
  expect(assets.size).toBe(6);
  expect(assets.get('assets/blah/logo.svg')).toEqual(readFileSync('public/assets/blah/logo.svg'));
  for(const size of [32, 192, 512]) {
    const png = assets.get(`assets/blah/icon-${size}.png`) as Buffer;
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
  }
  expect(JSON.parse(assets.get('site.blah.webmanifest') as string).name).toBe('Blah');
  expect(assets.has('site.webmanifest')).toBe(false);
  expect(assets.has('site_apple.webmanifest')).toBe(false);
  expect(parseHtml(blah.transformIndexHtml.handler(html)).title).toBe('Blah');
});

it('serves branded manifests in development too, but only in Blah mode', () => {
  for(const enabled of [false, true]) {
    const use = vi.fn();
    plugin(enabled).configureServer({middlewares: {use}});
    const middleware = use.mock.calls[0][0];
    const res = {setHeader: vi.fn(), end: vi.fn()};
    const next = vi.fn();
    middleware({url: '/site_apple.blah.webmanifest?v=version'}, res, next);
    if(enabled) {
      expect(JSON.parse(res.end.mock.calls[0][0]).name).toBe('Blah');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/manifest+json');
      expect(next).not.toHaveBeenCalled();
    } else {
      expect(next).toHaveBeenCalledOnce();
      expect(res.end).not.toHaveBeenCalled();
    }
  }
});

it.each([
  ['Telegram WebK and Telegram Premium', 'Blah and Blah Beyond'],
  ['Telegram\u00a0Premium and Premium stickers', 'Blah Beyond and Beyond stickers'],
  ['Telegram\n\nPremium', 'Blah\n\nBeyond'],
  [String.raw`Telegram\nTelegram Premium`, String.raw`Blah\nBlah Beyond`],
  ['Telegram doesn\'t limit premium features.', 'Blah doesn\'t limit Beyond features.'],
  ['[Telegram Premium](https://example.org/(docs)/Telegram)', '[Blah Beyond](https://example.org/(docs)/Telegram)'],
  ['[Telegram](/Telegram) @Telegram https://telegram.org/Telegram', '[Blah](/Telegram) @Telegram https://telegram.org/Telegram'],
  ['TelegramPremium Telegram.Premium Telegram@example.org telegram.org tg://premium_offer', 'TelegramPremium Telegram.Premium Telegram@example.org telegram.org tg://premium_offer']
])('rebrands display text idempotently: %s', (text, expected) => {
  expect(brandBlahText(text)).toBe(expected);
  expect(brandBlahText(expected)).toBe(expected);
});

it.each(['src/lang.ts', 'src/langSign.ts'])('transforms only values in %s without writing source files', (filename) => {
  const source = readFileSync(filename, 'utf8');
  const branded = brandBlahSource(source, filename);
  const load = (code: string) => runInNewContext(code.replace('export default lang;', 'lang;'));
  const originalValues = load(source);
  const brandedValues = load(branded);
  expect(Object.keys(brandedValues)).toEqual(Object.keys(originalValues));
  for(const [key, value] of Object.entries(originalValues)) {
    expect(brandedValues[key]).toEqual(typeof(value) === 'string' ? brandBlahText(value) :
      Object.fromEntries(Object.entries(value).map(([form, text]) => [form, brandBlahText(text)])));
  }
  expect(brandedValues[filename === 'src/lang.ts' ? 'AppName' : 'Login.Title'])
  .toBe(filename === 'src/lang.ts' ? 'Blah' : 'Sign in to Blah');
  expect(brandBlahSource(branded, filename)).toBe(branded);
  expect(readFileSync(filename, 'utf8')).toBe(source);
});

it.each([
  ['src/lib/serviceWorker/push.ts', 'obj.title || \'Blah\''],
  ['src/lib/appManagers/appMessagesManager.ts', 'first_name: \'Blah\''],
  ['src/lib/appManagers/apiUpdatesManager.ts', '**Blah ${langStr}'],
  ['src/components/sidebarLeft/index.ts', 'Blah ${App.version}'],
  ['src/lib/appManagers/appEmojiManager.ts', 'title: \'Beyond\''],
  ['src/components/popupSandbox/stories/premium.ts', 'title: \'Blah Beyond\'']
])('brands the static labels in %s through the build hook', (filename, expected) => {
  const source = readFileSync(filename, 'utf8');
  const id = path.join(process.cwd(), filename);
  const branded = plugin(true).transform(source, id).code;
  expect(branded).toContain(expected);
  expect(brandBlahSource(branded, filename)).toBe(branded);
  expect(plugin(false).transform(source, id)).toBeUndefined();
  expect(readFileSync(filename, 'utf8')).toBe(source);
});

it('does not rewrite protocol code or emit duplicate metadata in worker builds', () => {
  const worker = blahBrandingPlugin(process.cwd()) as any;
  worker.configResolved({define: {__BLAH_CONFIG__: '{}'}, isWorker: true});
  const emitFile = vi.fn();
  worker.generateBundle.call({emitFile});
  expect(emitFile).not.toHaveBeenCalled();
  const protocol = 'contextSite = \'Telegram\'; flags = \'premium\';';
  expect(worker.transform(protocol, path.join(process.cwd(), 'src/lib/richTextProcessor/wrapRichText.ts'))).toBeUndefined();
  expect(worker.transform('title: \'Premium\'', path.join(process.cwd(), 'src/lib/appManagers/appEmojiManager.ts')).code)
  .toBe('title: \'Beyond\'');
});
