import { describe, expect, it, vi } from 'vitest';
import { Capability } from '../domain';
import type { AiProvider } from '../ports';
import {
  AdapterId,
  AvailabilityClass,
  ConcurrencyClass,
  ContextCapacity,
  CostTier,
  ExecutionLocality,
  LatencyTier,
  ProviderAvailability,
  ProviderDescriptor,
  ProviderRegistrySnapshot,
  ProviderSelectionDecision,
  ReliabilityTier,
  RoutingClass,
  RoutingReasonCode,
  SupportLevel,
  TimeoutClass,
  adapterId,
  policyId,
  providerId,
} from './provider-routing-contracts';
import { ProviderRegistry } from './provider-registry';
import {
  ExecutableProviderBinding,
  ProviderBindingFailureCode,
  ProviderBindingRegistry,
} from './provider-binding-registry';
import {
  DeadlineClass,
  ExecutionTargetPurpose,
  MAX_ADDITIONAL_PROVIDER_HOPS,
  MAX_PROVIDER_ATTEMPTS,
  ProviderExecutionPlanError,
  ProviderExecutionPlanner,
  assertProviderExecutionTargets,
  combinedRoutingConfigurationDigest,
  computeProviderExecutionConfigurationDigest,
} from './provider-execution-plan';
import {
  AUTHORITY_SENSITIVE,
  GENERAL_CHAT,
  ValidationProfileRegistry,
  createDefaultValidationProfileRegistry,
} from './validation-profile-registry';
import { ROUTING_FAILURE_MATRIX_VERSION, RoutingFailureCode } from './runtime-response-validation-contracts';

const POLICY_DIGEST = 'c'.repeat(64);

function descriptor(
  id: string,
  options: {
    adapter?: AdapterId;
    modelId?: string;
    enabled?: boolean;
    semanticReliability?: ReliabilityTier;
    authorityReliability?: ReliabilityTier;
  } = {},
): ProviderDescriptor {
  return {
    providerId: providerId(id),
    adapterId: options.adapter ?? adapterId('local-text-adapter'),
    modelId: options.modelId ?? `opaque-${id}`,
    capabilities: {
      supportedCapabilities: [Capability.GENERAL_CHAT],
      routingClasses: [RoutingClass.BALANCED],
      semanticReliability: options.semanticReliability ?? ReliabilityTier.STANDARD,
      authorityReliability: options.authorityReliability ?? ReliabilityTier.STANDARD,
      continuityReliability: ReliabilityTier.STANDARD,
      toolUse: SupportLevel.UNSUPPORTED,
      structuredOutput: SupportLevel.SUPPORTED,
      contextCapacity: ContextCapacity.MEDIUM,
      streaming: SupportLevel.UNSUPPORTED,
      executionLocality: ExecutionLocality.LOCAL,
    },
    operationalProfile: {
      latencyTier: LatencyTier.BALANCED,
      timeoutClass: TimeoutClass.STANDARD,
      costTier: CostTier.LOW,
      concurrencyClass: ConcurrencyClass.LIMITED,
      availabilityClass: AvailabilityClass.LOCAL_STABLE,
    },
    enabled: options.enabled ?? true,
    profileVersion: 'profile-v1',
  };
}

function provider(id: string): AiProvider {
  return {
    id,
    capabilities: [{ capability: Capability.GENERAL_CHAT, priority: 1 }],
    isAvailable: vi.fn(async () => true),
    execute: vi.fn(async () => ({ text: id })),
  };
}

function binding(value: AiProvider, options: { adapter?: AdapterId; modelId?: string } = {}): ExecutableProviderBinding {
  return {
    providerId: providerId(value.id),
    adapterId: options.adapter ?? adapterId('local-text-adapter'),
    modelId: options.modelId ?? `opaque-${value.id}`,
    bindingVersion: 'binding-v1',
    provider: value,
  };
}

