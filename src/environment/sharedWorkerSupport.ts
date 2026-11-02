import Modes from '@config/modes';
import {IS_SAFARI} from '@environment/userAgent';

// Safari SharedWorkers cannot structured-clone CryptoKeys for identity custody.
const IS_SHARED_WORKER_SUPPORTED = typeof(SharedWorker) !== 'undefined' && !IS_SAFARI && !Modes.noSharedWorker/*  && false */;

export default IS_SHARED_WORKER_SUPPORTED;
