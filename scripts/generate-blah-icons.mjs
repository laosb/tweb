// Run only when logo.svg changes. Generated PNGs are committed, so builds do not
// need a browser, a rasterizer dependency, or a network fetch for branding.
import {readFile, writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const directory = new URL('../public/assets/blah/', import.meta.url);
const svg = await readFile(new URL('logo.svg', directory), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({deviceScaleFactor: 1});
  for(const size of [32, 192, 512]) {
    const png = await page.evaluate(async({svg, size}) => {
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, {svg, size});
    await writeFile(new URL(`icon-${size}.png`, directory), Buffer.from(png, 'base64'));
  }
} finally {
  await browser.close();
}
