import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Test-only substitution at the pinned URLs; never imported by production builds. */
export async function localDiemRuntime(runtimeURL) {
  const directory = process.env.BLAH_DIEM_LOCAL_DIST;
  const files = new Map();
  if(directory) {
    for(const [name, contentType] of [['diem.js', 'text/javascript'], ['diem.wasm', 'application/wasm']]) {
      files.set(new URL(name, runtimeURL).href, {
        body: await readFile(join(directory, name)), contentType,
        headers: {'Access-Control-Allow-Origin': '*'}
      });
    }
  }
  return files;
}

export async function routeDiemRuntime(context, files) {
  for(const [url, response] of files) await context.route(url, route => route.fulfill(response));
}
