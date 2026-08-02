import { describe, expect, it, vi } from 'vitest';
import { AiFailureKind, Capability } from '../domain';
import { AiProviderError } from '../errors';
import type { AiExecutionResult, AiProvider, AiRequest } from '../ports';
import {
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
  ProviderExecutionPlan,
  ProviderExecutionPlanner,
  combinedRoutingConfigurationDigest,
} from './provider-execution-plan';
import { ProviderExecutionOutcome, ProviderRoutingGateway } from './provider-routing-gateway';

const POLICY_DIGEST = 'c'.repeat(64);
const REQUEST: AiRequest = {
  capability: Capability.GENERAL_CHAT,
  prompt: 'private request body',
  metadata: { privateInput: 'not-for-audit' },
};

function descriptor(id: string, enabled = true): ProviderDescriptor {
  return {
    providerId: providerId(id),
    adapterId: adapterId('local-text-adapter'),
    modelId: `opaque-${id}`,
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
    enabled,
    profileVersion: 'profile-v1',
  };
}

function snapshot(descriptors: readonly ProviderDescriptor[], version = 'registry-v1'): ProviderRegistrySnapshot {
  const registry = new ProviderRegistry(
    version,
    descriptors.map((value) => ({ providerId: value.providerId, descriptor: value })),
  );
  return registry.snapshot(
    Object.fromEntries(descriptors.map((value) => [value.providerId, ProviderAvailability.AVAILABLE])),
  );
}

function fakeProvider(
  id: string,
  execute: (request: AiRequest) => Promise<AiExecutionResult>,
): AiProvider & { id: string; execute: ReturnType<typeof vi.fn>; isAvailable: ReturnType<typeof vi.fn> } {
  return {
    id,
    capabilities: [{ capability: Capability.GENERAL_CHAT, priority: 1 }],
    isAvailable: vi.fn(async () => true),
    execute: vi.fn(execute),
  };
}

function binding(value: AiProvider): ExecutableProviderBinding {
  return {
    providerId: providerId(value.id),
    adapterId: adapterId('local-text-adapter'),
    modelId: `opaque-${value.id}`,
    bindingVersion: 'binding-v1',
    provider: value,
  };
}

function decision(registry: ProviderRegistrySnapshot): ProviderSelectionDecision {
  return {
    selectedProviderId: providerId('provider-a'),
    eligibleProviderIds: [providerId('provider-a'), providerId('provider-b')],
    matchedPolicyId: policyId('balanced-v1'),
    reasonCode: RoutingReasonCode.SELECTED,
    policyVersion: 'policy-v1',
    registryVersion: registry.version,
    registryConfigurationDigest: registry.configurationDigest,
    policyConfigurationDigest: POLICY_DIGEST,
    configurationDigest: combinedRoutingConfigurationDigest(registry.configurationDigest, POLICY_DIGEST),
  };
}

function plan(registry: ProviderRegistrySnapshot, bindings: ProviderBindingRegistry): ProviderExecutionPlan {
  return new ProviderExecutionPlanner().create(decision(registry), registry, bindings, {
    capability: Capability.GENERAL_CHAT,
    validationProfile: validationProfileId('general-chat-v1'),
  });
}

