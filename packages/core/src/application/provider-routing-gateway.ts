import { AiProviderError } from '../errors';
import { AiFailureKind, Capability } from '../domain';
import type { AiExecutionResult, AiRequest } from '../ports';
import type { ProviderExecutionPlan } from './provider-execution-plan';
import { combinedRoutingConfigurationDigest } from './provider-execution-plan';
import {
  ProviderBindingFailureCode,
  ProviderBindingRegistry,
} from './provider-binding-registry';
import type { PolicyId, ProviderId, ValidationProfileId } from './provider-routing-contracts';
import { isRoutingIdentifier } from './provider-routing-contracts';

const SHA_256 = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CAPABILITIES = new Set(Object.values(Capability));
const AI_FAILURE_KINDS = new Set(Object.values(AiFailureKind));

export enum ProviderExecutionOutcome {
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

export type ProviderGatewayFailureKind = AiFailureKind | ProviderBindingFailureCode;

export interface ProviderExecutionAudit {
  schemaVersion: 'provider-execution-audit-v1';
  providerId: ProviderId;
  bindingDigest: string;
  executionOrder: readonly [ProviderId];
  attemptBudget: 1;
  attemptCount: 0 | 1;
  outcome: ProviderExecutionOutcome;
  failureKind: ProviderGatewayFailureKind | null;
  capability: AiRequest['capability'];
  validationProfile: ValidationProfileId;
  matchedPolicyId: PolicyId;
  policyVersion: string;
  registryVersion: string;
  registryConfigurationDigest: string;
  policyConfigurationDigest: string;
  configurationDigest: string;
  fallbackAttempted: false;
  escalationAttempted: false;
}

export type ProviderGatewayResult =
  | {
      status: ProviderExecutionOutcome.SUCCEEDED;
      result: AiExecutionResult;
      audit: ProviderExecutionAudit;
    }
  | {
      status: ProviderExecutionOutcome.FAILED;
      failureKind: ProviderGatewayFailureKind;
      audit: ProviderExecutionAudit;
    };

function validatePlanShape(plan: ProviderExecutionPlan, request: AiRequest): ProviderBindingFailureCode | null {
  if (
    !isRoutingIdentifier(plan.selectedProviderId) ||
    !isRoutingIdentifier(plan.bindingIdentity?.providerId) ||
    plan.bindingIdentity.providerId !== plan.selectedProviderId ||
    !VERSION.test(plan.bindingIdentity.bindingVersion) ||
    !SHA_256.test(plan.bindingIdentity.bindingDigest) ||
    !isRoutingIdentifier(plan.matchedPolicyId) ||
    !VERSION.test(plan.policyVersion) ||
    !VERSION.test(plan.registryVersion) ||
    !SHA_256.test(plan.registryConfigurationDigest) ||
    !SHA_256.test(plan.policyConfigurationDigest) ||
    !SHA_256.test(plan.configurationDigest) ||
    !isRoutingIdentifier(plan.validationProfile) ||
    !CAPABILITIES.has(plan.capability)
  ) {
    return ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH;
  }
  if (
    plan.configurationDigest !==
    combinedRoutingConfigurationDigest(plan.registryConfigurationDigest, plan.policyConfigurationDigest)
  ) {
    return ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH;
  }
  if (
    plan.attemptBudget !== 1 ||
    !Array.isArray(plan.executionOrder) ||
    plan.executionOrder.length !== 1 ||
    plan.executionOrder[0] !== plan.selectedProviderId ||
    plan.overallDeadlineMs !== null ||
    plan.fallbackEligible !== false ||
    plan.escalationEligible !== false ||
    request.capability !== plan.capability
  ) {
    return ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH;
  }
  return null;
}

function audit(
  plan: ProviderExecutionPlan,
  attemptCount: 0 | 1,
  outcome: ProviderExecutionOutcome,
  failureKind: ProviderGatewayFailureKind | null,
): ProviderExecutionAudit {
  const providerId = isRoutingIdentifier(plan.selectedProviderId)
    ? plan.selectedProviderId
    : ('unknown-provider' as ProviderId);
  const bindingDigest = SHA_256.test(plan.bindingIdentity?.bindingDigest ?? '')
    ? plan.bindingIdentity.bindingDigest
    : '0'.repeat(64);
  const capability = CAPABILITIES.has(plan.capability) ? plan.capability : Capability.GENERAL_CHAT;
  const validationProfile = isRoutingIdentifier(plan.validationProfile)
    ? plan.validationProfile
    : ('invalid-plan' as ValidationProfileId);
  const matchedPolicyId = isRoutingIdentifier(plan.matchedPolicyId)
    ? plan.matchedPolicyId
    : ('invalid-plan' as PolicyId);
  const policyVersion = VERSION.test(plan.policyVersion) ? plan.policyVersion : 'invalid';
  const registryVersion = VERSION.test(plan.registryVersion) ? plan.registryVersion : 'invalid';
  const registryConfigurationDigest = SHA_256.test(plan.registryConfigurationDigest)
    ? plan.registryConfigurationDigest
    : '0'.repeat(64);
  const policyConfigurationDigest = SHA_256.test(plan.policyConfigurationDigest)
    ? plan.policyConfigurationDigest
    : '0'.repeat(64);
  const configurationDigest = SHA_256.test(plan.configurationDigest)
    ? plan.configurationDigest
    : '0'.repeat(64);
  return Object.freeze({
    schemaVersion: 'provider-execution-audit-v1',
    providerId,
    bindingDigest,
    executionOrder: Object.freeze([providerId]) as readonly [ProviderId],
    attemptBudget: 1,
    attemptCount,
    outcome,
    failureKind,
    capability,
    validationProfile,
    matchedPolicyId,
    policyVersion,
    registryVersion,
    registryConfigurationDigest,
    policyConfigurationDigest,
    configurationDigest,
    fallbackAttempted: false,
    escalationAttempted: false,
  });
}

function preflightFailure(plan: ProviderExecutionPlan, failureKind: ProviderBindingFailureCode): ProviderGatewayResult {
  return Object.freeze({
    status: ProviderExecutionOutcome.FAILED,
    failureKind,
    audit: audit(plan, 0, ProviderExecutionOutcome.FAILED, failureKind),
  });
}

/** Single-attempt execution owner. No availability probe, retry, fallback, escalation, or validation. */
export class ProviderRoutingGateway {
  constructor(private readonly bindings: ProviderBindingRegistry) {}

