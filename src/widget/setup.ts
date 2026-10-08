import {dcDomain, fetchDCProfile, profileConfig} from '@lib/blah/discovery';
import {validateConfig, type WidgetConfig} from '@/widget/config';

// `schemes` fields take a light and a dark value; the others apply to both.
export const themeFields = [
  {name: 'surface-color', label: 'Header and composer', property: 'color', schemes: true},
  {name: 'text-color', label: 'Header text', property: 'color', schemes: true},
  {name: 'chat-background-color', label: 'Chat background', property: 'color', schemes: true},
  {name: 'accent-color', label: 'Accent', property: 'color', schemes: true},
  {name: 'incoming-bubble-color', label: 'Support bubble', property: 'color', schemes: true},
  {name: 'incoming-text-color', label: 'Support text', property: 'color', schemes: true},
  {name: 'outgoing-bubble-color', label: 'Customer bubble', property: 'color', schemes: true},
  {name: 'outgoing-text-color', label: 'Customer text', property: 'color', schemes: true},
  {name: 'bubble-radius', label: 'Bubble radius', property: 'border-radius', schemes: false},
  {name: 'incoming-bubble-radius', label: 'Support bubble radius', property: 'border-radius', schemes: false},
  {name: 'outgoing-bubble-radius', label: 'Customer bubble radius', property: 'border-radius', schemes: false},
  {name: 'chat-background-image', label: 'Background image', property: 'background-image', schemes: true},
  {name: 'chat-background-size', label: 'Background image size', property: 'background-size', schemes: false}
] as const;

type ThemeFieldName = typeof themeFields[number]['name'];
/** Light (or shared) values by field name; dark values under `<name>:dark`. */
export type WidgetTheme = Partial<Record<ThemeFieldName | `${ThemeFieldName}:dark`, string>>;

export function themeDeclarations(theme: WidgetTheme, scheme: 'light' | 'dark' = 'light', shared?: boolean) {
  return themeFields.flatMap(({name, property, label, schemes}) => {
    if(shared !== undefined && shared === schemes) return [];
    const value = theme[(scheme === 'dark' ? `${name}:dark` : name) as keyof WidgetTheme]?.trim();
    if(!value) return [];
    // These values will be serialized inside a raw-text HTML style element.
    if(/[<>{};]/.test(value) || !CSS.supports(property, value)) {
      throw new Error(`Enter a valid CSS value for ${label.toLowerCase()}.`);
    }
    return [`--widget-${name}: ${value};`];
  }).join('\n');
}

/** Dark values follow the client's `night` class, i.e. the system scheme. A blank one keeps the dark default. */
export function themeStylesheet(theme: WidgetTheme) {
  return [
    [':root', themeDeclarations(theme, 'light', true)],
    [':root:not(.night)', themeDeclarations(theme, 'light', false)],
    [':root.night', themeDeclarations(theme, 'dark', false)]
  ].filter(([, body]) => body).map(([selector, body]) => `${selector} {\n${body}\n}`).join('\n');
}

export async function discoverWidgetDC(input: string) {
  const domain = dcDomain(input);
  const {config, version} = await profileConfig(domain, await fetchDCProfile(domain));
  return {domain, dc: config.dcs[0], version};
}

/** Keep the built entry's asset URLs intact; only deployment metadata and theme change. */
export function generateWidgetIndex(template: string, input: WidgetConfig, theme: WidgetTheme) {
  const config = validateConfig(input);
  const doc = new DOMParser().parseFromString(template, 'text/html');
  if(!doc.querySelector('#widget') || !doc.querySelector('script[type="module"][src]')) {
    throw new Error('Could not load the widget index.html. Serve setup.html alongside the released index.html and assets.');
  }
  const values = {
    'dc-id': config.dcId, 'dc-url': config.url, 'rsa-modulus': config.rsaKey.modulus,
    'rsa-exponent': config.rsaKey.exponent, 'api-id': config.apiId, 'api-hash': config.apiHash
  };
  for(const [name, value] of Object.entries(values)) {
    doc.head.querySelectorAll(`meta[name="blah-widget-${name}"]`).forEach((node) => node.remove());
    const meta = doc.createElement('meta');
    meta.name = 'blah-widget-' + name;
    meta.content = String(value);
    doc.head.append(meta);
  }
  doc.querySelectorAll('#blah-widget-theme').forEach((node) => node.remove());
  const style = doc.createElement('style');
  style.id = 'blah-widget-theme';
  style.textContent = themeStylesheet(theme);
  doc.head.append(style);
  return '<!doctype html>\n' + doc.documentElement.outerHTML + '\n';
}