function snapshot(
  descriptors: readonly ProviderDescriptor[] = [descriptor('provider-a')],
  availability: ProviderAvailability = ProviderAvailability.AVAILABLE,
): ProviderRegistrySnapshot {
  const registry = new ProviderRegistry(
    'registry-v1',
    descriptors.map((value) => ({ providerId: value.providerId, descriptor: value })),
  );
  return registry.snapshot(
    Object.fromEntries(descriptors.map((value) => [value.providerId, availability])),
  );
}

function decision(
  registry: ProviderRegistrySnapshot,
  selected = 'provider-a',
  eligible: readonly string[] = [selected],
): ProviderSelectionDecision {
  return {
    selectedProviderId: providerId(selected),
    eligibleProviderIds: eligible.map(providerId),
    matchedPolicyId: policyId('balanced-v1'),
    reasonCode: RoutingReasonCode.SELECTED,
    policyVersion: 'policy-v1',
    registryVersion: registry.version,
    registryConfigurationDigest: registry.configurationDigest,
    policyConfigurationDigest: POLICY_DIGEST,
    configurationDigest: combinedRoutingConfigurationDigest(registry.configurationDigest, POLICY_DIGEST),
  };
}

const input = {
  capability: Capability.GENERAL_CHAT,
  validationProfile: GENERAL_CHAT,
  deadlineClass: DeadlineClass.STANDARD,
};
const profiles = createDefaultValidationProfileRegistry();

