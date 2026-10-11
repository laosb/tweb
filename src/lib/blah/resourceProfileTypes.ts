import type {InputChannel, InputStickerSet, InputUser} from '@layer';
import type {ProfileInfo} from '@blahdiem/diem';

export type ResourceIdentity = Pick<ProfileInfo, 'domains' | 'lapsed' | 'kind'> & {identityId: string};
export type VerifiedPeerResourceProfile = {
  status: 'present',
  identity: ResourceIdentity
} | Extract<PeerResourceProfile, {status: 'missing'}>;

/** Exact signed CBOR from the DC. Presence alone does not authenticate its domains. */
export type ResourceProfile = {_: 'blah.resourceProfile', id: string, profile: Uint8Array};
export type PeerResourceProfile = {
  status: 'present',
  profile: ResourceProfile
} | {
  status: 'missing',
  homeDomain: string
};

declare module '@layer' {
  interface MethodDeclMap {
    'blah.getUserProfile': {req: {id: InputUser[]}, res: ResourceProfile[]},
    'blah.getChannelProfile': {req: {id: InputChannel[]}, res: ResourceProfile[]},
    'blah.getStickerSetProfile': {req: {id: InputStickerSet[]}, res: ResourceProfile[]}
  }
}
