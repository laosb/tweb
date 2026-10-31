import {cp, readdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {relative, resolve} from 'node:path';
import {defineConfig, mergeConfig} from 'vite';
import upstream from './vite.config';
import widgetBuildRevision from './scripts/widget-build-revision';
import widgetLanguage from './scripts/widget-language';
import widgetBranches from './scripts/widget-branches';
import {widgetThemeDeclaration, widgetCssSelector} from './scripts/widget-theme-css';
import {assertWidgetCleanupAssets, assertWidgetCleanupModules} from './scripts/widget-cleanup-guards';
// @ts-ignore no type declarations
import keepAsset from './keepAsset.js';

const outDir = resolve(__dirname, 'dist/widget');
// Runtime files the client fetches by path, as scripts/prepare-cloudflare-assets.mjs
// selects them, minus the changelogs, store pages and manifests a widget never shows.
const isRuntimePublic = (name: string, directory: boolean) => (directory || keepAsset(name)) &&
  !/\.(?:xml|webmanifest|html)$|^changelogs$/.test(name);
// Public files only for what the widget leaves out: emoji images (it renders emoji natively),
// webfonts (it uses the system's), wallpapers, calls, voice recording, Stars, payments, settings,
// sign-in, notifications, QR codes and the installable app's icons.
const WIDGET_OMITTED_PUBLIC = [
  /^assets\/img\/emoji(\/|$)/,
  /^assets\/audio\/(?!message_sent|notification)/,
  /^assets\/tgs\/(?!ReactionGeneric)/,
  /^assets\/fonts\/(?!tgico\.ttf$)/, // the icon font, whose first source is the .ttf
  /^assets\/blah(\/|$)/,
  /^assets\/img\/(blank\.gif|doc-in|icon-verified|logo|masked|monoforum|favicon|apple-touch-icon-precomposed|pattern|bg\.|android-chrome|mstile|favicon-|favicon_unread|icon_square|safari-pinned|logo_512|screenshot|camomile|password-monkey|premium|stars|anon_paid|amex|card|diners|discover|jcb|mastercard|mir|unionpay|visa|accounts-limit|add-chats-to-folder|android-device|EmptyChats\.svg|chat-thread-separator-dash)/,
  /^(encoderWorker\.min\.|recorder\.min\.js)/
];

// Modules whose features the widget does without, replaced by src/widget/omitted so their
// code, workers and libraries stay out of the release.
const omitted = (name: string) => resolve(__dirname, 'src/widget/omitted', name);
const WIDGET_REPLACED: Record<string, string> = {
  // Authentication and credentials.
  'src/components/monkeys/password.ts': omitted('passwordMonkey.ts'),
  'src/components/passcodeLock/passcodeLockScreenController.tsx': omitted('lockScreen.ts'),
  'src/components/passwordInputField.ts': omitted('password.ts'),
  'src/lib/appManagers/utils/useLockScreenShortcut.ts': omitted('lockScreenShortcut.ts'),
  'src/pages/mountAuthFlow.tsx': omitted('authFlow.ts'),
  // Calls and streaming.
  'src/components/topbarCall.tsx': omitted('topbarCall.ts'),
  'src/lib/calls/callsController.ts': omitted('callsController.ts'),
  'src/lib/calls/conferenceInvitesController.ts': omitted('callsController.ts'),
  'src/lib/calls/groupCallsController.ts': omitted('callsController.ts'),
  'src/lib/calls/rtmpCallsController.ts': omitted('callsController.ts'),
  // Composer and recipients.
  'src/components/chat/botCommands.ts': omitted('botCommands.ts'),
  'src/components/chat/commandsHelper.ts': omitted('commandsHelper.ts'),
  'src/components/chat/emojiHelper.ts': omitted('autocompleteHelper.ts'),
  'src/components/chat/inlineHelper.ts': omitted('autocompleteHelper.ts'),
  'src/components/chat/mentionsHelper.ts': omitted('mentionsHelper.ts'),
  'src/components/chat/sendAs.ts': omitted('sendAs.ts'),
  'src/components/chat/stickersHelper.ts': omitted('autocompleteHelper.ts'),
  'src/components/popups/pickUser.tsx': omitted('pickUser.ts'),
  'src/components/popups/requestPeer.ts': omitted('requestPeer.ts'),
  'src/components/wrappers/keyboardButton.ts': omitted('keyboardButton.ts'),
  'src/helpers/addAnchorListener.ts': omitted('anchorListener.ts'),
  'src/lib/richTextProcessor/wrapUrl.ts': omitted('wrapUrl.ts'),
  // Diagnostics.
  'src/lib/debug/logsBuffer.ts': omitted('logsBuffer.ts'),
  'src/lib/debug/memoryReport.ts': omitted('memoryReport.ts'),
  'src/lib/debug/memoryStats.ts': omitted('memoryStats.ts'),
  'src/lib/debug/memoryWatch.ts': omitted('memoryWatch.ts'),
  // Emoji and sticker pickers.
  'src/components/emojiDropdownButton.ts': omitted('emojiDropdownButton.ts'),
  'src/components/emoticonsDropdown/index.ts': omitted('emoticonsDropdown.ts'),
  'src/components/emoticonsDropdown/tabs/emoji.ts': omitted('emojiTab.ts'),
  // Media and recording.
  'src/components/chat/audio.tsx': omitted('chatAudio.ts'),
  'src/components/chat/recording/chatRecording.ts': omitted('recording.ts'),
  'src/helpers/math/loadTemml.ts': omitted('loadTemml.ts'),
  'src/helpers/voiceRecorder/isNativeSupported.ts': omitted('recordingSupported.ts'),
  // Message actions and received content.
  'src/components/chat/bubbleParts/paidServiceMessage.ts': omitted('paidServiceMessage.ts'),
  'src/components/chat/bubbleParts/pollMessageContent/index.ts': omitted('poll.ts'),
  'src/components/chat/bubbles/noForwardsRequest.tsx': omitted('receivedContent.ts'),
  'src/components/chat/bubbles/premiumGift.tsx': omitted('receivedContent.ts'),
  'src/components/chat/bubbles/starGift.tsx': omitted('receivedContent.ts'),
  'src/components/chat/bubbles/starGiftOffer.tsx': omitted('receivedContent.ts'),
  'src/components/chat/bubbles/suggestBirthday.tsx': omitted('receivedContent.ts'),
  'src/components/chat/giveaway.tsx': omitted('receivedContent.ts'),
  'src/components/chat/selection.ts': omitted('selection.ts'),
  'src/components/chat/topbarSearch.tsx': omitted('messageAction.ts'),
  'src/components/popups/birthday.tsx': omitted('birthday.ts'),
  'src/components/popups/contactDetails.tsx': omitted('messageAction.ts'),
  'src/components/popups/forward.tsx': omitted('messageAction.ts'),
  'src/components/popups/toggleReadDate.tsx': omitted('readDate.ts'),
  'src/components/popups/unpinMessage.ts': omitted('messageAction.ts'),
  'src/components/wrappers/callBubble.ts': omitted('callBubble.ts'),
  'src/components/wrappers/geo.ts': omitted('geo.ts'),
  'src/components/wrappers/messageActionTextNew.ts': omitted('messageActionText.ts'),
  'src/components/wrappers/messageForReply.ts': omitted('messageForReply.ts'),
  'src/components/wrappers/webPage.tsx': omitted('receivedContent.ts'),
  'src/helpers/parseVcard.ts': omitted('vcard.ts'),
  // Navigation, settings and profiles.
  'src/components/autonomousDialogList/monoforumThreads.ts': omitted('monoforumList.ts'),
  'src/components/chat/bubbles/chatBackground.tsx': omitted('chatBackground.ts'),
  'src/components/chat/bubbles/unknownUser.tsx': omitted('unknownUser.ts'),
  'src/components/chat/topbar.ts': omitted('topbar.ts'),
  'src/components/dialogsPinnedReorder.ts': omitted('dialogsPinnedReorder.ts'),
  'src/components/folderTags/dialogFolderTags.tsx': omitted('dialogFolderTags.ts'),
  'src/components/peerProfileAvatars.ts': omitted('profileAvatars.ts'),
  'src/components/popups/addBotToChat.ts': omitted('profilePopup.ts'),
  'src/components/popups/deleteMegagroupMessages.tsx': omitted('adminPopup.ts'),
  'src/components/popups/joinChatInvite.tsx': omitted('profilePopup.ts'),
  'src/components/popups/myQrCode.tsx': omitted('profilePopup.ts'),
  'src/components/popups/peerProfile.tsx': omitted('profilePopup.ts'),
  'src/components/popups/sharedFolderInvite.tsx': omitted('profilePopup.ts'),
  'src/components/popups/starsRating.tsx': omitted('profilePopup.ts'),
  'src/components/sidebarLeft/index.ts': omitted('sidebarLeft.ts'),
  'src/components/sidebarLeft/tabs/background.tsx': omitted('backgroundTab.ts'),
  'src/components/sidebarRight/index.ts': omitted('sidebarRight.ts'),
  'src/components/sidebarRight/tabs/pollResults.tsx': omitted('tab.ts'),
  'src/components/sidebarRight/tabs/savedMusic.tsx': omitted('tab.ts'),
  'src/components/sidebarRight/tabs/sharedMediaTab.tsx': omitted('sharedMedia.ts'),
  'src/components/sidebarRight/tabs/statistics.tsx': omitted('tab.ts'),
  'src/components/solidJsTabs/index.ts': omitted('tabRegistry.ts'),
  'src/components/solidJsTabs/tabs.ts': omitted('tabs.ts'),
  'src/components/stories/store.tsx': omitted('stories.ts'),
  'src/lib/appDialogsManager.ts': omitted('dialogs.ts'),
  // Payments and gifts.
  'src/components/chat/paidMessagesInterceptor.ts': omitted('paidMessagesInterceptor.ts'),
  'src/components/chat/priceChangedInterceptor/index.ts': omitted('priceChangedInterceptor.ts'),
  'src/components/chat/undoablePaidTooltip.tsx': omitted('undoablePaidTooltip.ts'),
  'src/components/popups/giftLink.tsx': omitted('giftPopup.ts'),
  'src/components/popups/sendGiftPicker.ts': omitted('giftPopup.ts'),
  'src/components/popups/starGiftInfo.tsx': omitted('giftPopup.ts'),
  'src/helpers/paymentsWrapCurrencyAmount.ts': omitted('currencyAmount.ts'),
  // Syntax and language detection.
  'src/codeLanguageDetector.ts': omitted('codeLanguageDetector.ts'),
  'src/lib/tinyld/detect.ts': omitted('languageDetector.ts'),
  'src/vendor/prism.ts': omitted('prism.ts')
};
// Entry points of features a support chat has no use for: stories, calls, mini apps and the
// in-app browser, payments, Stars, Premium, boosts and the AI editor. Each builds with every
// export a function that does nothing, which leaves the rest of the feature out.
const WIDGET_INERT = [
  // AI editor.
  'src/components/richMessageInput/ai.tsx',
  'src/components/richMessageInput/aiButton.tsx',
  // Calls and streaming.
  'src/components/call/conferenceJoinPopup.tsx',
  'src/components/call/index.tsx',
  'src/components/mediaViewer/rtmp.ts',
  'src/lib/calls/noiseSuppression/noiseSuppression.ts',
  // Diagnostics.
  'src/lib/debug/mountLogExport.ts',
  // Emoji and sticker pickers.
  'src/components/emoticonsDropdown/search.tsx',
  'src/components/emoticonsDropdown/tabs/SuperStickerRenderer.ts',
  'src/components/mediaEditor/tabs/stickersTab.tsx',
  'src/components/popups/createPoll/stickersDropdown.ts',
  'src/components/popups/stickers.tsx',
  'src/components/sidebarLeft/emojiStatusPicker.tsx',
  // Message actions and received content.
  'src/components/chat/bubbleParts/dice.ts',
  'src/components/chat/bubbleParts/updateChatThreadSeparators.ts',
  'src/components/quizHint.ts',
  // Navigation, settings and profiles.
  'src/components/businessHours.tsx',
  'src/components/chat/similarChannels.tsx',
  'src/components/chat/translation.tsx',
  'src/components/chatTips/index.tsx',
  'src/components/communities/communityLinkSection.tsx',
  'src/components/popups/createBot/index.tsx',
  'src/components/popups/createContact.tsx',
  'src/components/popups/editMemberTag.tsx',
  'src/components/popups/memberTagInfo.tsx',
  'src/components/sidebarLeft/tabs/createNewGroupTab.ts',
  // Payments and gifts.
  'src/components/popups/boost.tsx',
  'src/components/popups/giftPremium.tsx',
  'src/components/popups/makePaid.tsx',
  'src/components/popups/payment.tsx',
  'src/components/popups/premium.tsx',
  'src/components/popups/sendGift.tsx',
  'src/components/popups/starReaction.tsx',
  'src/components/popups/stars.tsx',
  'src/components/stars/starsAmount.tsx',
  // Stories.
  'src/components/stories/preview.tsx',
  'src/components/stories/viewer.tsx',
  // Web apps and browser.
  'src/components/browser.tsx',
  'src/components/popups/webApp.tsx'
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
  // Authentication and credentials.
  /^src\/pages\/cards\//, // the URL token is the only credential
  /\/qr-code-styling\//,
  // Calls and streaming.
  /^src\/components\/call\/(?!index\.|conferenceJoinPopup\.)/,
  /^src\/components\/groupCall\//,
  /\/hls\.js\//, // Blah sends no alternative qualities
  // Diagnostics and in-page workers.
  /^src\/lib\/debug\//,
  /^src\/lib\/(mainWorker\/index|crypto\/crypto)\.worker\.ts$/,
  // Message actions and received content.
  /^src\/components\/avatarEdit\./, // excluded suggested-profile-photo service action
  /^src\/components\/chat\/bubbleParts\/(adminLogsResolver\/|suggestedPost)/,
  /^src\/components\/chat\/(logFiltersPopup|suggestPostPopup)\//,
  /^src\/components\/popups\/(createPoll|aiEditorPopup|translate)\//,
  // Navigation, settings and profiles.
  /^src\/components\/(communities|forumTab|addToFolderDropdownMenu|passcodeLock|iconLibrary)\//,
  /^src\/components\/popups\/(ageVerification|musicSearch|richButton)\./,
  /^src\/components\/popups\/(channelsTooMuch|emailSetup|passkey|deleteDialog|mute)\./,
  /^src\/components\/sidebarLeft\/tabs\/(?!background\.)/, // settings and the hidden chat list
  /^src\/components\/sidebarRight\/tabs\/(?!sharedMedia(?:Tab)?\.|boosts\.)/, // the profile column is hidden
  /^src\/lib\/blah\/Identity(Details)?Settings\./, // the Blah identity's settings
  /^src\/lib\/settingsSearch\//,
  /^src\/lib\/tchart\//,
  // Recording.
  /^src\/vendor\/recorder\.min\.js$/
];
const UNREACHABLE = '\0widget-unreachable';
const omittedLazily = new Set<string>();
const isUnreachable = (id: string) => WIDGET_UNREACHABLE.some((pattern) => pattern.test(relative(__dirname, id)));

// Few files: the client builds as one chunk, apart from the media editor (loaded when a
// customer edits a photo) and what the setup page shares with it; each worker is one file.
const MEDIA_EDITOR = /\/src\/components\/mediaEditor\/|\/mediabunny\//;
const SETUP_ONLY = /\/src\/widget\/(setup|preview)|\.html$/;
type ChunkingContext = {getModuleInfo(id: string): {importedIds: readonly string[], dynamicallyImportedIds: readonly string[]} | null};
/** Modules `from` loads, following lazy imports except those into `lazyChunk`. */
function reachable(from: string, context: ChunkingContext, lazyChunk?: RegExp) {
  const modules = new Set<string>();
  const queue = [resolve(__dirname, from)];
  for(let module; (module = queue.pop());) {
    if(modules.has(module)) continue;
    modules.add(module);
    const info = context.getModuleInfo(module);
    if(info) queue.push(...info.importedIds, ...info.dynamicallyImportedIds.filter((id) => !lazyChunk?.test(id)));
  }
  return modules;
}
let setupModules: Set<string>, clientModules: Set<string>, allModules: Set<string>;
function chunkName(id: string, context: ChunkingContext) {
  setupModules ??= reachable('widget/setup.html', context);
  clientModules ??= reachable('widget/index.html', context, MEDIA_EDITOR);
  allModules ??= reachable('widget/index.html', context);
  if(setupModules.has(id)) return SETUP_ONLY.test(id) ? null : 'shared';
  if(clientModules.has(id)) return /\.html$/.test(id) ? null : 'client';
  return allModules.has(id) ? 'media-editor' : null;
}

const workerModulePaths = new Set<string>();
function widgetOmittedModules(requireTargets = true): import('vite').Plugin {
  return {
    name: 'widget-omitted-modules',
    enforce: 'pre',
    apply: (config) => !config.build?.lib,
    buildStart() {
      if(requireTargets) workerModulePaths.clear();
    },
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
      // A widget wrapper may delegate to the unchanged upstream implementation.
      if(id.endsWith('?widget-original')) return;
      const path = relative(__dirname, id.split('?')[0]);
      if(WIDGET_REPLACED[path]) return readFileSync(WIDGET_REPLACED[path], 'utf8');
      if(WIDGET_INERT.includes(path)) {
        const names = exportNames(this.parse(readFileSync(id, 'utf8'), {lang: path.endsWith('x') ? 'tsx' : 'ts'}));
        return 'const inert = function() {};\nexport {' + names.map((name: string) => 'inert as ' + name).join(', ') + '};';
      }
    },
    buildEnd(error) {
      if(error) return;
      // A rename upstream must not silently ship a feature again, nor empty a module in use.
      const ids = new Set(this.getModuleIds());
      const pickerModules = [...ids].map((id) => relative(__dirname, id)).filter((path) =>
        path.startsWith('src/components/emoticonsDropdown/') &&
        path !== 'src/components/emoticonsDropdown/constants.ts' &&
        !WIDGET_REPLACED[path] && !WIDGET_INERT.includes(path));
      if(pickerModules.length) this.error('widget picker code is reachable: ' + pickerModules.join(', '));
      const paths = [...ids].map((id) => relative(__dirname, id));
      assertWidgetCleanupModules(paths, [...Object.keys(WIDGET_REPLACED), ...WIDGET_INERT]);
      if(!requireTargets) {
        for(const path of paths) workerModulePaths.add(path);
        return;
      }
      const missing = [...Object.keys(WIDGET_REPLACED), ...WIDGET_INERT].filter((path) => !ids.has(resolve(__dirname, path)) && !workerModulePaths.has(path));
      if(missing.length) this.error('no longer in the build: ' + missing.join(', '));
      const eager = [...omittedLazily].filter((id) => ids.has(id)).map((id) => relative(__dirname, id));
      if(eager.length) this.error('omitted lazily but also imported eagerly: ' + eager.join(', '));
    },
    generateBundle(_, bundle) {
      assertWidgetCleanupAssets(Object.values(bundle).flatMap((item: any) => [item.fileName, ...(item.originalFileNames || [])]));
    }
  };
}

