import { createHash } from 'node:crypto';
import { Capability } from '../domain';
import {
  ROUTING_FAILURE_MATRIX_VERSION,
  RoutingFailureCode,
} from './runtime-response-validation-contracts';
import {
  ProviderAvailability,
  ProviderId,
  ProviderRegistrySnapshot,
  ProviderSelectionDecision,
  ReliabilityTier,
  RoutingReasonCode,
  ValidationProfileId,
  isRoutingIdentifier,
} from './provider-routing-contracts';
import {
  ProviderBindingFailureCode,
  ProviderBindingIdentity,
  ProviderBindingRegistry,
} from './provider-binding-registry';
import {
  ValidationProfileDefinition,
  ValidationProfileRegistry,
  ValidationReliabilityAxis,
} from './validation-profile-registry';

const SHA_256 = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CAPABILITIES = new Set(Object.values(Capability));
const RELIABILITY_SCORE: Readonly<Record<ReliabilityTier, number>> = Object.freeze({
  [ReliabilityTier.UNPROVEN]: 0,
  [ReliabilityTier.LOW]: 1,
  [ReliabilityTier.STANDARD]: 2,
  [ReliabilityTier.HIGH]: 3,
});

export const MAX_PROVIDER_ATTEMPTS = 2 as const;
export const MAX_ADDITIONAL_PROVIDER_HOPS = 1 as const;

export enum DeadlineClass {
  INTERACTIVE = 'INTERACTIVE',
  STANDARD = 'STANDARD',
  EXTENDED = 'EXTENDED',
}

export enum ExecutionTargetPurpose {
  PRIMARY = 'PRIMARY',
  FALLBACK = 'FALLBACK',
  ESCALATION = 'ESCALATION',
}

export interface ProviderExecutionTarget {
  readonly purpose: ExecutionTargetPurpose;
  readonly providerId: ProviderId;
  readonly bindingIdentity: ProviderBindingIdentity;
}

export interface ProviderExecutionPlanInput {
  capability: Capability;
  validationProfile: ValidationProfileId;
  deadlineClass: DeadlineClass;
  /** Caller-owned concrete execution identity. Excluded from configuration digests. */
  executionId?: string;
}

export interface ProviderExecutionDigestMaterial {
  registryConfigurationDigest: string;
  policyConfigurationDigest: string;
  validationProfileConfigurationDigest: string;
  failureMatrixVersion: string;
  maxAttempts: typeof MAX_PROVIDER_ATTEMPTS;
  maxAdditionalHops: typeof MAX_ADDITIONAL_PROVIDER_HOPS;
  deadlineClass: DeadlineClass;
  capability: Capability;
  validationProfile: ValidationProfileId;
  matchedPolicyId: NonNullable<ProviderSelectionDecision['matchedPolicyId']>;
  primary: ProviderExecutionTarget;
  operationalFallback: ProviderExecutionTarget | null;
  semanticEscalation: ProviderExecutionTarget | null;
}

/**
 * Slice 3A declarative branch plan. Legacy one-attempt fields remain explicit so
 * the Slice 2 Gateway continues to invoke only the primary until Slice 3B.
 */
export interface ProviderExecutionPlan extends ProviderExecutionDigestMaterial {
  selectedProviderId: ProviderId;
  bindingIdentity: ProviderBindingIdentity;
  executionOrder: readonly [ProviderId];
  attemptBudget: 1;
  overallDeadlineMs: null;
  fallbackEligible: false;
  escalationEligible: false;
  validationProfileVersion: string;
  decisionId: string;
  executionId?: string;
  executionConfigurationDigest: string;
  planDigest: string;
  policyVersion: string;
  registryVersion: string;
  /** Selection configuration identity retained for Slice 2 Gateway compatibility. */
  configurationDigest: string;
}

export type ProviderExecutionPlanFailureCode = ProviderBindingFailureCode | RoutingFailureCode;

