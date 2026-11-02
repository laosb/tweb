/** Only the RTMP entry may be replaced; ordinary streaming and SW lifecycle stay. */
export function assertWidgetServiceWorkerModules(paths: string[]) {
  if(!paths.includes('src/lib/serviceWorker/index.service.ts')) return;
  const forbidden = paths.filter(path => /^src\/(?:lib\/rtmp\/|vendor\/opus\/)/.test(path));
  if(forbidden.length) throw new Error('widget SW contains RTMP codecs: ' + forbidden.join(', '));
  for(const name of ['stream', 'download', 'cache', 'clearOldCache']) {
    if(!paths.includes(`src/lib/serviceWorker/${name}.ts`)) {
      throw new Error('widget SW lost ordinary ' + name);
    }
  }
}
