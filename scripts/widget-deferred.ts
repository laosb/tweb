// Screens a customer opens only by an action build into one lazily loaded `deferred` chunk.
// Their modules are replaced by facades that load the unchanged upstream module on first use:
// a generated one when every export can be called before the module arrives, otherwise a
// reviewed facade in src/widget/deferred/.
export const WIDGET_DEFERRED_ORIGINAL = '?widget-original';

/**
 * A facade forwarding each export to the upstream module, loaded on the first call. Only
 * functions whose callers already wait for them or ignore their result qualify: `async`
 * ones and those declared to return `void` or a `Promise`.
 */
export function widgetDeferredFacade(program: any, source: string, specifier: string) {
  const names: string[] = [];
  for(const node of program.body) {
    if(node.type === 'ExportAllDeclaration') throw new Error('WIDGET_DEFERRED_EXPORT_CHANGED: export *');
    if(node.type !== 'ExportNamedDeclaration' && node.type !== 'ExportDefaultDeclaration') continue;
    if(node.exportKind === 'type') continue;
    const declaration = node.declaration;
    if(!declaration) {
      const values = node.specifiers.filter((item: any) => item.exportKind !== 'type');
      if(values.length) throw new Error('WIDGET_DEFERRED_EXPORT_CHANGED: ' + values.map((item: any) => item.exported.name).join(', '));
      continue;
    }
    if(declaration.declare || /^TS(Interface|TypeAlias)Declaration$/.test(declaration.type)) continue;
    const name = node.type === 'ExportDefaultDeclaration' ? 'default' : declaration.id?.name;
    const returns = declaration.returnType ? source.slice(declaration.returnType.typeAnnotation.start, declaration.returnType.typeAnnotation.end) : '';
    if(declaration.type !== 'FunctionDeclaration' || !(declaration.async || /^(void|Promise<[\s\S]*>)$/.test(returns))) {
      throw new Error('WIDGET_DEFERRED_EXPORT_CHANGED: ' + name);
    }
    names.push(name);
  }
  if(!names.length) throw new Error('WIDGET_DEFERRED_EXPORT_CHANGED: no exports');
  const target = JSON.stringify(specifier + WIDGET_DEFERRED_ORIGINAL);
  return [
    'let deferredLoading;',
    `const deferredLoad = () => deferredLoading ??= import(${target}).catch((error) => { deferredLoading = undefined; throw error; });`,
    ...names.map((name) => `export ${name === 'default' ? 'default function' : 'function ' + name}(...args) { return deferredLoad().then((module) => module.${name}(...args)); }`)
  ].join('\n') + '\n';
}

type ModuleGraph = {getModuleInfo(id: string): {importers: readonly string[], dynamicImporters: readonly string[]} | null};

/** Upstream modules a facade loads must stay out of the client: no static importer may remain. */
export function assertWidgetDeferredModules(ids: Iterable<string>, graph: ModuleGraph, label: (id: string) => string) {
  const eager: string[] = [];
  let deferred = 0;
  for(const id of ids) {
    if(!id.endsWith(WIDGET_DEFERRED_ORIGINAL)) continue;
    const info = graph.getModuleInfo(id);
    if(!info?.dynamicImporters.length) continue;
    ++deferred;
    if(info.importers.length) eager.push(label(id) + ' <- ' + info.importers.map(label).join(', '));
  }
  if(eager.length) throw new Error('widget deferred module is also imported eagerly: ' + eager.join('; '));
  return deferred;
}
