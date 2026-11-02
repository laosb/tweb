import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {Plugin} from 'vite';
import contracts from '../src/widget/managers/contracts.json';
import wiring from '../src/widget/managers/wiring.json';

type Methods = Map<string, Set<string>>;
const nameOf = (node: any) => node?.type === 'Identifier' ? node.name :
  ['Literal', 'StringLiteral'].includes(node?.type) ? node.value : undefined;

function walk(node: any, visit: (node: any, parent: any) => void, parent?: any) {
  if(!node || typeof(node) !== 'object') return;
  if(typeof(node.type) === 'string') visit(node, parent);
  for(const [key, value] of Object.entries(node)) {
    if(key === 'loc') continue;
    if(Array.isArray(value)) value.forEach(child => walk(child, visit, node));
    else if(value && typeof(value) === 'object') walk(value, visit, node);
  }
}

export function assertWidgetManagerSource(source: string, expected: string, path: string) {
  if(createHash('sha256').update(source).digest('hex') !== expected) {
    throw new Error('WIDGET_MANAGER_SOURCE_CHANGED: audit ingestion, events and lifecycle before updating ' + path);
  }
}

// Check every transformed module of both graphs, including dormant methods left
// behind runtime restrictions. An alias/escape must be audited explicitly; never
// assume a manager passed elsewhere will only use today's named methods.
export function assertWidgetManagerCalls(program: any, methods: Methods, id: string) {
  const fail = (detail: string) => { throw new Error('WIDGET_MANAGER_CONTRACT: ' + id + ': ' + detail); };
  walk(program, (node, parent) => {
    if(['MemberExpression', 'OptionalMemberExpression'].includes(node.type) && methods.has(nameOf(node.property))) {
      const manager = nameOf(node.property);
      if(node.computed && !['Literal', 'StringLiteral'].includes(node.property.type)) {
        fail('computed manager access ' + manager);
      }
      if(!['MemberExpression', 'OptionalMemberExpression'].includes(parent?.type) || parent.object !== node) fail('manager escapes: ' + manager);
      const method = nameOf(parent.property);
      if(!method || parent.computed && !['Literal', 'StringLiteral'].includes(parent.property.type)) {
        fail('dynamic method on ' + manager);
      }
      if(!methods.get(manager).has(method)) fail('missing ' + manager + '.' + method);
    }
    if(['Property', 'ObjectProperty'].includes(node.type) && methods.has(nameOf(node.key)) && parent?.type === 'ObjectPattern') {
      fail('destructured manager: ' + nameOf(node.key));
    }
    if(['Literal', 'StringLiteral'].includes(node.type) && methods.has(node.value) &&
      !(['MemberExpression', 'OptionalMemberExpression'].includes(parent?.type) && parent.computed && parent.property === node)) {
      fail('indirect manager name: ' + node.value);
    }
  });
}

export function widgetManagerReplacements(root: string) {
  return Object.fromEntries(Object.values(contracts).map(item => [item.source, resolve(root, item.replacement)]));
}

export default function widgetManagerContracts(root: string): Plugin {
  let methods: Methods;
  return {
    name: 'widget-manager-contracts',
    enforce: 'post',
    apply: (config, {command}) => command === 'build' && !config.build?.lib,
    buildStart() {
      methods = new Map();
      for(const [path, hash] of Object.entries(wiring)) {
        assertWidgetManagerSource(readFileSync(resolve(root, path), 'utf8'), hash, path);
      }
      for(const [name, item] of Object.entries(contracts)) {
        assertWidgetManagerSource(readFileSync(resolve(root, item.source), 'utf8'), item.sha256, item.source);
        const program = this.parse(readFileSync(resolve(root, item.replacement), 'utf8'), {lang: 'ts'});
        const names = new Set<string>(['getAccountNumber', 'createLogger', 'setManagersAndAccountNumber']);
        walk(program, node => {
          if(node.type !== 'ClassDeclaration') return;
          for(const member of node.body.body) {
            if(member.accessibility !== 'private' && member.accessibility !== 'protected' && nameOf(member.key)) names.add(nameOf(member.key));
          }
        });
        methods.set(name, names);
      }
    },
    transform(source, id) {
      if(!/\.[cm]?[jt]sx?(?:\?|$)/.test(id) || !source.includes('Manager')) return;
      if(Object.values(contracts).some(item => id === resolve(root, item.source) + '?widget-original')) {
        this.error('WIDGET_MANAGER_ORIGINAL_REINTRODUCED: ' + id);
      }
      assertWidgetManagerCalls(this.parse(source), methods, id);
    }
  };
}
