import { createHash } from 'node:crypto';
import { Capability } from '../domain';
import {
  ProviderAvailability,
  ProviderId,
  ProviderRegistrySnapshot,
  ProviderSelectionDecision,
  RoutingReasonCode,
  ValidationProfileId,
  isRoutingIdentifier,
} from './provider-routing-contracts';
import {
  ProviderBindingFailureCode,
  ProviderBindingIdentity,
  ProviderBindingRegistry,
} from './provider-binding-registry';

const SHA_256 = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CAPABILITIES = new Set(Object.values(Capability));

export interface ProviderExecutionPlanInput {
  capability: Capability;
  validationProfile: ValidationProfileId;
}

/** Immutable, provenance-bound handoff between selection and one execution attempt. */
export interface ProviderExecutionPlan {
  selectedProviderId: ProviderId;
  bindingIdentity: ProviderBindingIdentity;
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
  registryConfigurationDigest: string;
  policyConfigurationDigest: string;
  configurationDigest: string;
}

export class ProviderExecutionPlanError extends Error {
  constructor(
    readonly code: ProviderBindingFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderExecutionPlanError';
  }
}

export function combinedRoutingConfigurationDigest(registryDigest: string, policyDigest: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ registryDigest, policyDigest }))
    .digest('hex');
}

function planError(code: ProviderBindingFailureCode, message: string): never {
  throw new ProviderExecutionPlanError(code, message);
}

export class ProviderExecutionPlanner {
  create(
    decision: ProviderSelectionDecision,
    registry: ProviderRegistrySnapshot,
    bindings: ProviderBindingRegistry,
    input: ProviderExecutionPlanInput,
  ): ProviderExecutionPlan {
    if (
      decision.reasonCode !== RoutingReasonCode.SELECTED ||
      decision.selectedProviderId === null ||
      decision.matchedPolicyId === null
    ) {
      planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'A selected Provider decision is required');
    }
    if (!decision.eligibleProviderIds.includes(decision.selectedProviderId)) {
      planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Selected Provider must be eligible');
    }
    if (!isRoutingIdentifier(decision.selectedProviderId) || !isRoutingIdentifier(decision.matchedPolicyId)) {
      planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Invalid selection identity');
    }
    if (!VERSION.test(decision.policyVersion) || !VERSION.test(decision.registryVersion)) {
      planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Invalid selection version');
    }
    if (
      !SHA_256.test(decision.registryConfigurationDigest) ||
      !SHA_256.test(decision.policyConfigurationDigest) ||
      !SHA_256.test(decision.configurationDigest)
    ) {
      planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Invalid selection configuration digest');
    }
    if (
      decision.registryVersion !== registry.version ||
      decision.registryConfigurationDigest !== registry.configurationDigest ||
      !bindings.matchesSnapshot(registry) ||
      decision.configurationDigest !==
        combinedRoutingConfigurationDigest(
          decision.registryConfigurationDigest,
          decision.policyConfigurationDigest,
        )
    ) {
      planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Routing configuration identity mismatch');
    }
    if (!CAPABILITIES.has(input.capability) || !isRoutingIdentifier(input.validationProfile)) {
      planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Invalid execution input');
    }

    const selectedSnapshot = registry.providers.find(
      (entry) => entry.descriptor.providerId === decision.selectedProviderId,
    );
    if (!selectedSnapshot) {
      planError(ProviderBindingFailureCode.UNKNOWN_PROVIDER_BINDING, 'Selected Provider has no descriptor');
    }
    if (!selectedSnapshot.descriptor.enabled) {
      planError(ProviderBindingFailureCode.PROVIDER_DISABLED, 'Selected Provider is disabled');
    }
    if (selectedSnapshot.availability !== ProviderAvailability.AVAILABLE) {
      planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Selected Provider is not eligible');
    }

    const binding = bindings.get(decision.selectedProviderId);
    if (!binding) {
      planError(ProviderBindingFailureCode.PROVIDER_BINDING_NOT_FOUND, 'Selected Provider has no executable binding');
    }
    if (binding.providerId !== decision.selectedProviderId || binding.identity.providerId !== decision.selectedProviderId) {
      planError(ProviderBindingFailureCode.PROVIDER_BINDING_MISMATCH, 'Selected Provider binding identity mismatch');
    }

    const bindingIdentity = Object.freeze({ ...binding.identity });
    return Object.freeze({
      selectedProviderId: decision.selectedProviderId,
      bindingIdentity,
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
      registryConfigurationDigest: decision.registryConfigurationDigest,
      policyConfigurationDigest: decision.policyConfigurationDigest,
      configurationDigest: decision.configurationDigest,
    });
  }
}
