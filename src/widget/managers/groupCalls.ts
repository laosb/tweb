import type {AppGroupCallsManager as Original} from '@appManagers/appGroupCallsManager';
import {AppManager} from '@appManagers/manager';
import makeError from '@helpers/makeError';

type Contract = Pick<Original, 'saveGroupCall' | 'getGroupCallFull' | 'createGroupCall' |
  'resolveConferenceCallPreview' | 'fetchRtmpState' | 'fetchRtmpPart' |
  'getGroupCallJoinAs' | 'saveDefaultGroupCallJoinAs'>;

export class AppGroupCallsManager extends AppManager implements Contract {
  // Profiles and service messages ingest call descriptors even though the widget
  // renders unsupported call content. Neither caller reads a call cache.
  public saveGroupCall(...[call]: Parameters<Contract['saveGroupCall']>) {
    return call;
  }

  public getGroupCallJoinAs(..._args: Parameters<Contract['getGroupCallJoinAs']>): ReturnType<Contract['getGroupCallJoinAs']> {
    return Promise.resolve({peerIds: [], defaultPeerId: this.rootScope.myId});
  }

  public saveDefaultGroupCallJoinAs(..._args: Parameters<Contract['saveDefaultGroupCallJoinAs']>): ReturnType<Contract['saveDefaultGroupCallJoinAs']> {
    return Promise.resolve();
  }

  // The inherited IM entry points and service-worker bridge still name these
  // methods. Settle them with the protocol's unavailable-call error, before any
  // request, rather than returning a descriptor their callers could dereference.
  public getGroupCallFull(..._args: Parameters<Contract['getGroupCallFull']>): ReturnType<Contract['getGroupCallFull']> {
    return Promise.reject(makeError('GROUPCALL_INVALID'));
  }

  public createGroupCall(..._args: Parameters<Contract['createGroupCall']>): ReturnType<Contract['createGroupCall']> {
    return Promise.reject(makeError('GROUPCALL_INVALID'));
  }

  public resolveConferenceCallPreview(..._args: Parameters<Contract['resolveConferenceCallPreview']>): ReturnType<Contract['resolveConferenceCallPreview']> {
    return Promise.reject(makeError('GROUPCALL_INVALID'));
  }

  public fetchRtmpState(..._args: Parameters<Contract['fetchRtmpState']>): ReturnType<Contract['fetchRtmpState']> {
    return Promise.reject(makeError('GROUPCALL_INVALID'));
  }

  public fetchRtmpPart(..._args: Parameters<Contract['fetchRtmpPart']>): ReturnType<Contract['fetchRtmpPart']> {
    return Promise.reject(makeError('GROUPCALL_INVALID'));
  }
}