export class ProviderExecutionPlanError extends Error {
  constructor(
    readonly code: ProviderExecutionPlanFailureCode,
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

function targetDigestShape(target: ProviderExecutionTarget | null): object | null {
  if (!target) return null;
  return {
    purpose: target.purpose,
    providerId: target.providerId,
    bindingDigest: target.bindingIdentity.bindingDigest,
  };
}

export function computeProviderExecutionConfigurationDigest(material: ProviderExecutionDigestMaterial): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        registryConfigurationDigest: material.registryConfigurationDigest,
        policyConfigurationDigest: material.policyConfigurationDigest,
        validationProfileConfigurationDigest: material.validationProfileConfigurationDigest,
        failureMatrixVersion: material.failureMatrixVersion,
        maxAttempts: material.maxAttempts,
        maxAdditionalHops: material.maxAdditionalHops,
        deadlineClass: material.deadlineClass,
        capability: material.capability,
        validationProfile: material.validationProfile,
        matchedPolicyId: material.matchedPolicyId,
        primary: targetDigestShape(material.primary),
        operationalFallback: targetDigestShape(material.operationalFallback),
        semanticEscalation: targetDigestShape(material.semanticEscalation),
      }),
    )
    .digest('hex');
}

function selectionDecisionId(decision: ProviderSelectionDecision): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        selectedProviderId: decision.selectedProviderId,
        eligibleProviderIds: decision.eligibleProviderIds,
        matchedPolicyId: decision.matchedPolicyId,
        reasonCode: decision.reasonCode,
        policyVersion: decision.policyVersion,
        registryVersion: decision.registryVersion,
        registryConfigurationDigest: decision.registryConfigurationDigest,
        policyConfigurationDigest: decision.policyConfigurationDigest,
        configurationDigest: decision.configurationDigest,
      }),
    )
    .digest('hex');
}

export function computeProviderExecutionPlanDigest(decisionId: string, executionConfigurationDigest: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ decisionId, executionConfigurationDigest }))
    .digest('hex');
}

function planError(code: ProviderExecutionPlanFailureCode, message: string): never {
  throw new ProviderExecutionPlanError(code, message);
}

function frozenIdentity(identity: ProviderBindingIdentity): ProviderBindingIdentity {
  return Object.freeze({ ...identity });
}

function reliability(
  snapshot: ProviderRegistrySnapshot,
  provider: ProviderId,
  axis: ValidationReliabilityAxis,
): ReliabilityTier {
  const descriptor = snapshot.providers.find((entry) => entry.descriptor.providerId === provider)?.descriptor;
  if (!descriptor) {
    planError(ProviderBindingFailureCode.UNKNOWN_PROVIDER_BINDING, 'Execution target has no descriptor');
  }
  return axis === ValidationReliabilityAxis.AUTHORITY
    ? descriptor.capabilities.authorityReliability
    : descriptor.capabilities.semanticReliability;
}

function validateTarget(
  target: ProviderExecutionTarget,
  expectedPurpose: ExecutionTargetPurpose,
  eligible: ReadonlySet<ProviderId>,
  registry: ProviderRegistrySnapshot,
  bindings: ProviderBindingRegistry,
): void {
  if (target.purpose !== expectedPurpose || !eligible.has(target.providerId)) {
    planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Invalid execution target purpose or eligibility');
  }
  const entry = registry.providers.find((candidate) => candidate.descriptor.providerId === target.providerId);
  if (!entry) {
    planError(ProviderBindingFailureCode.UNKNOWN_PROVIDER_BINDING, 'Execution target has no descriptor');
  }
  if (!entry.descriptor.enabled) {
    planError(ProviderBindingFailureCode.PROVIDER_DISABLED, 'Execution target is disabled');
  }
  if (entry.availability !== ProviderAvailability.AVAILABLE) {
    planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Execution target is unavailable');
  }
  const binding = bindings.get(target.providerId);
  if (!binding) {
    planError(ProviderBindingFailureCode.PROVIDER_BINDING_NOT_FOUND, 'Execution target has no executable binding');
  }
  if (
    binding.providerId !== target.providerId ||
    binding.identity.providerId !== target.providerId ||
    binding.identity.bindingVersion !== target.bindingIdentity.bindingVersion ||
    binding.identity.bindingDigest !== target.bindingIdentity.bindingDigest
  ) {
    planError(ProviderBindingFailureCode.PROVIDER_BINDING_MISMATCH, 'Execution target binding identity mismatch');
  }
}

