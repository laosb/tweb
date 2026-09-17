import type {DcId} from '@types';
import blah from '@config/blah';
import {MAX_DC_ID} from '@config/dc';

// * Telegram has five DCs, its test servers three; Blah takes its range from `@config/dc`
const TEST_DC_COUNT = 3;

/** a DC the client connects to: one of the active backend's, or of the test servers' when `test` */
export default function isValidDcId(dcId: DcId, test?: boolean) {
  const id = +dcId;
  return Number.isInteger(id) && id >= 1 && id <= (test && !blah ? TEST_DC_COUNT : MAX_DC_ID);
}
