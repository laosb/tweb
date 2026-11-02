import type Original from '@appManagers/appWalletManager';
import {AppManager} from '@appManagers/manager';

type Contract = Pick<Original, 'saveWalletAddress'>;

export default class AppWalletManager extends AppManager implements Contract {
  // Full profiles carry wallet metadata; the support widget neither stores it nor resolves owners.
  public saveWalletAddress(..._args: Parameters<Contract['saveWalletAddress']>): ReturnType<Contract['saveWalletAddress']> { return Promise.resolve(); }
}
