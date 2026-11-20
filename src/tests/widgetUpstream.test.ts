import {readFileSync} from 'node:fs';
import {parseSync} from '@babel/core';
import {pruneWidgetUpstream, WIDGET_UPSTREAM_TARGETS} from '../../scripts/widget-upstream';
import {assertWidgetCleanupAssets, assertWidgetCleanupModules, assertWidgetUpstreamOutput} from '../../scripts/widget-cleanup-guards';
import {widgetStyleSelector} from '../../scripts/widget-styles';
import {widgetReceivedMessage} from '@/widget/receivedContent';

const parse = (source: string) => parseSync(source, {configFile: false, parserOpts: {plugins: ['typescript', 'estree']}});
const transform = (path: string) => pruneWidgetUpstream(readFileSync(path, 'utf8'), path, parse).toString();

it.each(WIDGET_UPSTREAM_TARGETS)('leaves valid TypeScript after removing unreachable upstream code in %s', path => {
  expect(() => parse(transform(path))).not.toThrow();
  expect(() => pruneWidgetUpstream('', path, parse)).toThrow('WIDGET_UPSTREAM_TARGET_CHANGED');
});

it('keeps ordinary sends, deletions, pagination and reactions without bot storage or channel administration', () => {
  const messages = transform('src/lib/appManagers/appMessagesManager.ts');
  expect(messages).not.toContain('this.appWidgetsManager.');
  expect(messages).not.toContain('public setMessagesWidgetData(');
  expect(messages).toContain('this.finalizePendingMessageCallbacks(storage, tempId, finalMessage);');
  expect(messages).toContain('this.appTranslationsManager.resetPeerTranslationsByChannelCutoff(peerId)');
  const dialogs = transform('src/lib/storages/dialogs.ts');
  expect(dialogs).toContain('public getDialogsPaginationOffsets(');
  expect(dialogs).not.toContain('this.appWidgetsManager.');
  const chats = transform('src/lib/appManagers/appChatsManager.ts');
  expect(chats).not.toContain('public async setChatAvailableReactions(');
  expect(chats).not.toContain('private reactionsSaves:');
  expect(chats).toContain('public getChat(');
});

it('normalizes bot HTML to unsupported without inflating or inspecting its payload', () => {
  const message = {_: 'message', message: 'caption', media: {
    _: 'messageMediaWidget',
    get payload() { throw new Error('bot HTML was read'); }
  }} as any;
  expect(widgetReceivedMessage(message)).toMatchObject({message: '', media: {_: 'messageMediaUnsupported'}});
});

it('keeps deferred history rendering without tracking bot-widget visibility or delayed heights', () => {
  const bubbles = transform('src/components/chat/bubbles.ts');
  expect(bubbles).not.toContain('watchFirstScreenSight(');
  expect(bubbles).not.toContain('OUT_OF_SIGHT');
  expect(bubbles).not.toContain('follow: position');
  expect(bubbles).toContain('this.performHistoryResult(cut.beyond, true, true)');
  expect(bubbles).toContain('this.firstScreenRestPromise = promise.then(');
  const scroll = transform('src/helpers/fastSmoothScroll.ts');
  expect(scroll).toContain('const following = false;');
  expect(scroll).toContain('options.getFocus?.()');
});

it('rejects sandbox, QuickJS, 3D-star and QR graph/assets while preserving ordinary media', () => {
  for(const path of ['src/lib/widgetSandbox/runtime.ts', 'src/components/widgetSandbox/widgetBlock.tsx',
    'src/vendor/widget-sandbox/src/host/glue.ts', 'src/vendor/widget-sandbox-quickjs/dist/index.js',
    'src/components/star3D/index.tsx', 'src/vendor/telegram-3d-star/src/index.ts',
    'node_modules/.pnpm/quickjs-emscripten-core@0.32.0/node_modules/quickjs-emscripten-core/index.js']) {
    expect(() => assertWidgetCleanupModules([path], [])).toThrow('omitted feature');
  }
  for(const path of ['emscripten-module.asyncify.wasm', 'star-12345678.mesh', 'flecks-12345678.png', 'assets/img/qr/msg_copy.webp']) {
    expect(() => assertWidgetCleanupAssets([path])).toThrow('omitted assets');
  }
  expect(() => assertWidgetCleanupAssets(['tlottie-test.wasm', 'assets/img/media-editor-border-part.svg'])).not.toThrow();
  for(const source of ['messageMediaWidget', 'widgets__encrypted', 'setChatAvailableReactions', 'Widget.NetworkMarker']) {
    expect(() => assertWidgetUpstreamOutput(source)).toThrow('unreachable upstream');
  }
  expect(widgetStyleSelector('.bubble.widget-message .attachment')).toBe(false);
  expect(widgetStyleSelector('.bubble.widget-message .time-widget-network')).toBe(false);
});
