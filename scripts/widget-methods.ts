import MagicString from 'magic-string';
import type {Plugin} from 'vite';
import omitted from '../src/widget/omittedSchema.json';

// The widget bundles the TL schema into the MTProto worker. Its API *methods*
// are only needed to serialize outgoing calls (replies are decoded by
// constructor id, never by the called method), so a method that no reachable code
// can name is dead weight. API *constructors* are never pruned here: the DC may
// send any of them and dropping one desynchronizes decoding (docs/widget.md).
//
// The schema module is transformed with a placeholder for `API.methods`; once a
// chunk is rendered (after tree-shaking) the methods named by string literals in
// that chunk are put back. Nothing is listed by hand, so a rebase cannot rot it.
export const METHODS_PLACEHOLDER = '__WIDGET_API_METHODS__';
const PLACEHOLDER_PATTERN = new RegExp('(["\'`])' + METHODS_PLACEHOLDER + '\\1', 'g');
const SCHEMA_PATH = 'src/lib/mtproto/schema.ts';

export function deferWidgetMethods(source: string) {
  const prefix = 'export default ';
  const start = source.indexOf(prefix) + prefix.length;
  const end = source.indexOf(' as {', start);
  if(start < prefix.length || end < start) throw new Error('WIDGET_METHODS_TARGET_CHANGED');
  const schema = JSON.parse(source.slice(start, end));
  const methods = schema.API?.methods as {method: string}[];
  if(!Array.isArray(methods) || !methods.length) throw new Error('WIDGET_METHODS_TARGET_CHANGED: no API methods');
  schema.API.methods = METHODS_PLACEHOLDER;
  return {code: new MagicString(source).overwrite(start, end, JSON.stringify(schema)), methods};
}

// Methods whose name appears as a string literal in `code`. `ns.${x}` and
// `'ns.' + x` build a name at runtime: keep the `ns.` methods whose remainder
// is itself a literal in the code (e.g. channels.${'toggleForum'}).
export function usedMethods<T extends {method: string}>(code: string, methods: T[]) {
  const literals = new Set<string>();
  for(const match of code.matchAll(/(["'`])([A-Za-z_][\w.]*)\1/g)) literals.add(match[2]);
  const prefixes = new Set<string>();
  for(const match of code.matchAll(/(["'`])([A-Za-z]\w*\.)(?:\$\{|\1\s*\+)/g)) prefixes.add(match[2]);
  const kept = methods.filter(({method}) => {
    if(literals.has(method)) return true;
    const dot = method.indexOf('.');
    return dot > 0 && prefixes.has(method.slice(0, dot + 1)) && literals.has(method.slice(dot + 1));
  });
  return kept;
}

// A reviewed omission (omittedSchema.json) that final code still names would
// throw 'No method ... found' on first use: fail the build instead.
export function assertNoOmittedMethodCalls(code: string) {
  const literals = new Set([...code.matchAll(/(["'`])([A-Za-z_][\w.]*)\1/g)].map(match => match[2]));
  const missing = omitted.methods.filter(name => literals.has(name));
  if(missing.length) throw new Error('WIDGET_METHODS_OMITTED_BUT_REFERENCED: ' + missing.join(', '));
}

export function restoreWidgetMethods(code: string, methods: {method: string}[]) {
  let count = 0;
  const kept = usedMethods(code.replace(PLACEHOLDER_PATTERN, '""'), methods);
  const result = code.replace(PLACEHOLDER_PATTERN, () => { count++; return JSON.stringify(kept); });
  return {code: result, count, kept: kept.length, total: methods.length};
}

// The page build parses the schema but tree-shakes it out; the worker build
// restores it. The page pipeline (requireRestore) checks that one chunk did.
let restored = 0;
export default function widgetMethods(requireRestore = true): Plugin {
  let methods: {method: string}[] | undefined;
  const restoredFiles = new Set<string>();
  return {
    name: 'widget-methods',
    enforce: 'pre',
    apply: 'build',
    buildStart() {
      methods = undefined;
      if(requireRestore) restored = 0;
    },
    transform(source, id) {
      if(!id.split('?')[0].endsWith('/' + SCHEMA_PATH)) return;
      const result = deferWidgetMethods(source);
      methods = result.methods;
      return {code: result.code.toString(), map: result.code.generateMap({hires: true})};
    },
    // After minification, so that branches the build removes as dead do not keep methods alive.
    renderChunk: {order: 'post', handler(code, chunk) {
      if(!code.includes(METHODS_PLACEHOLDER)) return;
      if(!methods) this.error('WIDGET_METHODS_TARGET_CHANGED: placeholder without schema');
      const result = restoreWidgetMethods(code, methods);
      if(result.count !== 1) this.error('WIDGET_METHODS_TARGET_CHANGED: placeholder occurs ' + result.count + ' times');
      restored++;
      restoredFiles.add(chunk.fileName);
      this.info(`widget API methods: kept ${result.kept} of ${result.total}`);
      return {code: result.code, map: null};
    }},
    generateBundle(_, bundle) {
      for(const fileName of restoredFiles) {
        const chunk = bundle[fileName];
        if(chunk?.type === 'chunk') try { assertNoOmittedMethodCalls(chunk.code); } catch(error) { this.error((error as Error).message); }
      }
    },
    buildEnd(error) {
      if(!error && requireRestore && !restored) this.error('WIDGET_METHODS_NOT_RESTORED: the schema reached no output chunk');
    }
  };
}
