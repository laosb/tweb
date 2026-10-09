import {cp, readdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {relative, resolve} from 'node:path';
import {defineConfig, mergeConfig} from 'vite';
import upstream from './vite.config';
// @ts-ignore no type declarations
import keepAsset from './keepAsset.js';

const outDir = resolve(__dirname, 'dist/widget');
// Runtime files the client fetches by path, as scripts/prepare-cloudflare-assets.mjs
// selects them, minus the changelogs, store pages and manifests a widget never shows.
const isRuntimePublic = (name: string, directory: boolean) => (directory || keepAsset(name)) &&
  !/\.(?:xml|webmanifest|html)$|^changelogs$/.test(name);
// Public files only for what the widget leaves out: emoji images (it renders emoji natively),
// calls, voice recording, Stars, payments, settings, sign-in, Instant View, the media
// editor's fallbacks and the installable app's icons.
const WIDGET_OMITTED_PUBLIC = [
  /^assets\/img\/emoji(\/|$)/,
  /^assets\/audio\/(?!message_sent|notification)/,
  /^assets\/tgs\/(?!ReactionGeneric)/,
  /^assets\/fonts\/(tgico\.(svg|woff)|Merriweather-|Roboto-Medium\.)/, // tgico.ttf is listed first
  /^assets\/img\/(android-chrome|mstile|favicon-|favicon_unread|icon_square|safari-pinned|logo_512|screenshot|camomile|password-monkey|premium|stars|anon_paid|amex|card|diners|discover|jcb|mastercard|mir|unionpay|visa|EmptyChats|accounts-limit|add-chats-to-folder|android-device)/,
  /^(encoderWorker\.min\.|recorder\.min\.js)/
];

// Modules whose features the widget does without, replaced by src/widget/omitted so their
// code, workers and libraries stay out of the release.
const omitted = (name: string) => resolve(__dirname, 'src/widget/omitted', name);
const WIDGET_REPLACED: Record<string, string> = {
  'src/vendor/prism.ts': omitted('prism.ts'),
  'src/codeLanguageDetector.ts': omitted('codeLanguageDetector.ts'),
  'src/lib/tinyld/detect.ts': omitted('languageDetector.ts'),
  'src/components/chat/bubbleParts/pollMessageContent/index.ts': omitted('poll.ts'),
  'src/lib/calls/e2e/encryptWorkerHost.ts': omitted('groupCallEncryption.ts')
};
// Screens a customer cannot open in the widget: lazy imports of these build as empty modules.
const WIDGET_UNREACHABLE = [
  /^src\/pages\/cards\//, // sign-in: the URL's token is the only credential
  /^src\/components\/sidebarLeft\/tabs\/(?!background\.)/, // settings and the hidden chat list
  /^src\/components\/sidebarRight\/tabs\/(?!sharedMedia\.|boosts\.)/, // the profile column is hidden
  /^src\/components\/communities\//,
  /^src\/components\/popups\/(createPoll|aiEditorPopup)\//,
  /^src\/components\/call\//,
  /^src\/lib\/tchart\//, // statistics
  /^src\/lib\/settingsSearch\//,
  /^src\/vendor\/recorder\.min\.js$/, // voice messages
  /\/qr-code-styling\//, // QR sign-in and profile links
  /\/hls\.js\// // adaptive video: Blah sends no alternative qualities
];
const UNREACHABLE = '\0widget-unreachable';
const omittedLazily = new Set<string>();
const isUnreachable = (id: string) => WIDGET_UNREACHABLE.some((pattern) => pattern.test(relative(__dirname, id)));

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
    name: 'widget-omitted-modules',
    enforce: 'pre',
    apply: (config) => !config.build?.lib,
    async resolveId(source, importer, options) {
      if(options.kind !== 'dynamic-import' || !importer) return;
      const resolved = await this.resolve(source, importer, {kind: 'dynamic-import', skipSelf: true});
      if(resolved && isUnreachable(resolved.id)) {
        omittedLazily.add(resolved.id);
        return UNREACHABLE;
      }
    },
    load(id) {
      if(id === UNREACHABLE) return 'export default undefined;';
      const path = relative(__dirname, id.split('?')[0]);
      if(WIDGET_REPLACED[path]) return readFileSync(WIDGET_REPLACED[path], 'utf8');
    },
    buildEnd() {
      // A rename upstream must not silently ship a feature again, nor empty a module in use.
      const ids = new Set(this.getModuleIds());
      const missing = Object.keys(WIDGET_REPLACED).filter((path) => !ids.has(resolve(__dirname, path)));
      if(missing.length) this.error('no longer in the build: ' + missing.join(', '));
      const eager = [...omittedLazily].filter((id) => ids.has(id)).map((id) => relative(__dirname, id));
      if(eager.length) this.error('omitted lazily but also imported eagerly: ' + eager.join(', '));
    }
  }, {
    name: 'widget-public-assets',
    apply: (config) => !config.build?.lib,
    async closeBundle() {
      const publicDir = resolve(__dirname, 'public');
      for(const entry of await readdir(publicDir, {withFileTypes: true})) {
        if(isRuntimePublic(entry.name, entry.isDirectory())) {
          await cp(resolve(publicDir, entry.name), resolve(outDir, entry.name), {recursive: true,
            filter: (source) => !WIDGET_OMITTED_PUBLIC.some((pattern) => pattern.test(relative(publicDir, source)))});
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
