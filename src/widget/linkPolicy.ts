import matchTelegramUrlHost, {matchUrlHost, TELESCOPE_LINK_HOST} from '@lib/richTextProcessor/matchTelegramUrlHost';

export function isWidgetExternalUrl(href: string) {
  try {
    const url = new URL(href);
    // Check the host even when userinfo would make the upstream matcher refuse it.
    const host = new URL(url.origin);
    // URL normalizes case/IDNs, but preserves the absolute DNS name's final dot.
    host.hostname = host.hostname.replace(/\.+$/, '');
    return ['http:', 'https:'].includes(url.protocol) && !matchTelegramUrlHost(host) &&
      !matchUrlHost(host, [TELESCOPE_LINK_HOST]);
  } catch(err) {
    return false;
  }
}

export function allowsWidgetAnchor(name: string, protocol: string, href: string) {
  if(name === 'setMediaTimestamp') return true;
  if(name === 'showMaskedAlert') return isWidgetExternalUrl(href) || /^(tel:|mailto:)/i.test(href);
  // These callbacks only parse; the checked message handlers below decide identity.
  return !protocol && name === 'im' || protocol === 'tg' && (name === 'resolve' || name === 'privatepost');
}

