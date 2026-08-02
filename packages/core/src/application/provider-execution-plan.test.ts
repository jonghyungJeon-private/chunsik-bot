import { describe, expect, it } from 'vitest';
import { Capability } from '../domain';
import {
  ProviderSelectionDecision,
  RoutingReasonCode,
  policyId,
  providerId,
  validationProfileId,
} from './provider-routing-contracts';
import {
  ProviderExecutionPlanError,
  ProviderExecutionPlanner,
} from './provider-execution-plan';

const SELECTED: ProviderSelectionDecision = {
  selectedProviderId: providerId('provider-a'),
  eligibleProviderIds: [providerId('provider-a'), providerId('provider-b')],
  matchedPolicyId: policyId('balanced-v1'),
  reasonCode: RoutingReasonCode.SELECTED,
  policyVersion: 'policy-v1',
  registryVersion: 'registry-v1',
  configurationDigest: 'a'.repeat(64),
};

describe('ProviderExecutionPlanner', () => {
  it('creates the immutable single-attempt handoff between selection and execution', () => {
    const plan = new ProviderExecutionPlanner().create(SELECTED, {
      capability: Capability.GENERAL_CHAT,
      validationProfile: validationProfileId('general-chat-v1'),
    });

    expect(plan).toEqual({
      selectedProviderId: 'provider-a',
      executionOrder: ['provider-a'],
      attemptBudget: 1,
      overallDeadlineMs: null,
      capability: Capability.GENERAL_CHAT,
      validationProfile: 'general-chat-v1',
      fallbackEligible: false,
      escalationEligible: false,
      matchedPolicyId: 'balanced-v1',
      policyVersion: 'policy-v1',
      registryVersion: 'registry-v1',
      configurationDigest: 'a'.repeat(64),
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.executionOrder)).toBe(true);
  });

  it('rejects no-selection decisions', () => {
    const planner = new ProviderExecutionPlanner();
    expect(() =>
      planner.create(
        {
          ...SELECTED,
          selectedProviderId: null,
          matchedPolicyId: null,
          reasonCode: RoutingReasonCode.NO_ELIGIBLE_PROVIDER,
        },
        {
          capability: Capability.GENERAL_CHAT,
          validationProfile: validationProfileId('general-chat-v1'),
        },
      ),
    ).toThrow(ProviderExecutionPlanError);
  });

  it('rejects a selected Provider outside the eligible set', () => {
    expect(() =>
      new ProviderExecutionPlanner().create(
        { ...SELECTED, eligibleProviderIds: [providerId('provider-b')] },
        {
          capability: Capability.GENERAL_CHAT,
          validationProfile: validationProfileId('general-chat-v1'),
        },
      ),
    ).toThrow(/eligible/);
  });

  it('rejects invalid selection identity, version, digest, capability, and validation profile', () => {
    const planner = new ProviderExecutionPlanner();
    const input = {
      capability: Capability.GENERAL_CHAT,
      validationProfile: validationProfileId('general-chat-v1'),
    };
    expect(() => planner.create({ ...SELECTED, configurationDigest: 'bad' }, input)).toThrow(/digest/);
    expect(() => planner.create({ ...SELECTED, policyVersion: '' }, input)).toThrow(/version/);
    expect(() =>
      planner.create(
        { ...SELECTED, selectedProviderId: 'bad id' as typeof SELECTED.selectedProviderId },
        input,
      ),
    ).toThrow(/eligible|identity/);
    expect(() =>
      planner.create(SELECTED, {
        ...input,
        capability: 'UNKNOWN_CAPABILITY' as Capability,
      }),
    ).toThrow(/input/);
    expect(() =>
      planner.create(SELECTED, {
        ...input,
        validationProfile: 'bad profile' as typeof input.validationProfile,
      }),
    ).toThrow(/input/);
  });
});
