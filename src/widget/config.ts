import type {BlahConfig} from '@config/blah';
import {isManagedAccountToken} from '@lib/blah/managedAccount';

export type WidgetConfig = {
  dcId: number,
  url: string,
  rsaKey: {modulus: string, exponent: string},
  apiId: number,
  apiHash: string
};

/** Workers have no document; the page hands them its validated pins in their URL. */
export const WIDGET_CONFIG_QUERY_PARAM = 'blahWidget';

export function validateConfig(config: WidgetConfig): WidgetConfig {
  const url = new URL(config.url);
  if(url.protocol !== 'wss:' || url.username || url.password || url.hash ||
    !Number.isInteger(config.dcId) || config.dcId < 1 || config.dcId > 255 ||
    !/^[89a-f][\da-f]{511}$/i.test(config.rsaKey.modulus) ||
    !/^(?:[\da-f]{2}){1,4}$/i.test(config.rsaKey.exponent) ||
    BigInt('0x' + config.rsaKey.exponent) < BigInt(3) || !(BigInt('0x' + config.rsaKey.exponent) & BigInt(1)) ||
    !Number.isInteger(config.apiId) || config.apiId < 1 || config.apiId > 0x7fffffff ||
    !/^[\da-f]{32}$/i.test(config.apiHash)) {
    throw new Error('WIDGET_CONFIG_INVALID');
  }
  return {
    dcId: config.dcId,
    url: url.href,
    rsaKey: {modulus: config.rsaKey.modulus.toLowerCase(), exponent: config.rsaKey.exponent.toLowerCase()},
    apiId: config.apiId,
    apiHash: config.apiHash
  };
}

export function readConfig(doc = document): WidgetConfig {
  const meta = (name: string) => doc.head.querySelector<HTMLMetaElement>(`meta[name="blah-widget-${name}"]`)?.content.trim() || '';
  return validateConfig({
    dcId: +meta('dc-id'),
    url: meta('dc-url'),
    rsaKey: {modulus: meta('rsa-modulus'), exponent: meta('rsa-exponent')},
    apiId: +meta('api-id'),
    apiHash: meta('api-hash')
  });
}

/** The Blah configuration of the widget build. Invalid pins leave no DC to dial. */
export function widgetBlahConfig(): BlahConfig {
  let config: WidgetConfig;
  try {
    config = typeof(document) !== 'undefined' ?
      readConfig() :
      validateConfig(JSON.parse(new URLSearchParams(self.location.search).get(WIDGET_CONFIG_QUERY_PARAM)));
  } catch{
    return {widget: {}, defaultDcId: 1, dcs: []};
  }
  return {
    widget: {param: JSON.stringify(config)},
    app: {id: config.apiId, hash: config.apiHash},
    defaultDcId: config.dcId,
    dcs: [{id: config.dcId, url: config.url, rsaKey: config.rsaKey}]
  };
}

export function readToken(hash: string): string | undefined {
  // Decode strictly: URLSearchParams alone silently repairs malformed escapes.
  try {
    decodeURIComponent(hash);
    const values = new URLSearchParams(hash.replace(/^#/, '')).getAll('token');
    if(values.length !== 1 || !isManagedAccountToken(values[0])) return;
    return values[0];
  } catch{ return; }
}
