import {cp, readdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {defineConfig, mergeConfig} from 'vite';
import upstream from './vite.config';
// @ts-ignore no type declarations
import keepAsset from './keepAsset.js';

const outDir = resolve(__dirname, 'dist/widget');
// Runtime files the client fetches by path, as scripts/prepare-cloudflare-assets.mjs
// selects them, minus the changelogs, store pages and manifests a widget never shows.
const isRuntimePublic = (name: string, directory: boolean) => (directory || keepAsset(name)) &&
  !/\.(?:xml|webmanifest|html)$|^changelogs$/.test(name);
// Emoji render natively in the widget (src/widget/emoji.ts).
const WIDGET_OMITTED = ['assets/img/emoji'];

/**
 * The support widget is the full client in its widget mode (`--mode widget`, see
 * scripts/blah-config.mjs): widget/index.html carries the deployment pins and status
 * element, and the client's own markup is spliced in so upstream index.html stays the source.
 */
export default mergeConfig(upstream, defineConfig({
  mode: 'widget',
  root: resolve(__dirname, 'widget'),
  envDir: __dirname,
  plugins: [{
    name: 'widget-entries',
    // The e2e fixture also builds its support-side driver with this config, as a library.
    config: (config) => config.build?.lib ? {} : {build: {rolldownOptions: {input: {
      index: resolve(__dirname, 'widget/index.html'),
      setup: resolve(__dirname, 'widget/setup.html')
    }}}}
  }, {
    name: 'widget-client-markup',
    transformIndexHtml: {
      order: 'pre',
      handler(html, {filename}) {
        if(!filename.endsWith('/widget/index.html')) return html;
        const client = readFileSync(resolve(__dirname, 'index.html'), 'utf8');
        const body = /<body class="([^"]*)">([\s\S]*)<\/body>/.exec(client);
        if(!body) throw new Error('index.html changed shape: no <body class> to embed in the widget');
        return html
        .replace('<body>', `<body class="${body[1]}">`)
        .replace('<!-- blah-widget-client -->', body[2].replace('src="src/', 'src="../src/'));
      }
    }
  }, {
    name: 'widget-title',
    // After Blah branding, which renames the document.
    transformIndexHtml: {order: 'post', handler: (html, {filename}) => filename.endsWith('/widget/index.html') ?
      html.replace(/<title>[^<]*<\/title>/, '<title>Support</title>') : html}
  }, {
    name: 'widget-public-assets',
    apply: (config) => !config.build?.lib,
    async closeBundle() {
      const publicDir = resolve(__dirname, 'public');
      for(const entry of await readdir(publicDir, {withFileTypes: true})) {
        if(isRuntimePublic(entry.name, entry.isDirectory())) {
          await cp(resolve(publicDir, entry.name), resolve(outDir, entry.name), {recursive: true,
            filter: (source) => !WIDGET_OMITTED.some((path) => source.startsWith(resolve(publicDir, path)))});
        }
      }
    }
  }],
  // An array, so mergeConfig puts these ahead of the upstream @config and @environment prefixes.
  resolve: {alias: [
    {find: '@config/modes', replacement: resolve(__dirname, 'src/widget/modes.ts')},
    {find: '@environment/emojiSupport', replacement: resolve(__dirname, 'src/widget/emojiSupport.ts')},
    {find: '@environment/emojiVersionsSupport', replacement: resolve(__dirname, 'src/widget/emojiVersionsSupport.ts')}
  ]},
  server: {fs: {allow: [__dirname]}},
  optimizeDeps: {entries: ['index.html', '../src/**/*.worker.{ts,js}']},
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: false
  },
  test: {root: __dirname, include: ['src/tests/widget*.test.ts']}
}));
