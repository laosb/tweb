import type {HostingPlanName} from '@blahdiem/diem';
import {diemClient} from '@lib/blah/runtime';
import {profileDomain} from '@lib/blah/profile';
import {stored} from '@lib/blah/vault';

/** Public, origin-local claim state. Never part of the sealed signing secret. */
export type HostedNames = {
  domain: string,
  held: string[],
  proofs: Record<string, number[]>,
  unclaimed?: string,
  // Written before PUT. An unanswered request must be replayed before a newer revision.
  pending?: {profile: number[], via: string, labels: string[]}
};

export function hostedLabels(domain: string, domains: string[]) {
  const suffix = '.' + domain;
  return domains.filter((name) => name.endsWith(suffix) && !name.slice(0, -suffix.length).includes('.'))
    .map((name) => name.slice(0, -suffix.length));
}

export async function hostingAPI() {
  const api = (await diemClient()).hosting;
  if(!api) throw {type: 'BlahHostingUnavailable'};
  return api;
}

export async function hostingCall<T>(call: () => Promise<T>): Promise<T> {
  try { return await call(); } catch(error) {
    const {type, code, retryAfter} = error as {type?: string, code?: string, retryAfter?: number};
    if(type?.startsWith('Blah')) throw error;
    const keys: Record<string, string> = {
      'name-taken': 'BlahHostingTaken', nameTaken: 'BlahHostingTaken',
      'rate-limited': 'BlahHostingRateLimited', 'too-many-claims': 'BlahHostingTooMany',
      'invalid-label': 'BlahHostingInvalid', invalidLabel: 'BlahHostingInvalid', invalidDomain: 'BlahHostingInvalid',
      noHostedName: 'BlahHostingInvalid', hostNotListed: 'BlahHostingInvalid',
      'host-not-listed': 'BlahHostingInvalid',
      invalidProof: 'BlahHostingProofFailed', 'proof-required': 'BlahHostingProofFailed',
      unsolvable: 'BlahHostingProofFailed', unsupportedAlgorithm: 'BlahHostingProofFailed',
      'stale-revision': 'BlahHostingStale', cancelled: 'BlahHostingCancelled',
      domainMismatch: 'BlahHostingDomainMismatch',
      publishedMismatch: 'BlahHostingRejected', invalidResponse: 'BlahHostingRejected',
      unexpectedStatus: 'BlahHostingRejected', tooLarge: 'BlahHostingRejected'
    };
    throw {type: keys[code || type] || (type === 'hostingProblem' ? 'BlahHostingRejected' : 'BlahHostingUnreachable'), retryAfter: retryAfter ?? 0};
  }
}

export async function planHostedName(domain: string, label: string, id: string): Promise<HostingPlanName> {
  try { domain = profileDomain(domain); } catch{ throw {type: 'BlahHostingInvalid'}; }
  return hostingCall(async() => (await (await hostingAPI()).plan(domain, [label], id))[0]);
}

/** Caller serializes custody. Public metadata advances only after an acknowledged PUT. */
export async function publishHosted(id: string, profile: number[], domains: string[]): Promise<boolean> {
  let state = await stored<HostedNames>('hosting:' + id);
  if(!state) return false;
  const desired = hostedLabels(state.domain, domains);
  if(!desired.length && !state.held.length && !state.pending) return false;
  await hostingCall(async() => {
    const api = await hostingAPI();
    async function acknowledged(labels: string[]) {
      state = {...state, held: labels, unclaimed: undefined, pending: undefined};
      await stored('hosting:' + id, state);
    }
    async function send() {
      try {
        const proofs = Object.fromEntries(Object.entries(state.proofs).filter(([label]) => state.pending.labels.includes(label) && !state.held.includes(label)));
        const result = await api.publish(state.domain, state.pending.profile, {via: state.pending.via, proofs});
        await acknowledged(hostedLabels(state.domain, result.domains));
      } catch(error) {
        // A completed final release has no held route for its idempotent retry.
        // Reconcile all previously held names through the native planner first.
        const problem = error as {type?: string, code?: string, labels?: {label: string}[]};
        if(problem.type === 'hostingProblem' && problem.code === 'proof-required') {
          state = {...state, held: state.held.filter((label) => !problem.labels?.some((entry) => entry.label === label))};
        }
        if(problem.type === 'hostingProblem' && problem.code === 'host-not-listed' &&
          !state.pending.labels.length && state.held.length) {
          const names = await api.plan(state.domain, state.held, id);
          if(names.every((name) => name.status !== 'held')) { await acknowledged([]); return; }
        }
        // A definite refusal permits a corrected revision. Transport failures retain exact bytes.
        if(['hostingProblem', 'invalidProof', 'invalidLabel', 'noHostedName', 'hostNotListed', 'domainMismatch',
          'unsolvable', 'unsupportedAlgorithm'].includes((error as {type?: string}).type)) {
          state = {...state, pending: undefined};
          await stored('hosting:' + id, state);
        }
        throw error;
      }
    }
    if(state.pending) {
      const previous = state.pending.profile;
      await send();
      if(previous.length === profile.length && previous.every((byte, index) => byte === profile[index])) return;
    }
    const via = desired.find((label) => state.held.includes(label)) || desired[0] || state.held[0];
    if(!via) return;
    state = {...state, pending: {profile, via, labels: desired}};
    await stored('hosting:' + id, state);
    await send();
  });
  return true;
}
