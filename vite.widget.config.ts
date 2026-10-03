import {resolve} from 'node:path';
import {defineConfig} from 'vite';
import solid from 'vite-plugin-solid';
import upstream from './vite.config';

export default defineConfig({
  root: resolve(__dirname, 'widget'),
  base: './',
  publicDir: false,
  envDir: __dirname,
  plugins: [solid(), {
    name: 'widget-boundary',
    generateBundle() {
      for(const id of this.getModuleIds()) {
        if(/\/src\/(components|pages)\//.test(id) || /\/src\/lib\/(apiManagerProxy|appManagers\/createManagers)\./.test(id)) {
          this.error('The widget imported the full client: ' + id);
        }
      }
    }
  }],
  resolve: {
    ...upstream.resolve,
    alias: {
      '@config/blah': resolve(__dirname, 'src/widget/transportConfig.ts'),
      '@config/debug': resolve(__dirname, 'src/widget/debug.ts'),
      '@config/modes': resolve(__dirname, 'src/widget/modes.ts'),
      ...upstream.resolve.alias
    }
  },
  define: {
    __BLAH_CONFIG__: 'undefined',
    ...Object.fromEntries(Object.entries({
      VITE_MTPROTO_HAS_WS: '1',
      VITE_MTPROTO_HAS_HTTP: '',
      VITE_MTPROTO_AUTO: '',
      VITE_MTPROTO_HTTP: '',
      VITE_MTPROTO_HTTP_UPLOAD: '',
      VITE_MTPROTO_SW: '',
      VITE_SAFARI_PROXY_WEBSOCKET: ''
    }).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]))
  },
  server: {host: '127.0.0.1', port: 8080, fs: {allow: [__dirname]}},
  build: {target: 'es2020', outDir: resolve(__dirname, 'dist/widget'), emptyOutDir: true},
  worker: {format: 'es'},
  test: {...upstream.test, root: __dirname, include: ['src/tests/widget*.test.ts']}
});