export function assertProviderExecutionTargets(
  primary: ProviderExecutionTarget,
  operationalFallback: ProviderExecutionTarget | null,
  semanticEscalation: ProviderExecutionTarget | null,
  eligibleProviderIds: readonly ProviderId[],
  registry: ProviderRegistrySnapshot,
  bindings: ProviderBindingRegistry,
  profile: ValidationProfileDefinition,
): void {
  const eligible = new Set(eligibleProviderIds);
  validateTarget(primary, ExecutionTargetPurpose.PRIMARY, eligible, registry, bindings);
  if (operationalFallback) validateTarget(operationalFallback, ExecutionTargetPurpose.FALLBACK, eligible, registry, bindings);
  if (semanticEscalation) validateTarget(semanticEscalation, ExecutionTargetPurpose.ESCALATION, eligible, registry, bindings);

  if (
    operationalFallback?.providerId === primary.providerId ||
    semanticEscalation?.providerId === primary.providerId ||
    (operationalFallback && semanticEscalation && operationalFallback.providerId === semanticEscalation.providerId)
  ) {
    planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Execution targets must be unique');
  }
  if (semanticEscalation) {
    if (!profile.escalationEnabled || !profile.escalationReliabilityAxis) {
      planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Validation profile prohibits escalation');
    }
    const escalationReliability = reliability(
      registry,
      semanticEscalation.providerId,
      profile.escalationReliabilityAxis,
    );
    const minimumReliability = profile.minimumEscalationReliability ?? ReliabilityTier.UNPROVEN;
    if (
      RELIABILITY_SCORE[escalationReliability] <=
        RELIABILITY_SCORE[reliability(registry, primary.providerId, profile.escalationReliabilityAxis)] ||
      RELIABILITY_SCORE[escalationReliability] < RELIABILITY_SCORE[minimumReliability]
    ) {
      planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Escalation target must be stronger');
    }
  }
}

function target(
  purpose: ExecutionTargetPurpose,
  provider: ProviderId,
  bindings: ProviderBindingRegistry,
): ProviderExecutionTarget | null {
  const binding = bindings.get(provider);
  return binding
    ? Object.freeze({ purpose, providerId: provider, bindingIdentity: frozenIdentity(binding.identity) })
    : null;
}

function executableCandidates(
  decision: ProviderSelectionDecision,
  bindings: ProviderBindingRegistry,
): readonly ProviderId[] {
  return decision.eligibleProviderIds.filter(
    (provider) => provider !== decision.selectedProviderId && bindings.get(provider) !== undefined,
  );
}

