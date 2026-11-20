import type Original from '@appManagers/appPaymentsManager';
import {AppManager} from '@appManagers/manager';
import unavailable, {unavailableError} from '@/widget/managers/unavailable';

type Contract = Pick<Original, 'getCachedStarsStatus' | 'updateLocalStarsBalance' | 'getStarsStatus' | 'getStarsStatusTon' |
  'getPremiumGiftCodeOptions' | 'getPremiumPromo' | 'getPaymentForm' | 'getBankCardData' |
  'getInputInvoiceBySlug' | 'getInputInvoiceByPeerId'>;

// Blah's DC has no payments API: each of these requests fails there already, so
// settle them with its answer without the round trip. No balance is ever known,
// hence none is adjusted after a paid message (apiUpdatesManager).
export default class AppPaymentsManager extends AppManager implements Contract {
  public getCachedStarsStatus(): ReturnType<Contract['getCachedStarsStatus']> {
    return undefined;
  }

  public updateLocalStarsBalance(..._args: Parameters<Contract['updateLocalStarsBalance']>) {}

  public getStarsStatus(..._args: Parameters<Contract['getStarsStatus']>): ReturnType<Contract['getStarsStatus']> {
    return unavailable();
  }

  public getStarsStatusTon(..._args: Parameters<Contract['getStarsStatusTon']>): ReturnType<Contract['getStarsStatusTon']> {
    return unavailable();
  }

  public getPremiumGiftCodeOptions(..._args: Parameters<Contract['getPremiumGiftCodeOptions']>): ReturnType<Contract['getPremiumGiftCodeOptions']> {
    return unavailable();
  }

  public getPremiumPromo(..._args: Parameters<Contract['getPremiumPromo']>): ReturnType<Contract['getPremiumPromo']> {
    return unavailable();
  }

  public getPaymentForm(..._args: Parameters<Contract['getPaymentForm']>): ReturnType<Contract['getPaymentForm']> {
    return unavailable();
  }

  public getBankCardData(..._args: Parameters<Contract['getBankCardData']>): ReturnType<Contract['getBankCardData']> {
    return unavailable();
  }

  // Invoices render as unsupported; no invoice is ever paid from the widget.
  public getInputInvoiceBySlug(..._args: Parameters<Contract['getInputInvoiceBySlug']>): ReturnType<Contract['getInputInvoiceBySlug']> {
    throw unavailableError();
  }

  public getInputInvoiceByPeerId(..._args: Parameters<Contract['getInputInvoiceByPeerId']>): ReturnType<Contract['getInputInvoiceByPeerId']> {
    throw unavailableError();
  }
}
