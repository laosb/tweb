import {DEFAULT_RENEWAL, renewalDue, renewalPolicy} from '@lib/blah/renewal';
import type {IdentityInfo} from '@lib/blah/wasm';

const info = (notBefore: number, expiresAt: number, devices: {notBefore: number, expiresAt: number}[] = []) => ({
  notBefore, expiresAt, devices
} as IdentityInfo);

it('defaults to 180 days with automatic renewal, without sharing mutable settings', () => {
  const policy = renewalPolicy();
  expect(policy).toEqual({profileDays: 180, deviceDays: 180, autoRenew: true});
  policy.autoRenew = false;
  expect(DEFAULT_RENEWAL.autoRenew).toBe(true);
});

it('renews at exactly 80% of either signed validity interval, including older imports', () => {
  expect(renewalDue(info(100, 200), 179)).toBe(false);
  expect(renewalDue(info(100, 200), 180)).toBe(true);
  expect(renewalDue(info(100, 300, [{notBefore: 0, expiresAt: 200}]), 160)).toBe(true);
  expect(renewalDue(info(100, 300, [{notBefore: 0, expiresAt: 200}]), 159)).toBe(false);
  expect(renewalDue(info(100, 200), 250)).toBe(true);
});

it('allows independent validity periods and opting out, but rejects unsafe or inconsistent settings', () => {
  expect(renewalPolicy({profileDays: 30, deviceDays: 180, autoRenew: false}).autoRenew).toBe(false);
  for(const change of [{profileDays: 0}, {profileDays: 1.5}, {deviceDays: 179}, {deviceDays: Infinity}, {deviceDays: Number.MAX_SAFE_INTEGER}]) {
    expect(() => renewalPolicy({...DEFAULT_RENEWAL, ...change})).toThrow();
  }
});
