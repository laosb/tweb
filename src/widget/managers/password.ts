import type {PasswordManager as Original} from '@appManagers/passwordManager';
import {AppManager} from '@appManagers/manager';
import unavailable from '@/widget/managers/unavailable';

type Contract = Pick<Original, 'getState'>;

// The URL token is the only credential: there is no 2FA setup, and the links
// that would read the password state do nothing in the widget.
export class PasswordManager extends AppManager implements Contract {
  public getState(): ReturnType<Contract['getState']> {
    return unavailable();
  }
}
