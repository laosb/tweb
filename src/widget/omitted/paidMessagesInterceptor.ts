// The support conversation has no paid sends. Callers still compare this exact symbol.
export const PAYMENT_REJECTED = Symbol('Payment rejected');

export default class WidgetPaidMessagesInterceptor {
  constructor(..._args: unknown[]) {}
  static PaymentRejectedSymbol = PAYMENT_REJECTED;
  static prepareStarsForPayment(..._args: unknown[]) { return Promise.resolve(undefined); }
  prepareStarsForPayment(..._args: unknown[]) { return Promise.resolve(undefined); }
  dispose() {}
}
