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
  validationProfileId,
} from './provider-routing-contracts';
import { ProviderRegistry } from './provider-registry';
import {
  ExecutableProviderBinding,
  ProviderBindingFailureCode,
  ProviderBindingRegistry,
} from './provider-binding-registry';
import {
  ProviderExecutionPlanError,
  ProviderExecutionPlanner,
  combinedRoutingConfigurationDigest,
} from './provider-execution-plan';

const POLICY_DIGEST = 'c'.repeat(64);

function descriptor(
  id: string,
  options: { adapter?: AdapterId; modelId?: string; enabled?: boolean } = {},
): ProviderDescriptor {
  return {
    providerId: providerId(id),
    adapterId: options.adapter ?? adapterId('local-text-adapter'),
    modelId: options.modelId ?? `opaque-${id}`,
    capabilities: {
      supportedCapabilities: [Capability.GENERAL_CHAT],
      routingClasses: [RoutingClass.BALANCED],
      semanticReliability: ReliabilityTier.STANDARD,
      authorityReliability: ReliabilityTier.STANDARD,
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

function decision(registry: ProviderRegistrySnapshot, selected = 'provider-a'): ProviderSelectionDecision {
  return {
    selectedProviderId: providerId(selected),
    eligibleProviderIds: [providerId(selected)],
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
  validationProfile: validationProfileId('general-chat-v1'),
};

describe('ProviderExecutionPlanner provenance', () => {
  it('deep-freezes the selected binding identity in an immutable single-attempt plan', () => {
    const registry = snapshot();
    const bindings = new ProviderBindingRegistry(registry, [binding(provider('provider-a'))]);
    const plan = new ProviderExecutionPlanner().create(decision(registry), registry, bindings, input);

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
      validationProfile: 'general-chat-v1',
      fallbackEligible: false,
      escalationEligible: false,
      registryConfigurationDigest: registry.configurationDigest,
      policyConfigurationDigest: POLICY_DIGEST,
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.executionOrder)).toBe(true);
    expect(Object.isFrozen(plan.bindingIdentity)).toBe(true);
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
        input,
      ),
    ).toThrow(ProviderExecutionPlanError);
    expect(() =>
      new ProviderExecutionPlanner().create(
        { ...selected, eligibleProviderIds: [providerId('provider-b')] },
        registry,
        bindings,
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
      new ProviderExecutionPlanner().create(selected, otherRegistry, bindings, input),
    ).toThrow(/identity mismatch/);
    expect(() =>
      new ProviderExecutionPlanner().create(
        { ...selected, configurationDigest: 'd'.repeat(64) },
        registry,
        bindings,
        input,
      ),
    ).toThrow(/identity mismatch/);
    expect(() =>
      new ProviderExecutionPlanner().create(
        { ...selected, registryConfigurationDigest: 'bad' },
        registry,
        bindings,
        input,
      ),
    ).toThrow(/digest/);
  });

  it('rejects unavailable selection and a selected Provider without an executable binding', () => {
    const unavailable = snapshot([descriptor('provider-a'), descriptor('provider-b')], ProviderAvailability.UNAVAILABLE);
    const unavailableProvider = provider('provider-a');
    const unavailableBindings = new ProviderBindingRegistry(unavailable, [binding(unavailableProvider)]);
    expect(() =>
      new ProviderExecutionPlanner().create(decision(unavailable), unavailable, unavailableBindings, input),
    ).toThrow(/not eligible/);
    expect(unavailableProvider.execute).not.toHaveBeenCalled();

    const registry = snapshot([descriptor('provider-a'), descriptor('provider-b')]);
    const onlyB = new ProviderBindingRegistry(registry, [binding(provider('provider-b'))]);
    try {
      new ProviderExecutionPlanner().create(decision(registry), registry, onlyB, input);
      throw new Error('expected missing binding rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderExecutionPlanError);
      expect((error as ProviderExecutionPlanError).code).toBe(ProviderBindingFailureCode.PROVIDER_BINDING_NOT_FOUND);
    }
  });
});
