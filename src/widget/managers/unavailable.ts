import makeError from '@helpers/makeError';

// Blah's DC answers a method outside its schema (payments, stories) with this
// error. Replaced managers settle feature entry points the widget never offers
// with it, before any request, rather than with a value a caller could mistake
// for real data.
export const unavailableError = () => makeError('METHOD_NOT_FOUND' as ErrorType);

export default function unavailable(): Promise<never> {
  return Promise.reject(unavailableError());
}
