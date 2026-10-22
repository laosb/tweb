import {i18n, LangPackKey} from '@lib/langPack';

export function hostingMessage(error: unknown) {
  const {type, retryAfter} = error as {type?: string, retryAfter?: number};
  const key = type?.startsWith('BlahHosting') ? type as LangPackKey : 'BlahHostingUnreachable';
  return i18n(key, key === 'BlahHostingRateLimited' ? [String(retryAfter || 0)] : undefined);
}
