import MagicString from 'magic-string';
import omitted from '../src/widget/omittedSchema.json';

// These APIs have no producer or caller on the widget's pinned Blah DC. In
// particular it rebuilds received messages/replies; it does not relay Wallet
// constructors from Telegram. Never prune a field of a supported wire payload.
export function pruneWidgetSchema(source: string) {
  const prefix = 'export default ';
  const start = source.indexOf(prefix) + prefix.length;
  const end = source.indexOf(' as {', start);
  if(start < prefix.length || end < start) throw new Error('WIDGET_SCHEMA_TARGET_CHANGED');
  const schema = JSON.parse(source.slice(start, end));
  const found = new Set<string>();
  for(const kind of ['constructors', 'methods'] as const) {
    const excluded = new Set<string>(omitted[kind]);
    schema.API[kind] = schema.API[kind].filter((entry: any) => {
      const name = entry.predicate || entry.method;
      if(excluded.has(name)) {
        if(found.has(name)) throw new Error('WIDGET_SCHEMA_TARGET_CHANGED: duplicate ' + name);
        found.add(name);
        return false;
      }
      const params = omitted.params[name as keyof typeof omitted.params] as string[];
      if(params) {
        for(const param of params) {
          if(entry.params.filter((item: any) => item.name === param).length !== 1) throw new Error('WIDGET_SCHEMA_TARGET_CHANGED: ' + name + '.' + param);
        }
        entry.params = entry.params.filter((item: any) => !params.includes(item.name));
        found.add(name);
      }
      return true;
    });
  }
  const expected = [...omitted.constructors, ...omitted.methods, ...Object.keys(omitted.params)];
  if(expected.some(name => !found.has(name))) throw new Error('WIDGET_SCHEMA_TARGET_CHANGED: missing ' + expected.filter(name => !found.has(name)).join(', '));
  return new MagicString(source).overwrite(start, end, JSON.stringify(schema));
}
