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
// webfonts (it uses the system's), calls, voice recording, Stars, payments, settings,
// sign-in and the installable app's icons.
const WIDGET_OMITTED_PUBLIC = [
  /^assets\/img\/emoji(\/|$)/,
  /^assets\/audio\/(?!message_sent|notification)/,
  /^assets\/tgs\/(?!ReactionGeneric)/,
  /^assets\/fonts\/(?!tgico\.ttf$)/, // the icon font, whose first source is the .ttf
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
  'src/lib/calls/callsController.ts': omitted('callsController.ts'),
  'src/lib/calls/groupCallsController.ts': omitted('callsController.ts'),
  'src/lib/calls/conferenceInvitesController.ts': omitted('callsController.ts'),
  'src/lib/calls/rtmpCallsController.ts': omitted('callsController.ts'),
  'src/components/topbarCall.tsx': omitted('topbarCall.ts')
};
// Entry points of features a support chat has no use for: stories, calls, mini apps and the
// in-app browser, payments, Stars, Premium, boosts and the AI editor. Each builds with every
// export a function that does nothing, which leaves the rest of the feature out.
const WIDGET_INERT = [
  'src/components/stories/viewer.tsx',
  'src/components/stories/list.tsx',
  'src/components/stories/preview.tsx',
  'src/components/call/index.tsx',
  'src/components/call/conferenceJoinPopup.tsx',
  'src/components/popups/webApp.tsx',
  'src/components/browser.tsx',
  'src/components/popups/payment.tsx',
  'src/components/popups/stars.tsx',
  'src/components/popups/premium.tsx',
  'src/components/popups/boost.tsx',
  'src/components/openBoosts.ts',
  'src/components/richMessageInput/ai.tsx',
  'src/components/richMessageInput/aiButton.tsx'
];
/** The runtime names a module exports, from its source. */
function exportNames(program: any) {
  return program.body.flatMap((node: any): string[] => {
    if(node.type === 'ExportDefaultDeclaration') return ['default'];
    if(node.type === 'ExportAllDeclaration') throw new Error('cannot make export * inert');
    if(node.type !== 'ExportNamedDeclaration' || node.exportKind === 'type') return [];
    const declaration = node.declaration;
    if(declaration?.declare || /^TS(Interface|TypeAlias)/.test(declaration?.type)) return [];
    if(declaration?.type === 'VariableDeclaration') return declaration.declarations.map((item: any) => item.id.name);
    if(declaration) return [declaration.id.name];
    return node.specifiers.filter((item: any) => item.exportKind !== 'type').map((item: any) => item.exported.name);
  });
}
// Screens a customer cannot open in the widget: lazy imports of these build as empty modules.
const WIDGET_UNREACHABLE = [
  /^src\/pages\/cards\//, // sign-in: the URL's token is the only credential
  /^src\/components\/sidebarLeft\/tabs\/(?!background\.)/, // settings and the hidden chat list
  /^src\/components\/sidebarRight\/tabs\/(?!sharedMedia\.|boosts\.)/, // the profile column is hidden
  /^src\/components\/communities\//,
  /^src\/components\/popups\/(createPoll|aiEditorPopup)\//,
  /^src\/components\/call\/(?!index\.|conferenceJoinPopup\.)/,
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
      if(WIDGET_INERT.includes(path)) {
        const names = exportNames(this.parse(readFileSync(id, 'utf8'), {lang: path.endsWith('x') ? 'tsx' : 'ts'}));
        return 'const inert = function() {};\nexport {' + names.map((name: string) => 'inert as ' + name).join(', ') + '};';
      }
    },
    buildEnd() {
      // A rename upstream must not silently ship a feature again, nor empty a module in use.
      const ids = new Set(this.getModuleIds());
      const missing = [...Object.keys(WIDGET_REPLACED), ...WIDGET_INERT].filter((path) => !ids.has(resolve(__dirname, path)));
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
  css: {postcss: {plugins: [{
    // System fonts only, like emoji; a host adds a webfont in its index.html (docs/widget.md).
    postcssPlugin: 'widget-system-fonts',
    AtRule: {'font-face': (rule) => {
      if(!/font-family:\s*["']?tgico\b/.test(rule.toString())) rule.remove();
    }}
  }]}},
  server: {fs: {allow: [__dirname]}},
  optimizeDeps: {entries: ['index.html', '../src/**/*.worker.{ts,js}']},
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: false
  },
  test: {root: __dirname, include: ['src/tests/widget*.test.ts']}
}));
