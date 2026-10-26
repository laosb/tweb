import {ensureBlahConfig, getBlahConfig} from '@config/blah';
import type {ApiManager} from '@appManagers/apiManager';
import type {AuthLoginToken} from '@layer';
import type {DeviceLinkSession} from '@blahdiem/diem';
import type {BlahInvokeOptions} from '@lib/blah/invoke';
import type {DeviceLinkRequest, DeviceLinkResult} from '@lib/blah/deviceLinkTypes';
import {diemClient} from '@lib/blah/runtime';
import {respondToLinkedDevice, certifyLinkedDevice, installLinkedIdentity, linkedAccountIdentity, publicationPending, withIdentity} from '@lib/blah/identity';
import {decode} from '@lib/blah/vault';
import bytesFromHex from '@helpers/bytes/bytesFromHex';
import bytesCmp from '@helpers/bytes/bytesCmp';
import pause from '@helpers/schedulers/pause';

type NewLink = {
  request: Uint8Array,
  parameter: string,
  session: DeviceLinkSession,
  token?: Extract<AuthLoginToken, {_: 'auth.loginToken'}>,
  opened?: Uint8Array,
  exceptIds: UserId[]
};
type Approval = {token: Uint8Array, parameter: string, request: Uint8Array, device: Uint8Array, id: string,
  transferIdentity?: boolean, manualPublication?: boolean, profile?: number[], response?: Uint8Array};
type Attempt = {slot: number, timer: ReturnType<typeof setTimeout>, cancelled: boolean, next?: NewLink, approval?: Approval};
const attempts = new Map<string, Attempt>();
const operations = new Map<string, Promise<DeviceLinkResult>>();

export function parseDeviceLink(link: string) {
  if(link.length > 8192) throw {type: 'DEVICE_LINK_INVALID'};
  let url: URL;
  try { url = new URL(link.trim()); } catch{ throw {type: 'DEVICE_LINK_INVALID'}; }
  if(url.protocol !== 'tg:' || url.hostname !== 'login' || url.username || url.password || url.port ||
    (url.pathname && url.pathname !== '/') || url.hash) throw {type: 'DEVICE_LINK_INVALID'};
  const parameter = url.searchParams.get('blah');
  if(!parameter) throw {type: 'BLAH_LINK_REQUIRED'};
  const token = url.searchParams.get('token');
  if(url.searchParams.getAll('token').length !== 1 || url.searchParams.getAll('blah').length !== 1 ||
    !/^[A-Za-z0-9_-]{43}$/.test(token || '') || !/^[A-Za-z0-9_-]+$/.test(parameter)) throw {type: 'DEVICE_LINK_INVALID'};
  return {token: decode(token), parameter};
}

function cancel(key: string) {
  const attempt = attempts.get(key);
  if(!attempt) return;
  attempt.cancelled = true;
  clearTimeout(attempt.timer);
  attempt.next?.session.destroy();
  attempt.next?.opened?.fill(0);
  attempts.delete(key);
}

/** One worker-owned attempt; private link keys never cross the manager proxy. */
export function deviceLinkAction(slot: number, api: ApiManager, request: DeviceLinkRequest, serverTimeOffset = 0): Promise<DeviceLinkResult> {
  const key = `${slot}:${request.attempt}`;
  if(request.action === 'cancel') { cancel(key); return Promise.resolve({}); }
  if(operations.has(key)) return operations.get(key);
  if(request.action === 'begin' || request.action === 'inspect') {
    cancel(key);
    attempts.set(key, {slot, cancelled: false, timer: setTimeout(() => cancel(key), 10 * 60_000)});
  }
  const attempt = attempts.get(key);
  if(attempt) {
    clearTimeout(attempt.timer);
    attempt.timer = setTimeout(() => cancel(key), 10 * 60_000);
  }
  const operation = run(slot, api, request, key, serverTimeOffset, attempt).catch((error) => {
    if(request.action === 'begin' || request.action === 'inspect') cancel(key);
    throw error;
  }).finally(() => operations.delete(key));
  operations.set(key, operation);
  return operation;
}

