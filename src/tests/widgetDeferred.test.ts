import {readdirSync, readFileSync} from 'node:fs';
import {parseAst} from 'vite';
import {assertWidgetDeferredModules, widgetDeferredFacade} from '../../scripts/widget-deferred';

const upstream = vi.hoisted(() => ({
  viewers: [] as any[],
  restricted: 0,
  popups: [] as any[],
  failNext: false
}));
vi.mock('@environment/mediaMimeTypesSupport', () => ({default: new Set(['image/png', 'video/mp4'])}));
vi.mock('@/widget/mediaViewerRestrictions', () => ({restrictMediaViewer: () => ++upstream.restricted}));
vi.mock('@components/mediaViewer/index?widget-original', () => {
  if(upstream.failNext) {
    upstream.failNext = false;
    throw new Error('offline');
  }
  return {
    onMediaCaptionClick: () => 'caption',
    default: class {
      public calls: unknown[][] = [];
      constructor(...args: unknown[]) { this.calls.push(['new', ...args]); upstream.viewers.push(this); }
      public setSearchContext(...args: unknown[]) { this.calls.push(['setSearchContext', ...args]); return this; }
      public openMedia(...args: unknown[]) { this.calls.push(['openMedia', ...args]); return Promise.resolve('opened'); }
    }
  };
});
vi.mock('@components/popups/newMedia?widget-original', () => {
  let current: any;
  return {
    getCurrentNewMediaPopup: () => current,
    canSendNewMedia: async() => ({send_photos: true}),
    default: (...args: unknown[]) => {
      const calls: unknown[][] = [['show', ...args]];
      current = {calls, addFiles: (files: unknown) => calls.push(['addFiles', files]), setStarsAmount: (stars: unknown) => calls.push(['stars', stars]),
        appendDrops: () => {}, hide: () => { calls.push(['hide']); current = undefined; }};
      upstream.popups.push(current);
      return current;
    }
  };
});

const parse = (source: string, path = 'x.ts') => parseAst(source, {lang: path.endsWith('x') ? 'tsx' : 'ts'});

describe('generated facades', () => {
  it('forwards async, void and Promise exports to the upstream module', () => {
    const source = [
      'export type Options = {};',
      'export async function load(a: number) { return a; }',
      'export function pick(): Promise<string> { return Promise.resolve(\'\'); }',
      'export default function show(options: Options): void {}'
    ].join('\n');
    expect(widgetDeferredFacade(parse(source), source, '/repo/popup.tsx')).toBe([
      'let deferredLoading;',
      'const deferredLoad = () => deferredLoading ??= import("/repo/popup.tsx?widget-original").catch((error) => { deferredLoading = undefined; throw error; });',
      'export function load(...args) { return deferredLoad().then((module) => module.load(...args)); }',
      'export function pick(...args) { return deferredLoad().then((module) => module.pick(...args)); }',
      'export default function(...args) { return deferredLoad().then((module) => module.default(...args)); }',
      ''
    ].join('\n'));
  });

  it.each([
    'export function make() { return 1; }',
    'export const KIND = Symbol();',
    'export class Popup {}',
    'const show = async() => {}; export {show};',
    'export * from \'./other\';',
    'export default async() => {};'
  ])('rejects an export callers may use at once: %s', source => {
    expect(() => widgetDeferredFacade(parse(source), source, '/repo/popup.ts')).toThrow('WIDGET_DEFERRED_EXPORT_CHANGED');
  });

  it('rejects a deferred upstream module with a static importer', () => {
    const graph = new Map([
      ['/repo/a.ts?widget-original', {importers: [] as string[], dynamicImporters: ['/repo/a.ts']}],
      ['/repo/b.ts?widget-original', {importers: ['/repo/c.ts'], dynamicImporters: ['/repo/b.ts']}],
      ['/repo/wrapped.ts?widget-original', {importers: ['/repo/wrapped.ts'], dynamicImporters: [] as string[]}]
    ]);
    const getModuleInfo = (id: string) => graph.get(id) || null;
    expect(() => assertWidgetDeferredModules(graph.keys(), {getModuleInfo}, id => id))
    .toThrow('widget deferred module is also imported eagerly: /repo/b.ts?widget-original <- /repo/c.ts');
    graph.delete('/repo/b.ts?widget-original');
    expect(assertWidgetDeferredModules(graph.keys(), {getModuleInfo}, id => id)).toBe(1);
  });
});