/**
 * The support widget is the full client in its widget mode (`--mode widget`, see
 * scripts/blah-config.mjs): widget/index.html carries the deployment pins and status
 * element, and the client's own markup is spliced in so upstream index.html stays the source.
 */
export default mergeConfig(upstream, defineConfig({
  mode: 'widget',
  root: resolve(__dirname, 'widget'),
  envDir: __dirname,
  plugins: [widgetBuildRevision(__dirname), {
    name: 'widget-entries',
    // The e2e fixture also builds its support-side driver with this config, as a library.
    config: (config) => config.build?.lib ? {} : {build: {rolldownOptions: {
      input: {index: resolve(__dirname, 'widget/index.html'), setup: resolve(__dirname, 'widget/setup.html')},
      output: {codeSplitting: {groups: [{name: chunkName, includeDependenciesRecursively: false}]}}
    }}}
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
      html.replace(/<title>[^<]*<\/title>/, '<title>Support</title>')
      .replace(/<link\b[^>]*rel="(?:icon|apple-touch-icon)"[^>]*>\s*/g, '') : html}
  }, {
    name: 'widget-no-app-install',
    // An embedded chat has no tab icon and is not installable: drop Blah branding's icons and manifests.
    generateBundle: {order: 'post', handler(_, bundle) {
      for(const fileName of Object.keys(bundle)) {
        if(/^assets\/blah\/|\.webmanifest$/.test(fileName)) delete bundle[fileName];
      }
    }}
  }, widgetOmittedModules(), widgetBranches(), widgetLanguage(__dirname), {
    name: 'widget-public-assets',
    apply: (config) => !config.build?.lib,
    async writeBundle() {
      const publicDir = resolve(__dirname, 'public');
      for(const entry of await readdir(publicDir, {withFileTypes: true})) {
        if(isRuntimePublic(entry.name, entry.isDirectory())) {
          await cp(resolve(publicDir, entry.name), resolve(outDir, entry.name), {recursive: true,
            filter: (source) => !WIDGET_OMITTED_PUBLIC.some((pattern) => pattern.test(relative(publicDir, source)))});
        }
      }
      assertWidgetCleanupAssets(await readdir(outDir, {recursive: true}));
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
    postcssPlugin: 'widget-system-fonts-and-corners',
    Declaration: widgetThemeDeclaration,
    Rule: (rule) => {
      // Keep the widget's own hide/layout rules; filter only inherited client CSS.
      if(/[\\/]src[\\/]widget[\\/]/.test(rule.source?.input.file || '')) return;
      const selectors = rule.selectors.filter(widgetCssSelector);
      if(!selectors.length) rule.remove();
      else if(selectors.length !== rule.selectors.length) rule.selectors = selectors;
    },
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
  worker: {plugins: () => [widgetOmittedModules(false)], rolldownOptions: {output: {codeSplitting: false}}},
  test: {root: __dirname, include: ['src/tests/widget*.test.ts']}
}));