  async execute(plan: ProviderExecutionPlan, request: AiRequest): Promise<ProviderGatewayResult> {
    const invalidPlan = validatePlanShape(plan, request);
    if (invalidPlan) return preflightFailure(plan, invalidPlan);
    if (
      plan.registryVersion !== this.bindings.registryVersion ||
      plan.registryConfigurationDigest !== this.bindings.registryConfigurationDigest
    ) {
      return preflightFailure(plan, ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH);
    }

    const binding = this.bindings.get(plan.selectedProviderId);
    if (!binding) {
      return preflightFailure(plan, ProviderBindingFailureCode.PROVIDER_BINDING_NOT_FOUND);
    }
    if (
      binding.providerId !== plan.selectedProviderId ||
      binding.identity.providerId !== plan.selectedProviderId ||
      binding.provider.id !== plan.selectedProviderId ||
      binding.identity.bindingVersion !== plan.bindingIdentity.bindingVersion ||
      binding.identity.bindingDigest !== plan.bindingIdentity.bindingDigest
    ) {
      return preflightFailure(plan, ProviderBindingFailureCode.PROVIDER_BINDING_MISMATCH);
    }

    try {
      const result = await binding.provider.execute(request);
      return Object.freeze({
        status: ProviderExecutionOutcome.SUCCEEDED,
        result,
        audit: audit(plan, 1, ProviderExecutionOutcome.SUCCEEDED, null),
      });
    } catch (error) {
      const failureKind =
        error instanceof AiProviderError && AI_FAILURE_KINDS.has(error.kind)
          ? error.kind
          : AiFailureKind.EXECUTION_FAILED;
      return Object.freeze({
        status: ProviderExecutionOutcome.FAILED,
        failureKind,
        audit: audit(plan, 1, ProviderExecutionOutcome.FAILED, failureKind),
      });
    }
  }
}
