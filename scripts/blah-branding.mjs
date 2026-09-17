import {readFileSync} from 'node:fs';
import path from 'node:path';

const ICON_DIRECTORY = 'assets/blah/';
const ICON_FILES = ['logo.svg', 'icon-32.png', 'icon-192.png', 'icon-512.png'];
const MANIFEST_FILES = {
  'site.blah.webmanifest': 'site.webmanifest',
  'site_apple.blah.webmanifest': 'site_apple.webmanifest'
};
const TITLE = 'Blah';
const DESCRIPTION = 'Blah messaging.';

// Touch metadata only, never shipped JavaScript, language strings or API names.
export function brandBlahHtml(html) {
  return html.replace(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`)
  .replace(/<meta\b[^>]*>/g, (tag) => {
    const name = tag.match(/(?:name|property)="([^"]+)"/)?.[1];
    let content;
    if(['mobile-web-app-title', 'apple-mobile-web-app-title', 'application-name', 'og:title', 'twitter:title'].includes(name)) {
      content = TITLE;
    } else if(['description', 'og:description', 'twitter:description'].includes(name)) {
      content = DESCRIPTION;
    } else if(['og:image', 'twitter:image', 'msapplication-TileImage'].includes(name)) {
      content = ICON_DIRECTORY + 'icon-512.png';
    }
    return content ? tag.replace(/content="[^"]*"/, `content="${content}"`) : tag;
  })
  .replace(/<link\b[^>]*rel="(?:icon|alternate icon|apple-touch-icon)"[^>]*>\s*/g, '')
  .replace('</head>', [
    `<link rel="icon" type="image/png" sizes="32x32" href="${ICON_DIRECTORY}icon-32.png">`,
    `<link rel="icon" type="image/svg+xml" sizes="any" href="${ICON_DIRECTORY}logo.svg">`,
    `<link rel="apple-touch-icon" href="${ICON_DIRECTORY}icon-512.png">`,
    '</head>'
  ].join('\n'));
}

export function brandBlahManifest(manifest) {
  const result = {
    ...manifest,
    name: TITLE,
    short_name: TITLE,
    description: DESCRIPTION,
    icons: [192, 512].map((size) => ({
      src: `${ICON_DIRECTORY}icon-${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png'
    }))
  };
  delete result.gcm_sender_id;
  return result;
}

/** @returns {import('vite').Plugin} */
export default function blahBrandingPlugin(root) {
  let enabled = false;
  const publicPath = (filename) => path.join(root, 'public', filename);
  const manifestSource = (filename) => JSON.stringify(
    brandBlahManifest(JSON.parse(readFileSync(publicPath(filename), 'utf8'))), null, 2
  ) + '\n';

  return {
    name: 'blah-branding',
    configResolved(config) {
      enabled = !!config.define.__BLAH_CONFIG__ && config.define.__BLAH_CONFIG__ !== 'undefined';
    },
    transformIndexHtml: {
      order: 'post', // After the upstream Handlebars title has been expanded.
      handler: (html) => enabled ? brandBlahHtml(html) : html
    },
    generateBundle() {
      if(!enabled) return;
      // copyPublicDir is false. Dist must contain the icons and manifests, using
      // distinct names so even legacy build.js's dist -> public copy is harmless.
      for(const file of ICON_FILES) {
        const fileName = ICON_DIRECTORY + file;
        this.emitFile({type: 'asset', fileName, source: readFileSync(publicPath(fileName))});
      }
      for(const [fileName, template] of Object.entries(MANIFEST_FILES)) {
        this.emitFile({type: 'asset', fileName, source: manifestSource(template)});
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const filename = req.url?.split('?')[0].slice(1);
        const template = Object.entries(MANIFEST_FILES).find(([file]) => file === filename)?.[1];
        if(!enabled || !template) return next();
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(manifestSource(template));
      });
    }
  };
}
