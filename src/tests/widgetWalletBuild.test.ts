import {readFileSync} from 'node:fs';
import {parseSync} from '@babel/core';
import widgetWallet, {pruneWidgetWallet} from '../../scripts/widget-wallet';
import {mergeConfig} from 'vite';
import {languageCoveragePlugin} from '../../tests/widget/languageCoverage.mjs';
import {pruneWidgetSchema} from '../../scripts/widget-schema';
import omitted from '@/widget/omittedSchema.json';
import contracts from '@/widget/managers/contracts.json';

const parse = (source: string) => parseSync(source, {configFile: false, parserOpts: {plugins: ['typescript', 'estree']}});
const transform = (path: string, source = readFileSync(path, 'utf8')) => pruneWidgetWallet(source, path, parse).toString();
const schemaSource = readFileSync('src/lib/mtproto/schema.ts', 'utf8');
const readSchema = (source: string) => JSON.parse(source.slice(source.indexOf('export default ') + 15, source.indexOf(' as {')));

it('keeps every supported wire definition byte-for-byte and removes reviewed unused new APIs', () => {
  const before = readSchema(schemaSource), after = readSchema(pruneWidgetSchema(schemaSource).toString());
  expect(after.MTProto).toEqual(before.MTProto);
  expect(after.layer).toBe(before.layer);
  for(const kind of ['constructors', 'methods'] as const) {
    expect(after.API[kind]).toEqual(before.API[kind].filter((entry: any) => !omitted[kind].includes(entry.predicate || entry.method)).map((entry: any) => ({
      ...entry,
      params: entry.params.filter((param: any) => !(omitted.params as Record<string, string[]>)[entry.predicate || entry.method]?.includes(param.name))
    })));
  }
  const wire = JSON.stringify(after);
  expect(wire).not.toMatch(/wallet|tonconnect|toncenter|onramp|shareTheme|NoPaidMessagesToken|GramTransfer/i);
  // Ordinary chat schemas, rich replies and the fork's extension hook survive.
  expect(wire).toContain('quote_rich');
  expect(wire).toContain('messages.sendMessage');
  expect(pruneWidgetSchema(schemaSource).toString()).toContain('export default ');
  expect(() => pruneWidgetSchema(schemaSource.replace('"wallet.getState"', '"wallet.renamed"'))).toThrow('WIDGET_SCHEMA_TARGET_CHANGED');
});

it('removes Wallet draft pairing without losing ordinary sends, edits, updates or reads', () => {
  const source = transform('src/lib/appManagers/appMessagesManager.ts');
  expect(source).not.toMatch(/gramTransferDrafts|dispatchTonConnectRequest|messageActionGramTransfer|wallet_tonconnect/);
  expect(source).toContain('this.pendingByMessageId[mid] = randomId;');
  expect(source).toContain('const randomId = this.pendingByMessageId[message.mid];');
  expect(source).toContain('this.finalizePendingMessage(randomId, message)');
  expect(source).toContain('this.adoptStreamedMessageDraft(message)');
  expect(() => parse(source)).not.toThrow();
});

it.each([
  ['src/components/wrappers/messageActionTextNewUnsafe.ts', 'messageActionWalletTonConnectRequest'],
  ['src/components/wrappers/messagePreviewIcon.ts', 'messageActionGramTransfer'],
  ['src/lib/richTextProcessor/wrapRichText.ts', 'messageEntityTonAddress'],
  ['src/lib/richTextProcessor/wrapTelegramRichText.ts', 'textTonAddress'],
  ['src/lib/uiNotificationsManager.ts', 'message.action._ === \'messageActionGramTransfer\''],
  ['src/components/chat/bubbles.ts', 'action._ === \'messageActionGramTransfer\'']
])('removes the excluded renderer in %s and rejects an upstream rename', (path, target) => {
  const source = readFileSync(path, 'utf8');
  const output = transform(path, source);
  expect(output).not.toContain(target);
  expect(() => parse(output)).not.toThrow();
  expect(() => transform(path, source.split(target).join('renamedTarget'))).toThrow('WIDGET_WALLET_TARGET_CHANGED');
});

it('omits the suggestion invalidation used only by first-transfer notifications', () => {
  // The whole promo manager is replaced by a widget contract with no members.
  expect(contracts.appPromoManager.source).toBe('src/lib/appManagers/appPromoManager.ts');
  expect(readFileSync(contracts.appPromoManager.replacement, 'utf8')).not.toContain('invalidateSuggestion');
});

it('drops Wallet link handlers and classification while retaining ordinary link handling', () => {
  const source = transform('src/lib/internalLinkProcessor.ts');
  expect(source).not.toContain('public processWalletSendLink');
  expect(source).not.toContain('public processTonConnectLink');
  expect(source).toContain('public processMessageLink');
  expect(() => parse(source)).not.toThrow();
  const urls = transform('src/lib/richTextProcessor/wrapUrl.ts');
  expect(urls).not.toMatch(/ton_transfer|tc_tonconnect|sendgrams/);
  expect(urls).toContain('matchTelegramUrlHost');
  expect(() => parse(urls)).not.toThrow();
  const types = transform('src/lib/internalLink.ts');
  expect(types.slice(0, types.indexOf('export type'))).not.toMatch(/WALLET_SEND|TON_CONNECT/);
});

it('adds the harness RPC observer once without duplicating worker transforms', () => {
  const config = {worker: {plugins: () => [widgetWallet(false)]}};
  const instrumentation = languageCoveragePlugin([]).config();
  const merged = mergeConfig(config, instrumentation);
  expect(merged.worker.plugins().map((plugin: {name: string}) => plugin.name)).toEqual(['widget-wallet', 'widget-rpc-observation']);
});
