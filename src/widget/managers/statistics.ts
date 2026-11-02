import type Original from '@appManagers/appStatisticsManager';
import {AppManager} from '@appManagers/manager';

export default class AppStatisticsManager extends AppManager implements Pick<Original, never> {}
