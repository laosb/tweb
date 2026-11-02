import type {AppCallsManager as Original} from '@appManagers/appCallsManager';
import {AppManager} from '@appManagers/manager';

// No call controller or worker consumer remains. In particular, do not subscribe
// to ringing/signalling updates or start a call in a customer support frame.
export class AppCallsManager extends AppManager implements Pick<Original, never> {}
