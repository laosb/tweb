import {readFileSync} from 'node:fs';
import blahBrandingPlugin, {brandBlahHtml, brandBlahManifest} from '../../scripts/blah-branding.mjs';

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
