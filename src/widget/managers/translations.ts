import type Original from '@appManagers/appTranslationsManager';
import {AppManager} from '@appManagers/manager';
import unavailable from '@/widget/managers/unavailable';

type Contract = Pick<Original, 'hasTriedToTranslateMessage' | 'resetMessageTranslations' | 'resetPeerTranslations' |
  'resetPeerTranslationsByChannelCutoff' | 'clearSummaries' | 'refreshRichMessageTranslation' |
  'translateText' | 'translateRichMessage' | 'summarizeText'>;

// The widget offers no translation or summary (its bar is inert and none of its
// labels are retained), so no message ever has translation state to reset.
export default class AppTranslationsManager extends AppManager implements Contract {
  public hasTriedToTranslateMessage(..._args: Parameters<Contract['hasTriedToTranslateMessage']>) {
    return false;
  }

  public resetMessageTranslations(..._args: Parameters<Contract['resetMessageTranslations']>) {}

  public resetPeerTranslations(..._args: Parameters<Contract['resetPeerTranslations']>) {}

  public resetPeerTranslationsByChannelCutoff(..._args: Parameters<Contract['resetPeerTranslationsByChannelCutoff']>) {
    return new Set<number>();
  }

  public clearSummaries(..._args: Parameters<Contract['clearSummaries']>) {}

  public refreshRichMessageTranslation(..._args: Parameters<Contract['refreshRichMessageTranslation']>): ReturnType<Contract['refreshRichMessageTranslation']> {
    return unavailable();
  }

  // Only the page calls these, across the worker port, which carries the outcome
  // rather than the cancellable promise itself.
  public translateText(..._args: Parameters<Contract['translateText']>) {
    return unavailable() as ReturnType<Contract['translateText']>;
  }

  public translateRichMessage(..._args: Parameters<Contract['translateRichMessage']>) {
    return unavailable() as ReturnType<Contract['translateRichMessage']>;
  }

  public summarizeText(..._args: Parameters<Contract['summarizeText']>): ReturnType<Contract['summarizeText']> {
    return unavailable();
  }
}
