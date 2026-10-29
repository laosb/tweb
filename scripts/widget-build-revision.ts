import {execFileSync} from 'node:child_process';
import type {Plugin} from 'vite';

/** One public identity for the release template, setup page and manifest. */
export default function widgetBuildRevision(root: string): Plugin {
  let manifest: {revision: string, version: string, builtAt: string};
  return {
    name: 'widget-build-revision',
    apply: (config) => !config.build?.lib,
    configResolved(config) {
      const git = (...args: string[]) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
      const sha = git('rev-parse', 'HEAD');
      if(!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Cannot identify the widget build revision');
      manifest = {
        revision: sha + (git('status', '--porcelain') ? '-dirty' : ''),
        version: config.env.VITE_VERSION_FULL,
        builtAt: new Date().toISOString()
      };
    },
    transformIndexHtml() {
      return [{tag: 'meta', attrs: {name: 'blah-widget-revision', content: manifest.revision}, injectTo: 'head'}];
    },
    generateBundle() {
      this.emitFile({type: 'asset', fileName: 'build.json', source: JSON.stringify(manifest, null, 2) + '\n'});
    }
  };
}