describe('ProviderExecutionPlanner provenance', () => {
  it('deep-freezes a valid primary-only branch plan while preserving the Slice 2 single-attempt boundary', () => {
    const registry = snapshot();
    const bindings = new ProviderBindingRegistry(registry, [binding(provider('provider-a'))]);
    const plan = new ProviderExecutionPlanner().create(decision(registry), registry, bindings, profiles, input);

    expect(plan).toMatchObject({
      selectedProviderId: 'provider-a',
      bindingIdentity: {
        providerId: 'provider-a',
        bindingVersion: 'binding-v1',
        bindingDigest: '11a6b2a89d935ef767613a3a57330fbe8b9056e0b2708d6e7d41323eaf141a3e',
      },
      executionOrder: ['provider-a'],
      attemptBudget: 1,
      overallDeadlineMs: null,
      validationProfile: GENERAL_CHAT,
      fallbackEligible: false,
      escalationEligible: false,
      maxAttempts: MAX_PROVIDER_ATTEMPTS,
      maxAdditionalHops: MAX_ADDITIONAL_PROVIDER_HOPS,
      deadlineClass: DeadlineClass.STANDARD,
      primary: { purpose: ExecutionTargetPurpose.PRIMARY, providerId: 'provider-a' },
      operationalFallback: null,
      semanticEscalation: null,
      registryConfigurationDigest: registry.configurationDigest,
      policyConfigurationDigest: POLICY_DIGEST,
      failureMatrixVersion: ROUTING_FAILURE_MATRIX_VERSION,
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.executionOrder)).toBe(true);
    expect(Object.isFrozen(plan.bindingIdentity)).toBe(true);
    expect(Object.isFrozen(plan.primary)).toBe(true);
  });

  it('pre-fixes a ranked operational fallback without changing the runtime execution order', () => {
    const registry = snapshot([descriptor('provider-a'), descriptor('provider-b')]);
    const bindings = new ProviderBindingRegistry(registry, [
      binding(provider('provider-a')),
      binding(provider('provider-b')),
    ]);
    const plan = new ProviderExecutionPlanner().create(
      decision(registry, 'provider-a', ['provider-a', 'provider-b']),
      registry,
      bindings,
      profiles,
      input,
    );

    expect(plan.operationalFallback).toMatchObject({
      purpose: ExecutionTargetPurpose.FALLBACK,
      providerId: 'provider-b',
    });
    expect(plan.semanticEscalation).toBeNull();
    expect(plan.executionOrder).toEqual(['provider-a']);
    expect(plan.attemptBudget).toBe(1);
  });

  it('pre-fixes distinct escalation and fallback branches using the existing authority reliability axis', () => {
    const registry = snapshot([
      descriptor('provider-a', { authorityReliability: ReliabilityTier.LOW }),
      descriptor('provider-b', { authorityReliability: ReliabilityTier.HIGH }),
      descriptor('provider-c', { authorityReliability: ReliabilityTier.STANDARD }),
    ]);
    const bindings = new ProviderBindingRegistry(registry, [
      binding(provider('provider-a')),
      binding(provider('provider-b')),
      binding(provider('provider-c')),
    ]);
    const plan = new ProviderExecutionPlanner().create(
      decision(registry, 'provider-a', ['provider-a', 'provider-b', 'provider-c']),
      registry,
      bindings,
      profiles,
      { ...input, validationProfile: AUTHORITY_SENSITIVE, executionId: 'execution-fixture-1' },
    );

    expect(plan.semanticEscalation).toMatchObject({ purpose: ExecutionTargetPurpose.ESCALATION, providerId: 'provider-b' });
    expect(plan.operationalFallback).toMatchObject({ purpose: ExecutionTargetPurpose.FALLBACK, providerId: 'provider-c' });
    expect(plan.decisionId).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.executionId).toBe('execution-fixture-1');
    expect(plan.planDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects no-selection and selected-outside-eligible decisions', () => {
    const registry = snapshot();
    const bindings = new ProviderBindingRegistry(registry, [binding(provider('provider-a'))]);
    const selected = decision(registry);
    expect(() =>
      new ProviderExecutionPlanner().create(
        { ...selected, selectedProviderId: null, matchedPolicyId: null, reasonCode: RoutingReasonCode.NO_ELIGIBLE_PROVIDER },
        registry,
        bindings,
        profiles,
        input,
      ),
    ).toThrow(ProviderExecutionPlanError);
    expect(() =>
      new ProviderExecutionPlanner().create(
        { ...selected, eligibleProviderIds: [providerId('provider-b')] },
        registry,
        bindings,
        profiles,
        input,
      ),
    ).toThrow(/eligible/);
  });

  it('rejects registry and combined configuration identity mismatches', () => {
    const registry = snapshot();
    const bindings = new ProviderBindingRegistry(registry, [binding(provider('provider-a'))]);
    const selected = decision(registry);
    const otherRegistry = snapshot([descriptor('provider-a'), descriptor('provider-b')]);

    expect(() =>
      new ProviderExecutionPlanner().create(selected, otherRegistry, bindings, profiles, input),
    ).toThrow(/identity mismatch/);
    expect(() =>
      new ProviderExecutionPlanner().create(
        { ...selected, configurationDigest: 'd'.repeat(64) },
        registry,
        bindings,
        profiles,
        input,
      ),
    ).toThrow(/identity mismatch/);
    expect(() =>
      new ProviderExecutionPlanner().create(
        { ...selected, registryConfigurationDigest: 'bad' },
        registry,
        bindings,
        profiles,
        input,
      ),
    ).toThrow(/digest/);
  });

  it('rejects unavailable selection and a selected Provider without an executable binding', () => {
    const unavailable = snapshot([descriptor('provider-a'), descriptor('provider-b')], ProviderAvailability.UNAVAILABLE);
    const unavailableProvider = provider('provider-a');
    const unavailableBindings = new ProviderBindingRegistry(unavailable, [binding(unavailableProvider)]);
    expect(() =>
      new ProviderExecutionPlanner().create(decision(unavailable), unavailable, unavailableBindings, profiles, input),
    ).toThrow(/unavailable/);
    expect(unavailableProvider.execute).not.toHaveBeenCalled();

    const registry = snapshot([descriptor('provider-a'), descriptor('provider-b')]);
    const onlyB = new ProviderBindingRegistry(registry, [binding(provider('provider-b'))]);
    try {
      new ProviderExecutionPlanner().create(decision(registry), registry, onlyB, profiles, input);
      throw new Error('expected missing binding rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderExecutionPlanError);
      expect((error as ProviderExecutionPlanError).code).toBe(ProviderBindingFailureCode.PROVIDER_BINDING_NOT_FOUND);
    }
  });

  it('rejects disabled eligible targets and unknown validation profiles before execution', () => {
    const registry = snapshot([descriptor('provider-a'), descriptor('provider-b', { enabled: false })]);
    const bindings = new ProviderBindingRegistry(registry, [binding(provider('provider-a'))]);
    expect(() =>
      new ProviderExecutionPlanner().create(
        decision(registry, 'provider-a', ['provider-a', 'provider-b']),
        registry,
        bindings,
        profiles,
        input,
      ),
    ).toThrow(/disabled/);

    const activeRegistry = snapshot();
    const activeBindings = new ProviderBindingRegistry(activeRegistry, [binding(provider('provider-a'))]);
    try {
      new ProviderExecutionPlanner().create(
        decision(activeRegistry),
        activeRegistry,
        activeBindings,
        profiles,
        { ...input, validationProfile: 'STRUCTURED_OUTPUT' as typeof GENERAL_CHAT },
      );
      throw new Error('expected unknown validation profile rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderExecutionPlanError);
      expect((error as ProviderExecutionPlanError).code).toBe(RoutingFailureCode.UNKNOWN_VALIDATION_PROFILE);
    }
  });

  it('rejects duplicate, ineligible, mismatched, and non-stronger explicit branch targets', () => {
    const registry = snapshot([
      descriptor('provider-a', { authorityReliability: ReliabilityTier.STANDARD }),
      descriptor('provider-b', { authorityReliability: ReliabilityTier.STANDARD }),
    ]);
    const bindings = new ProviderBindingRegistry(registry, [
      binding(provider('provider-a')),
      binding(provider('provider-b')),
    ]);
    const primaryBinding = bindings.get(providerId('provider-a'))!;
    const secondaryBinding = bindings.get(providerId('provider-b'))!;
    const primary = {
      purpose: ExecutionTargetPurpose.PRIMARY,
      providerId: providerId('provider-a'),
      bindingIdentity: primaryBinding.identity,
    } as const;
    const fallback = {
      purpose: ExecutionTargetPurpose.FALLBACK,
      providerId: providerId('provider-b'),
      bindingIdentity: secondaryBinding.identity,
    } as const;
    const escalation = {
      purpose: ExecutionTargetPurpose.ESCALATION,
      providerId: providerId('provider-b'),
      bindingIdentity: secondaryBinding.identity,
    } as const;
    const authority = profiles.resolve(AUTHORITY_SENSITIVE);

    expect(() =>
      assertProviderExecutionTargets(
        primary,
        { ...primary, purpose: ExecutionTargetPurpose.FALLBACK },
        null,
        [providerId('provider-a'), providerId('provider-b')],
        registry,
        bindings,
        authority,
      ),
    ).toThrow(/unique/);
    expect(() =>
      assertProviderExecutionTargets(
        primary,
        null,
        { ...primary, purpose: ExecutionTargetPurpose.ESCALATION },
        [providerId('provider-a'), providerId('provider-b')],
        registry,
        bindings,
        authority,
      ),
    ).toThrow(/unique/);
    expect(() =>
      assertProviderExecutionTargets(primary, fallback, escalation, [providerId('provider-a'), providerId('provider-b')], registry, bindings, authority),
    ).toThrow(/unique/);
    expect(() =>
      assertProviderExecutionTargets(primary, fallback, null, [providerId('provider-a')], registry, bindings, authority),
    ).toThrow(/eligibility/);
    expect(() =>
      assertProviderExecutionTargets(
        primary,
        { ...fallback, bindingIdentity: { ...fallback.bindingIdentity, bindingDigest: 'd'.repeat(64) } },
        null,
        [providerId('provider-a'), providerId('provider-b')],
        registry,
        bindings,
        authority,
      ),
    ).toThrow(/binding identity mismatch/);
    expect(() =>
      assertProviderExecutionTargets(primary, null, escalation, [providerId('provider-a'), providerId('provider-b')], registry, bindings, authority),
    ).toThrow(/stronger/);
  });

  it('binds every execution-relevant vector and excludes runtime/audit-only values from digests', () => {
    const registry = snapshot([
      descriptor('provider-a', { authorityReliability: ReliabilityTier.LOW }),
      descriptor('provider-b', { authorityReliability: ReliabilityTier.HIGH }),
    ]);
    const bindings = new ProviderBindingRegistry(registry, [binding(provider('provider-a')), binding(provider('provider-b'))]);
    const create = (overrides: Partial<typeof input> = {}, profileRegistry: ValidationProfileRegistry = profiles) =>
      new ProviderExecutionPlanner().create(
        decision(registry, 'provider-a', ['provider-a', 'provider-b']),
        registry,
        bindings,
        profileRegistry,
        { ...input, validationProfile: AUTHORITY_SENSITIVE, ...overrides },
      );
    const base = create({ executionId: 'execution-a' });
    const same = create({ executionId: 'execution-b' });
    expect(base.executionConfigurationDigest).toBe(same.executionConfigurationDigest);
    expect(base.planDigest).toBe(same.planDigest);

    const noEscalation = computeProviderExecutionConfigurationDigest({ ...base, semanticEscalation: null });
    expect(noEscalation).not.toBe(base.executionConfigurationDigest);
    const noBranches = { ...base, operationalFallback: null, semanticEscalation: null };
    expect(
      computeProviderExecutionConfigurationDigest({
        ...noBranches,
        operationalFallback: base.semanticEscalation && {
          ...base.semanticEscalation,
          purpose: ExecutionTargetPurpose.FALLBACK,
        },
      }),
    ).not.toBe(computeProviderExecutionConfigurationDigest(noBranches));
    expect(
      computeProviderExecutionConfigurationDigest({
        ...base,
        semanticEscalation: base.semanticEscalation && {
          ...base.semanticEscalation,
          purpose: ExecutionTargetPurpose.FALLBACK,
        },
      }),
    ).not.toBe(base.executionConfigurationDigest);
    expect(
      computeProviderExecutionConfigurationDigest({
        ...base,
        primary: {
          ...base.primary,
          bindingIdentity: { ...base.primary.bindingIdentity, bindingDigest: 'd'.repeat(64) },
        },
      }),
    ).not.toBe(base.executionConfigurationDigest);
    expect(
      computeProviderExecutionConfigurationDigest({ ...base, failureMatrixVersion: 'routing-failure-matrix-v2' }),
    ).not.toBe(base.executionConfigurationDigest);
    expect(
      computeProviderExecutionConfigurationDigest({ ...base, deadlineClass: DeadlineClass.EXTENDED }),
    ).not.toBe(base.executionConfigurationDigest);
    expect(
      computeProviderExecutionConfigurationDigest({
        ...base,
        validationProfileConfigurationDigest: 'e'.repeat(64),
      }),
    ).not.toBe(base.executionConfigurationDigest);

    const currentProfile = profiles.resolve(AUTHORITY_SENSITIVE);
    const changedProfileRegistry = new ValidationProfileRegistry([
      {
        profileId: currentProfile.profileId,
        version: '2',
        rules: currentProfile.rules,
        outputLimitBytes: currentProfile.outputLimitBytes,
        escalationEnabled: currentProfile.escalationEnabled,
        escalationReliabilityAxis: currentProfile.escalationReliabilityAxis,
        minimumEscalationReliability: currentProfile.minimumEscalationReliability,
      },
    ]);
    expect(create({}, changedProfileRegistry).executionConfigurationDigest).not.toBe(base.executionConfigurationDigest);

    const runtimeOnlyV1 = { ...base, timestamp: '2026-01-01', durationMs: 1, auditSchemaVersion: 'v1' };
    const runtimeOnlyV2 = { ...base, timestamp: '2027-01-01', durationMs: 999, auditSchemaVersion: 'v2' };
    expect(computeProviderExecutionConfigurationDigest(runtimeOnlyV1)).toBe(
      computeProviderExecutionConfigurationDigest(runtimeOnlyV2),
    );
  });
});