export class ProviderExecutionPlanner {
  create(
    decision: ProviderSelectionDecision,
    registry: ProviderRegistrySnapshot,
    bindings: ProviderBindingRegistry,
    profiles: ValidationProfileRegistry,
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
    if (
      !isRoutingIdentifier(decision.selectedProviderId) ||
      !isRoutingIdentifier(decision.matchedPolicyId) ||
      new Set(decision.eligibleProviderIds).size !== decision.eligibleProviderIds.length ||
      decision.eligibleProviderIds.some((id) => !isRoutingIdentifier(id))
    ) {
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
    if (
      !CAPABILITIES.has(input.capability) ||
      !isRoutingIdentifier(input.validationProfile) ||
      !Object.values(DeadlineClass).includes(input.deadlineClass) ||
      (input.executionId !== undefined && !isRoutingIdentifier(input.executionId))
    ) {
      planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Invalid execution input');
    }

    let profile: ValidationProfileDefinition;
    try {
      profile = profiles.resolve(input.validationProfile);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === RoutingFailureCode.UNKNOWN_VALIDATION_PROFILE) {
        planError(RoutingFailureCode.UNKNOWN_VALIDATION_PROFILE, 'Unknown validation profile');
      }
      throw error;
    }

    for (const eligibleId of decision.eligibleProviderIds) {
      const eligibleEntry = registry.providers.find((entry) => entry.descriptor.providerId === eligibleId);
      if (!eligibleEntry) {
        planError(ProviderBindingFailureCode.UNKNOWN_PROVIDER_BINDING, 'Eligible Provider has no descriptor');
      }
      if (!eligibleEntry.descriptor.enabled) {
        planError(ProviderBindingFailureCode.PROVIDER_DISABLED, 'Eligible Provider is disabled');
      }
      if (eligibleEntry.availability !== ProviderAvailability.AVAILABLE) {
        planError(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Eligible Provider is unavailable');
      }
    }

    const primaryCandidate = target(ExecutionTargetPurpose.PRIMARY, decision.selectedProviderId, bindings);
    if (!primaryCandidate) {
      planError(ProviderBindingFailureCode.PROVIDER_BINDING_NOT_FOUND, 'Selected Provider has no executable binding');
    }

    const candidates = executableCandidates(decision, bindings);
    let semanticEscalation: ProviderExecutionTarget | null = null;
    if (profile.escalationEnabled && profile.escalationReliabilityAxis) {
      const primaryReliability = reliability(registry, primaryCandidate.providerId, profile.escalationReliabilityAxis);
      const minimumReliability = profile.minimumEscalationReliability ?? ReliabilityTier.UNPROVEN;
      const escalationId = candidates.find(
        (candidate) => {
          const candidateReliability = reliability(registry, candidate, profile.escalationReliabilityAxis!);
          return (
            RELIABILITY_SCORE[candidateReliability] > RELIABILITY_SCORE[primaryReliability] &&
            RELIABILITY_SCORE[candidateReliability] >= RELIABILITY_SCORE[minimumReliability]
          );
        },
      );
      if (escalationId) semanticEscalation = target(ExecutionTargetPurpose.ESCALATION, escalationId, bindings);
    }
    const fallbackId = candidates.find((candidate) => candidate !== semanticEscalation?.providerId);
    const operationalFallback = fallbackId
      ? target(ExecutionTargetPurpose.FALLBACK, fallbackId, bindings)
      : null;

    assertProviderExecutionTargets(
      primaryCandidate,
      operationalFallback,
      semanticEscalation,
      decision.eligibleProviderIds,
      registry,
      bindings,
      profile,
    );

    const material: ProviderExecutionDigestMaterial = Object.freeze({
      registryConfigurationDigest: decision.registryConfigurationDigest,
      policyConfigurationDigest: decision.policyConfigurationDigest,
      validationProfileConfigurationDigest: profile.configurationDigest,
      failureMatrixVersion: ROUTING_FAILURE_MATRIX_VERSION,
      maxAttempts: MAX_PROVIDER_ATTEMPTS,
      maxAdditionalHops: MAX_ADDITIONAL_PROVIDER_HOPS,
      deadlineClass: input.deadlineClass,
      capability: input.capability,
      validationProfile: input.validationProfile,
      matchedPolicyId: decision.matchedPolicyId,
      primary: primaryCandidate,
      operationalFallback,
      semanticEscalation,
    });
    const executionConfigurationDigest = computeProviderExecutionConfigurationDigest(material);
    const decisionId = selectionDecisionId(decision);
    const bindingIdentity = frozenIdentity(primaryCandidate.bindingIdentity);

    return Object.freeze({
      ...material,
      selectedProviderId: primaryCandidate.providerId,
      bindingIdentity,
      executionOrder: Object.freeze([primaryCandidate.providerId]) as readonly [ProviderId],
      attemptBudget: 1,
      overallDeadlineMs: null,
      fallbackEligible: false,
      escalationEligible: false,
      validationProfileVersion: profile.version,
      decisionId,
      ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
      executionConfigurationDigest,
      planDigest: computeProviderExecutionPlanDigest(decisionId, executionConfigurationDigest),
      policyVersion: decision.policyVersion,
      registryVersion: decision.registryVersion,
      configurationDigest: decision.configurationDigest,
    });
  }
}
