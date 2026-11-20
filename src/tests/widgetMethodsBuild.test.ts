import {readFileSync} from 'node:fs';
import {assertNoOmittedMethodCalls, deferWidgetMethods, METHODS_PLACEHOLDER, restoreWidgetMethods, usedMethods} from '../../scripts/widget-methods';
import {pruneWidgetSchema} from '../../scripts/widget-schema';
import {TLSerialization} from '@lib/mtproto/tl_utils';

const source = pruneWidgetSchema(readFileSync('src/lib/mtproto/schema.ts', 'utf8')).toString();
const read = (text: string) => JSON.parse(text.slice(text.indexOf('export default ') + 15, text.indexOf(' as {')));
const original = read(source);
const names: string[] = original.API.methods.map((method: any) => method.method);

function build(code: string) {
  const {code: deferred, methods} = deferWidgetMethods(source);
  const text = deferred.toString();
  expect(text).toContain(METHODS_PLACEHOLDER);
  expect(text).not.toContain('"messages.sendMessage"');
  // The placeholder sits inside the schema object, as in the bundled chunk.
  const chunk = restoreWidgetMethods(`const schema = ${text.slice(text.indexOf('export default ') + 15, text.indexOf(' as {'))};\n${code}`, methods);
  return {chunk, schema: JSON.parse(chunk.code.slice(chunk.code.indexOf('{'), chunk.code.indexOf(';\n')))};
}

it('keeps exactly the methods that reachable code names, and every constructor', () => {
  const {chunk, schema} = build('api(\'messages.sendMessage\'); x = `help.getConfig`; y = {method: \"invokeWithLayer\"}; \'initConnection\'');
  expect(chunk.count).toBe(1);
  expect(schema.API.methods.map((method: any) => method.method)).toEqual(
    names.filter(name => ['messages.sendMessage', 'help.getConfig', 'invokeWithLayer', 'initConnection'].includes(name)));
  expect(schema.API.methods).toEqual(original.API.methods.filter((method: any) => schema.API.methods.some((kept: any) => kept.method === method.method)));
  expect(schema.API.constructors).toEqual(original.API.constructors);
  expect(schema.MTProto).toEqual(original.MTProto);
  expect(schema.layer).toBe(original.layer);
});

it('keeps dynamically named methods whose suffix is a literal', () => {
  const methods = names.filter(name => name.startsWith('channels.')).map(method => ({method}));
  const kept = (code: string) => usedMethods(code, methods).map(item => item.method);
  expect(kept('call(`channels.${what}`, p); go(\'toggleForum\')')).toEqual(['channels.toggleForum']);
  expect(kept('call(\'channels.\' + what); go(\'toggleForum\')')).toEqual(['channels.toggleForum']);
  expect(kept('go(\'toggleForum\')')).toEqual([]);
  expect(names).toContain('channels.toggleForum');
});

it('fails the build when final code names a reviewed omission and survives otherwise', () => {
  expect(() => assertNoOmittedMethodCalls('api(\'wallet.getState\')')).toThrow('WIDGET_METHODS_OMITTED_BUT_REFERENCED');
  expect(() => assertNoOmittedMethodCalls('api(\'messages.sendMessage\')')).not.toThrow();
});

it('rejects a changed schema layout', () => {
  expect(() => deferWidgetMethods('export default {} as {}')).toThrow('WIDGET_METHODS_TARGET_CHANGED');
  expect(() => deferWidgetMethods(source.replace(' as {', ' as nothing'))).toThrow('WIDGET_METHODS_TARGET_CHANGED');
});

it('makes a call to a pruned method fail loudly at serialization', () => {
  expect(() => new TLSerialization().storeMethod('no.suchMethod', {})).toThrow('No method no.suchMethod found');
});
