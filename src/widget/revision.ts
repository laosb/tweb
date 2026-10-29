/** Public build identity, preserved when deployment metadata is configured. */
export function widgetRevision(doc: Document = document) {
  return doc.querySelector<HTMLMetaElement>('meta[name="blah-widget-revision"]')?.content || 'unknown';
}
