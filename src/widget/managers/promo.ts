import type Original from '@appManagers/appPromoManager';
import {AppManager} from '@appManagers/manager';

// No widget page or worker module consumes promo data, suggestions or birthdays.
export default class AppPromoManager extends AppManager implements Pick<Original, never> {}
