import type Original from '@appManagers/appSavedMusicManager';
import {AppManager} from '@appManagers/manager';
import unavailable from '@/widget/managers/unavailable';

type Contract = Pick<Original, 'applyTopSavedMusic' | 'getMyIds' | 'isInProfile' | 'getSavedMusicByIds' |
  'saveMusic' | 'removeMusic'>;

// Profiles are hidden and the music picker and profile-music menu items are
// removed. appProfileManager still saves a full user's track document itself.
export default class AppSavedMusicManager extends AppManager implements Contract {
  public applyTopSavedMusic(..._args: Parameters<Contract['applyTopSavedMusic']>) {}

  public getMyIds(..._args: Parameters<Contract['getMyIds']>): ReturnType<Contract['getMyIds']> {
    return [];
  }

  public isInProfile(..._args: Parameters<Contract['isInProfile']>): ReturnType<Contract['isInProfile']> {
    return Promise.resolve(false);
  }

  public getSavedMusicByIds(..._args: Parameters<Contract['getSavedMusicByIds']>): ReturnType<Contract['getSavedMusicByIds']> {
    return unavailable();
  }

  public saveMusic(..._args: Parameters<Contract['saveMusic']>): ReturnType<Contract['saveMusic']> {
    return unavailable();
  }

  public removeMusic(..._args: Parameters<Contract['removeMusic']>): ReturnType<Contract['removeMusic']> {
    return unavailable();
  }
}