describe('ProviderRoutingGateway — provenance-bound single attempt', () => {
  it('invokes exactly the selected Provider once and returns a bounded success audit', async () => {
    const selected = fakeProvider('provider-a', async () => ({
      text: 'answer',
      raw: { providerPrivate: 'not-copied-to-routing-audit' },
    }));
    const other = fakeProvider('provider-b', async () => ({ text: 'other' }));
    const registry = snapshot([descriptor('provider-a'), descriptor('provider-b')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(other), binding(selected)]);
    const executionPlan = plan(registry, bindings);
    const result = await new ProviderRoutingGateway(bindings).execute(executionPlan, REQUEST);

    expect(selected.execute).toHaveBeenCalledTimes(1);
    expect(selected.execute).toHaveBeenCalledWith(REQUEST);
    expect(selected.isAvailable).not.toHaveBeenCalled();
    expect(other.execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: ProviderExecutionOutcome.SUCCEEDED,
      result: { text: 'answer' },
      audit: {
        providerId: 'provider-a',
        bindingDigest: executionPlan.bindingIdentity.bindingDigest,
        attemptBudget: 1,
        attemptCount: 1,
        outcome: ProviderExecutionOutcome.SUCCEEDED,
        failureKind: null,
        fallbackAttempted: false,
        escalationAttempted: false,
      },
    });
    expect(JSON.stringify(result.audit)).not.toMatch(/private request|privateInput|providerPrivate|reasoning/);
    expect(Object.isFrozen(result.audit)).toBe(true);
    expect(Object.isFrozen(result.audit.executionOrder)).toBe(true);
  });

  it('preserves classified failure and invokes no alternate Provider', async () => {
    const selected = fakeProvider('provider-a', async () => {
      throw new AiProviderError(AiFailureKind.TIMEOUT, 'masked provider detail');
    });
    const alternate = fakeProvider('provider-b', async () => ({ text: 'must not run' }));
    const registry = snapshot([descriptor('provider-a'), descriptor('provider-b')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(selected), binding(alternate)]);
    const result = await new ProviderRoutingGateway(bindings).execute(plan(registry, bindings), REQUEST);

    expect(result).toMatchObject({
      status: ProviderExecutionOutcome.FAILED,
      failureKind: AiFailureKind.TIMEOUT,
      audit: { attemptCount: 1, failureKind: AiFailureKind.TIMEOUT },
    });
    expect(selected.execute).toHaveBeenCalledTimes(1);
    expect(alternate.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('masked provider detail');
  });

  it('maps an unknown exception to EXECUTION_FAILED after exactly one invocation', async () => {
    const selected = fakeProvider('provider-a', async () => {
      throw new Error('raw implementation stack detail');
    });
    const registry = snapshot([descriptor('provider-a')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(selected)]);
    const result = await new ProviderRoutingGateway(bindings).execute(plan(registry, bindings), REQUEST);

    expect(result).toMatchObject({
      status: ProviderExecutionOutcome.FAILED,
      failureKind: AiFailureKind.EXECUTION_FAILED,
      audit: { attemptCount: 1 },
    });
    expect(selected.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('raw implementation stack detail');
  });

  it('blocks a missing selected binding before invocation', async () => {
    const selected = fakeProvider('provider-a', async () => ({ text: 'answer' }));
    const other = fakeProvider('provider-b', async () => ({ text: 'other' }));
    const registry = snapshot([descriptor('provider-a'), descriptor('provider-b')]);
    const complete = new ProviderBindingRegistry(registry, [binding(selected), binding(other)]);
    const onlyOther = new ProviderBindingRegistry(registry, [binding(other)]);
    const executionPlan = plan(registry, complete);

    const missing = await new ProviderRoutingGateway(onlyOther).execute(executionPlan, REQUEST);
    expect(missing).toMatchObject({
      status: ProviderExecutionOutcome.FAILED,
      failureKind: ProviderBindingFailureCode.PROVIDER_BINDING_NOT_FOUND,
      audit: { attemptCount: 0 },
    });
    expect(selected.execute).not.toHaveBeenCalled();
    expect(other.execute).not.toHaveBeenCalled();
  });

  it('blocks a Plan/current binding digest mismatch before invocation', async () => {
    const selected = fakeProvider('provider-a', async () => ({ text: 'answer' }));
    const registry = snapshot([descriptor('provider-a')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(selected)]);
    const executionPlan = plan(registry, bindings);
    const forgedDigest = {
      ...executionPlan,
      bindingIdentity: { ...executionPlan.bindingIdentity, bindingDigest: 'd'.repeat(64) },
    } as ProviderExecutionPlan;
    const mismatch = await new ProviderRoutingGateway(bindings).execute(forgedDigest, REQUEST);
    expect(mismatch).toMatchObject({
      status: ProviderExecutionOutcome.FAILED,
      failureKind: ProviderBindingFailureCode.PROVIDER_BINDING_MISMATCH,
      audit: { attemptCount: 0 },
    });
    expect(selected.execute).not.toHaveBeenCalled();
  });

  it('rechecks mutable executable identity and blocks mismatch before invocation', async () => {
    const selected = fakeProvider('provider-a', async () => ({ text: 'answer' }));
    const registry = snapshot([descriptor('provider-a')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(selected)]);
    const executionPlan = plan(registry, bindings);
    selected.id = 'provider-b';
    const executableMismatch = await new ProviderRoutingGateway(bindings).execute(executionPlan, REQUEST);
    expect(executableMismatch).toMatchObject({
      status: ProviderExecutionOutcome.FAILED,
      failureKind: ProviderBindingFailureCode.PROVIDER_BINDING_MISMATCH,
      audit: { attemptCount: 0 },
    });
    expect(selected.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['attempt budget', (value: ProviderExecutionPlan) => ({ ...value, attemptBudget: 2 })],
    ['multiple execution order', (value: ProviderExecutionPlan) => ({
      ...value,
      executionOrder: [providerId('provider-a'), providerId('provider-b')],
    })],
    ['deadline', (value: ProviderExecutionPlan) => ({ ...value, overallDeadlineMs: 1_000 })],
    ['fallback', (value: ProviderExecutionPlan) => ({ ...value, fallbackEligible: true })],
    ['escalation', (value: ProviderExecutionPlan) => ({ ...value, escalationEligible: true })],
    ['malformed binding digest', (value: ProviderExecutionPlan) => ({
      ...value,
      bindingIdentity: { ...value.bindingIdentity, bindingDigest: 'malformed' },
    })],
    ['empty binding digest', (value: ProviderExecutionPlan) => ({
      ...value,
      bindingIdentity: { ...value.bindingIdentity, bindingDigest: '' },
    })],
    ['empty binding version', (value: ProviderExecutionPlan) => ({
      ...value,
      bindingIdentity: { ...value.bindingIdentity, bindingVersion: '' },
    })],
    ['selection digest mismatch', (value: ProviderExecutionPlan) => ({
      ...value,
      configurationDigest: 'e'.repeat(64),
    })],
  ])('blocks a manually constructed invalid Plan: %s', async (_name, forge) => {
    const selected = fakeProvider('provider-a', async () => ({ text: 'answer' }));
    const registry = snapshot([descriptor('provider-a')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(selected)]);
    const executionPlan = plan(registry, bindings);
    const forgedPlan = forge(executionPlan) as unknown as ProviderExecutionPlan;
    const result = await new ProviderRoutingGateway(bindings).execute(forgedPlan, REQUEST);
    expect(result).toMatchObject({
      status: ProviderExecutionOutcome.FAILED,
      failureKind: ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH,
      audit: { attemptCount: 0 },
    });
    expect(JSON.stringify(result.audit)).not.toContain('malformed');
    expect(selected.execute).not.toHaveBeenCalled();
  });

  it('blocks a Plan/current-registry configuration mismatch before invocation', async () => {
    const firstProvider = fakeProvider('provider-a', async () => ({ text: 'first' }));
    const secondProvider = fakeProvider('provider-a', async () => ({ text: 'second' }));
    const firstSnapshot = snapshot([descriptor('provider-a')], 'registry-v1');
    const secondSnapshot = snapshot([descriptor('provider-a')], 'registry-v2');
    const firstBindings = new ProviderBindingRegistry(firstSnapshot, [binding(firstProvider)]);
    const secondBindings = new ProviderBindingRegistry(secondSnapshot, [binding(secondProvider)]);

    const result = await new ProviderRoutingGateway(secondBindings).execute(
      plan(firstSnapshot, firstBindings),
      REQUEST,
    );
    expect(result).toMatchObject({
      status: ProviderExecutionOutcome.FAILED,
      failureKind: ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH,
      audit: { attemptCount: 0 },
    });
    expect(firstProvider.execute).not.toHaveBeenCalled();
    expect(secondProvider.execute).not.toHaveBeenCalled();
  });

  it('does not perform Runtime response validation', async () => {
    const selected = fakeProvider('provider-a', async () => ({ text: '' }));
    const registry = snapshot([descriptor('provider-a')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(selected)]);
    const result = await new ProviderRoutingGateway(bindings).execute(plan(registry, bindings), REQUEST);
    expect(result.status).toBe(ProviderExecutionOutcome.SUCCEEDED);
    expect(selected.execute).toHaveBeenCalledTimes(1);
  });
});
