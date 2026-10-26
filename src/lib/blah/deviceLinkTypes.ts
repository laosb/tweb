import type {AuthLoginToken} from '@layer';
import type {IdentityView} from '@lib/blah/identity';

export type DeviceLinkRequest =
  {action: 'begin', attempt: string, label: string, exceptIds: UserId[]} |
  {action: 'poll', attempt: string} |
  {action: 'complete', attempt: string, password: string} |
  {action: 'cancel', attempt: string} |
  {action: 'inspect', attempt: string, link: string, id?: string} |
  {action: 'prepare', attempt: string, transferIdentity: boolean} |
  {action: 'accept', attempt: string};

export type DeviceLinkResult = {
  loginToken?: AuthLoginToken,
  parameter?: string,
  needsPassword?: boolean,
  label?: string,
  id?: string,
  domain?: string,
  unlocked?: boolean,
  identity?: IdentityView,
  manualPublication?: boolean
};

export type DeviceLink = {_: 'blah.deviceLink', request: Uint8Array, response?: Uint8Array};
declare module '@layer' {
  interface MethodDeclMap {
    'blah.getDeviceLink': {req: {token: Uint8Array}, res: DeviceLink}
  }
}