async function run(slot: number, api: ApiManager, request: DeviceLinkRequest, key: string, serverTimeOffset: number, attempt: Attempt): Promise<DeviceLinkResult> {
  await ensureBlahConfig(slot);
  if(!getBlahConfig(slot)?.home) throw {type: 'DEVICE_LINK_INVALID'};
  const alive = () => !!attempt && attempts.get(key) === attempt && !attempt.cancelled;
  const check = () => { if(!alive()) throw {type: 'BLAH_LINK_CANCELLED'}; };
  check();
  const client = await diemClient();
  const {default: App} = await import('@config/app');
  check();
  const options: BlahInvokeOptions = {ignoreErrors: true, rawError: true};
  const exportToken = (next: NewLink, initial: boolean) => api.invokeApi('auth.exportLoginToken', {
    api_id: App.id, api_hash: App.hash, except_ids: next.exceptIds
  }, {...options, ...(initial ? {blahDeviceLink: next.request} : {})} as BlahInvokeOptions);
  if(request.action === 'begin') {
    const next = await client.deviceLink.begin(request.label);
    if(!alive()) { next.session.destroy(); check(); }
    attempt.next = {...next, exceptIds: request.exceptIds};
    const token = await exportToken(attempt.next, true);
    check();
    if(token._ !== 'auth.loginToken') { cancel(key); throw {type: 'DEVICE_LINK_INVALID'}; }
    attempt.next.token = token;
    return {loginToken: token, parameter: next.parameter};
  }
  if(request.action === 'poll') {
    const next = attempt.next;
    if(!next?.token) throw {type: 'DEVICE_LINK_INVALID'};
    if(next.opened) return {needsPassword: true};
    try {
      const result = await api.invokeApi('blah.getDeviceLink', {token: new Uint8Array(next.token.token)}, options);
      check();
      if(result.response) {
        try {
          const opened = await client.deviceLink.open(next.session, new Uint8Array(result.response), bytesFromHex(getBlahConfig(slot).home.identity));
          if(!alive()) { opened.keyFileContents.fill(0); check(); }
          next.opened = opened.keyFileContents;
          return {needsPassword: true};
        } catch(error) { cancel(key); throw error; }
      }
    } catch(error) {
      if((error as {type?: string}).type !== 'LOGIN_TOKEN_EXPIRED') throw error;
    }
    check();
    if(next.token.expires <= Date.now() / 1000 + serverTimeOffset) {
      const token = await exportToken(next, true);
      check();
      if(token._ !== 'auth.loginToken') { cancel(key); throw {type: 'DEVICE_LINK_INVALID'}; }
      next.token = token;
    }
    return {loginToken: next.token, parameter: next.parameter};
  }
  if(request.action === 'complete') {
    const next = attempt.next;
    if(!next?.opened || !request.password) throw {type: 'DEVICE_LINK_INVALID'};
    await installLinkedIdentity(slot, next.opened, request.password, alive);
    check();
    next.opened.fill(0);
    next.opened = undefined;
    try {
      const loginToken = await exportToken(next, false);
      check();
      if(loginToken._ !== 'auth.loginTokenSuccess') throw {type: 'DEVICE_LINK_INVALID'};
      return {loginToken};
    } finally { cancel(key); }
  }
  if(request.action === 'inspect') {
    const {token, parameter} = parseDeviceLink(request.link);
    const result = await api.invokeApi('blah.getDeviceLink', {token}, options);
    check();
    const inspected = await client.deviceLink.inspect(parameter, new Uint8Array(result.request));
    // Browser identities and their current signers are Ed25519 (Diem algorithm 1).
    if(!inspected.verifies.includes(1)) throw {type: 'BLAH_LINK_ALGORITHM'};
    const identity = await linkedAccountIdentity(slot, request.id);
    check();
    attempt.approval = {token, parameter, request: new Uint8Array(result.request), device: inspected.device, id: identity.id};
    return {label: inspected.label, id: identity.id, domain: identity.domain, unlocked: identity.unlocked};
  }
  const approval = attempt.approval;
  if(!approval) throw {type: 'DEVICE_LINK_INVALID'};
  if(request.action === 'prepare') {
    // A retry can change the transfer checkbox; never reuse the previous grant.
    approval.response = undefined;
    approval.profile = undefined;
    approval.manualPublication = undefined;
    approval.transferIdentity = request.transferIdentity;
    const result = await certifyLinkedDevice(slot, approval.id, approval.device);
    check();
    approval.profile = result.identity.profile;
    approval.manualPublication = result.manualPublication;
    return result;
  }
  if(request.action === 'accept') {
    if(!approval.profile) throw {type: 'DEVICE_LINK_INVALID'};
    if(!approval.response) {
      // Do the host read outside the custody lock, then recheck the signed revision.
      if(approval.manualPublication) {
        const domain = await withIdentity(slot, async(secret) => secret.domain, true, false);
        if(await publicationPending([domain], approval.profile)) throw {type: 'DEVICE_LINK_PROFILE_STALE'};
        check();
      }
      await withIdentity(slot, async(secret, info, save) => {
        if(info.id !== approval.id || !bytesCmp(info.profile, approval.profile)) throw {type: 'BLAH_LINK_PROFILE_CHANGED'};
        check();
        await save(info, false);
        approval.response = await respondToLinkedDevice(slot, {parameter: approval.parameter, request: approval.request,
          profile: new Uint8Array(info.profile), domain: secret.domain, transferIdentity: approval.transferIdentity});
      }, true, false);
    }
    for(const delay of [0, 1000, 2000, 4000, 8000, 15000]) {
      if(delay) await pause(delay);
      check();
      try {
        await api.invokeApi('auth.acceptLoginToken', {token: approval.token}, {...options, blahDeviceLink: approval.response} as BlahInvokeOptions);
        check();
        cancel(key);
        return {};
      } catch(error) {
        const type = (error as {type?: string}).type;
        if(type !== 'DEVICE_LINK_PROFILE_STALE') {
          if(type === 'LOGIN_TOKEN_EXPIRED' || type === 'LOGIN_TOKEN_INVALID') cancel(key);
          throw error;
        }
      }
    }
    throw {type: 'DEVICE_LINK_PROFILE_STALE'};
  }
  throw {type: 'DEVICE_LINK_INVALID'};
}
