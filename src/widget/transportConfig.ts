import type {BlahConfig} from '@/config/blah';
import type {WidgetConfig} from '@/widget/config';

// Vite aliases only the widget's @config/blah import to this adapter. The
// upstream authorizer, RSA selection and socket transport stay unchanged.
const blah: BlahConfig = {defaultDcId: 1, dcs: []};
export default blah;
export function configureTransport(config: WidgetConfig) {
  blah.defaultDcId = config.dcId;
  blah.dcs = [{id: config.dcId, url: config.url, rsaKey: config.rsaKey}];
}
export function getBlahConfig() { return blah; }
export async function ensureBlahConfig() {}
export function getBlahDc(dcId: number) {
  const dc = blah.dcs.find(({id}) => id === dcId);
  if(!dc) throw new Error('WIDGET_DC_MISMATCH');
  return dc;
}
