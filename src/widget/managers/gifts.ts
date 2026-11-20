import type Original from '@appManagers/appGiftsManager';
import {AppManager} from '@appManagers/manager';
import getUniqueGiftAttributes from '@appManagers/utils/gifts/getUniqueGiftAttributes';
import unavailable from '@/widget/managers/unavailable';

type Contract = Pick<Original, 'wrapGift' | 'wrapGiftFromMessage' | 'wrapGiftFromWebPage' | 'getGiftBySlug'>;

// Gift messages, previews and collectible statuses render as unsupported, and
// Blah's DC has no payments API. Keep no gift updates or wear state.
export default class AppGiftsManager extends AppManager implements Contract {
  // A collectible chat theme (appThemesManager.saveChatTheme) still ingests the
  // gift's documents with their normal file references.
  public wrapGift(...[gift]: Parameters<Contract['wrapGift']>): ReturnType<Contract['wrapGift']> {
    if(gift._ === 'starGift') {
      return {type: 'stargift', raw: gift, sticker: this.appDocsManager.saveDoc(gift.sticker)};
    }

    const {model, pattern} = getUniqueGiftAttributes(gift);
    if(pattern) pattern.document = this.appDocsManager.saveDoc(pattern.document);
    const sticker = model && this.appDocsManager.saveDoc(model.document);
    if(model) model.document = sticker;
    return {type: 'stargift', raw: gift, sticker};
  }

  public wrapGiftFromMessage(..._args: Parameters<Contract['wrapGiftFromMessage']>): ReturnType<Contract['wrapGiftFromMessage']> {
    return unavailable();
  }

  public wrapGiftFromWebPage(..._args: Parameters<Contract['wrapGiftFromWebPage']>): ReturnType<Contract['wrapGiftFromWebPage']> {
    return unavailable();
  }

  public getGiftBySlug(..._args: Parameters<Contract['getGiftBySlug']>): ReturnType<Contract['getGiftBySlug']> {
    return unavailable();
  }
}