describe('media viewer facade', () => {
  it('replays the constructor and search context, restricting the viewer once, and retries a failed load', async() => {
    const {default: AppMediaViewer, onMediaCaptionClick} = await import('@/widget/deferred/mediaViewer');
    const caption = document.createElement('div');
    expect(onMediaCaptionClick(caption, new MouseEvent('click'))).toBeUndefined();

    upstream.failNext = true;
    await expect(new AppMediaViewer().openMedia({message: undefined})).rejects.toThrow();
    expect(upstream.restricted).toBe(0);

    const target = document.createElement('img');
    await expect(new AppMediaViewer(undefined, true)
    .setSearchContext({peerId: 1, inputFilter: {_: 'inputMessagesFilterPhotoVideo'}})
    .openMedia({message: undefined, target})).resolves.toBe('opened');
    await new AppMediaViewer(true).openMedia({message: undefined});
    expect(upstream.restricted).toBe(1);
    expect(upstream.viewers.map(viewer => viewer.calls)).toEqual([[
      ['new', undefined, true],
      ['setSearchContext', {peerId: 1, inputFilter: {_: 'inputMessagesFilterPhotoVideo'}}],
      ['openMedia', {message: undefined, target}]
    ], [
      ['new', true],
      ['openMedia', {message: undefined}]
    ]]);
    expect(onMediaCaptionClick(caption, new MouseEvent('click'))).toBe('caption');
  });

  it('checks document compatibility synchronously, like upstream', async() => {
    const {default: AppMediaViewer} = await import('@/widget/deferred/mediaViewer');
    const body = (path: string) => /isMediaCompatibleForDocumentViewer\([^)]*\) \{\n([\s\S]*?)\n {2}\}/.exec(readFileSync(path, 'utf8'))[1];
    expect(body('src/widget/deferred/mediaViewer.ts')).toBe(body('src/components/mediaViewer/index.ts'));
    expect(AppMediaViewer.isMediaCompatibleForDocumentViewer({_: 'photo'} as any)).toBe(true);
    expect(AppMediaViewer.isMediaCompatibleForDocumentViewer({_: 'document', mime_type: 'video/mp4', size: 1} as any)).toBe(true);
    expect(AppMediaViewer.isMediaCompatibleForDocumentViewer({_: 'document', mime_type: 'video/mp4', size: 30e6} as any)).toBe(false);
    expect(AppMediaViewer.isMediaCompatibleForDocumentViewer({_: 'document', mime_type: 'application/pdf', size: 1} as any)).toBe(false);
  });
});

describe('attachment preview facade', () => {
  it('hands files, Stars and closing to the popup once it loads', async() => {
    const {default: showNewMediaPopup, getCurrentNewMediaPopup, canSendNewMedia} = await import('@/widget/deferred/newMedia');
    expect(getCurrentNewMediaPopup()).toBeUndefined();
    const handle = showNewMediaPopup(undefined, [], 'media');
    expect(getCurrentNewMediaPopup()).toBe(handle);
    getCurrentNewMediaPopup().addFiles([]);
    getCurrentNewMediaPopup().setStarsAmount(5);
    await vi.waitFor(() => expect(upstream.popups).toHaveLength(1));
    await Promise.resolve();
    const [popup] = upstream.popups;
    expect(getCurrentNewMediaPopup()).toBe(popup);
    expect(popup.calls).toEqual([['show', undefined, [], 'media'], ['addFiles', []], ['stars', 5]]);
    handle.hide();
    await vi.waitFor(() => expect(getCurrentNewMediaPopup()).toBeUndefined());
    expect(await canSendNewMedia({peerId: 1 as PeerId})).toEqual({send_photos: true});
  });
});

// Facades record only what callers do with a viewer; any other use must update them.
describe('deferred viewer call sites', () => {
  const files = (readdirSync('src', {recursive: true}) as string[])
  .filter(path => /\.tsx?$/.test(path) && !/\.d\.ts$|^(tests|widget|components\/mediaViewer)\//.test(path))
  .map(path => 'src/' + path);
  const uses: string[] = [];
  const captionCallers = new Set<string>();
  const walk = (node: any, parents: any[], path: string) => {
    if(!node || typeof node.type !== 'string') return;
    const name = node.type === 'Identifier' ? node.name : node.type === 'MemberExpression' && !node.computed ? node.property.name : undefined;
    if(name === 'onMediaCaptionClick') captionCallers.add(path);
    if((name === 'AppMediaViewer' || name === 'AppMediaViewerStatic') && node.type !== 'MemberExpression' || node.type === 'MemberExpression' && /^AppMediaViewer(Static)?$/.test(name)) {
      const parent = parents[parents.length - 1];
      if(parent?.type === 'NewExpression' && parent.callee === node) {
        const chain = [];
        let current = parent, depth = parents.length - 1;
        while(parents[depth - 1]?.type === 'MemberExpression' && parents[depth - 2]?.type === 'CallExpression' && parents[depth - 2].callee === parents[depth - 1]) {
          chain.push(parents[depth - 1].property.name);
          current = parents[depth - 2];
          depth -= 2;
        }
        uses.push(`${name}#${chain.join('.')}${parents[depth - 1]?.type === 'ExpressionStatement' && parents[depth - 1].expression === current ? '' : ' (result used)'}`);
      } else if(parent?.type === 'MemberExpression' && parent.object === node) {
        uses.push(`${name}.${parent.property.name}`);
      }
    }
    for(const [key, value] of Object.entries(node)) {
      if(key === 'type' || key === 'start' || key === 'end') continue;
      for(const child of Array.isArray(value) ? value : [value]) {
        if(child && typeof child === 'object') walk(child, [...parents, node], path);
      }
    }
  };
  for(const path of files) {
    const source = readFileSync(path, 'utf8');
    if(/AppMediaViewer|onMediaCaptionClick/.test(source)) walk(parse(source, path), [], path);
  }

  it('builds viewers only as the facades record them', () => {
    expect(new Set(uses)).toEqual(new Set([
      'AppMediaViewer#setSearchContext.openMedia',
      'AppMediaViewer.isMediaCompatibleForDocumentViewer',
      'AppMediaViewerStatic#openMedia'
    ]));
  });

  it('takes caption clicks only from screens the widget leaves out', () => {
    expect([...captionCallers].sort()).toEqual([
      'src/components/popups/stickers.tsx',
      'src/components/popups/translate/bodyContent.tsx',
      'src/components/premium/promoSlide.tsx',
      'src/components/stories/viewer.tsx',
      'src/lib/solidjs/hotReloadGuard.ts',
      'src/lib/solidjs/hotReloadGuardValue.ts'
    ]);
  });
});
