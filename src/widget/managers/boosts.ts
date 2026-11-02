import type Original from '@appManagers/appBoostsManager';
import {AppManager} from '@appManagers/manager';

export default class AppBoostsManager extends AppManager implements Pick<Original, never> {}
