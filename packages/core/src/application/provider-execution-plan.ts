import { Capability } from '../domain';
import {
  ProviderId,
  ProviderSelectionDecision,
  RoutingReasonCode,
  ValidationProfileId,
  isRoutingIdentifier,
} from './provider-routing-contracts';

const SHA_256 = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CAPABILITIES = new Set(Object.values(Capability));

export interface ProviderExecutionPlanInput {
  capability: Capability;
  validationProfile: ValidationProfileId;
}

/**
 * Immutable handoff between selection and execution. Slice 2 deliberately fixes
 * this to one attempt and one Provider; later slices must widen the contract
 * explicitly rather than hiding retries or multi-provider behavior in the Gateway.
 */
export interface ProviderExecutionPlan {
  selectedProviderId: ProviderId;
  executionOrder: readonly [ProviderId];
  attemptBudget: 1;
  overallDeadlineMs: null;
  capability: Capability;
  validationProfile: ValidationProfileId;
  fallbackEligible: false;
  escalationEligible: false;
  matchedPolicyId: NonNullable<ProviderSelectionDecision['matchedPolicyId']>;
  policyVersion: string;
  registryVersion: string;
  configurationDigest: string;
}

export class ProviderExecutionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderExecutionPlanError';
  }
}

export class ProviderExecutionPlanner {
  create(decision: ProviderSelectionDecision, input: ProviderExecutionPlanInput): ProviderExecutionPlan {
    if (
      decision.reasonCode !== RoutingReasonCode.SELECTED ||
      decision.selectedProviderId === null ||
      decision.matchedPolicyId === null
    ) {
      throw new ProviderExecutionPlanError('A selected Provider decision is required');
    }
    if (!decision.eligibleProviderIds.includes(decision.selectedProviderId)) {
      throw new ProviderExecutionPlanError('Selected Provider must be eligible');
    }
    if (!isRoutingIdentifier(decision.selectedProviderId) || !isRoutingIdentifier(decision.matchedPolicyId)) {
      throw new ProviderExecutionPlanError('Invalid selection identity');
    }
    if (!VERSION.test(decision.policyVersion) || !VERSION.test(decision.registryVersion)) {
      throw new ProviderExecutionPlanError('Invalid selection version');
    }
    if (!SHA_256.test(decision.configurationDigest)) {
      throw new ProviderExecutionPlanError('Invalid selection configuration digest');
    }
    if (!CAPABILITIES.has(input.capability) || !isRoutingIdentifier(input.validationProfile)) {
      throw new ProviderExecutionPlanError('Invalid execution input');
    }

    return Object.freeze({
      selectedProviderId: decision.selectedProviderId,
      executionOrder: Object.freeze([decision.selectedProviderId]) as readonly [ProviderId],
      attemptBudget: 1,
      overallDeadlineMs: null,
      capability: input.capability,
      validationProfile: input.validationProfile,
      fallbackEligible: false,
      escalationEligible: false,
      matchedPolicyId: decision.matchedPolicyId,
      policyVersion: decision.policyVersion,
      registryVersion: decision.registryVersion,
      configurationDigest: decision.configurationDigest,
    });
  }
}
