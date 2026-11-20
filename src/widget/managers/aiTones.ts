import type {AiTonesManager as Original} from '@appManagers/aiTonesManager';
import {AppManager} from '@appManagers/manager';
import unavailable from '@/widget/managers/unavailable';

type Contract = Pick<Original, 'composeMessageWithAi' | 'getTones' | 'getToneBySlug'>;

// The AI editor and send styles are inert in the widget and AI style links do nothing.
export class AiTonesManager extends AppManager implements Contract {
  public composeMessageWithAi(..._args: Parameters<Contract['composeMessageWithAi']>): ReturnType<Contract['composeMessageWithAi']> {
    return unavailable();
  }

  public getTones(..._args: Parameters<Contract['getTones']>): ReturnType<Contract['getTones']> {
    return unavailable();
  }

  public getToneBySlug(..._args: Parameters<Contract['getToneBySlug']>): ReturnType<Contract['getToneBySlug']> {
    return unavailable();
  }
}
