// Only amount strings in unreachable payment/service branches remain. No UI or tables.
export default function currencyAmount(amount: number | string) { return String(amount); }
export {GRAM_CURRENCY_SYMBOL, formatNanoton, nanotonToJsNumber, parseNanotonFromDecimal} from '@helpers/nanoton';
