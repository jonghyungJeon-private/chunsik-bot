import { describe, expect, it, vi } from 'vitest';
import { AiFailureKind, Capability } from '../domain';
import { AiProviderError } from '../errors';
import type { AiExecutionResult, AiProvider, AiRequest } from '../ports';
import type { MonotonicClock, ProviderDeadlinePolicy } from './deadline-policy';
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
} from './provider-routing-contracts';
import { ProviderRegistry } from './provider-registry';
import {
  ExecutableProviderBinding,
  ProviderBindingFailureCode,
  ProviderBindingRegistry,
} from './provider-binding-registry';
import {
  DeadlineClass,
  ProviderExecutionPlan,
  ProviderExecutionPlanner,
  combinedRoutingConfigurationDigest,
} from './provider-execution-plan';
import {
  ProviderAttemptOutcome,
  ProviderGatewayTerminalStatus,
  ProviderRoutingGateway,
} from './provider-routing-gateway';
import { MAX_ROUTING_TRANSITIONS } from './routing-execution-state';
import { RoutingFailureCode, RuntimeValidationRule } from './runtime-response-validation-contracts';
import {
  AUTHORITY_SENSITIVE,
  GENERAL_CHAT,
  ValidationProfileRegistry,
  createDefaultValidationProfileRegistry,
} from './validation-profile-registry';

const POLICY_DIGEST = 'c'.repeat(64);
const REQUEST: AiRequest = {
  capability: Capability.GENERAL_CHAT,
  prompt: 'private request body',
  metadata: { privateInput: 'not-for-audit' },
};

class FakeClock implements MonotonicClock {
  value = 0;
  nowMs(): number {
    return this.value;
  }
}

const DEADLINE_POLICY: ProviderDeadlinePolicy = Object.freeze({
  version: 'test-deadline-v1',
  resolve: () => Object.freeze({ overallBudgetMs: 1_000, validationReserveMs: 50, minimumAttemptBudgetMs: 10 }),
});

function descriptor(id: string, authorityReliability = ReliabilityTier.STANDARD): ProviderDescriptor {
  return {
    providerId: providerId(id),
    adapterId: adapterId('local-text-adapter'),
    modelId: `opaque-${id}`,
    capabilities: {
      supportedCapabilities: [Capability.GENERAL_CHAT],
      routingClasses: [RoutingClass.BALANCED],
      semanticReliability: ReliabilityTier.STANDARD,
      authorityReliability,
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
    enabled: true,
    profileVersion: 'profile-v1',
  };
}

function snapshot(
  descriptors: readonly ProviderDescriptor[],
  version = 'registry-v1',
): ProviderRegistrySnapshot {
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
    eligibleProviderIds: registry.providers.map((entry) => entry.descriptor.providerId),
    matchedPolicyId: policyId('balanced-v1'),
    reasonCode: RoutingReasonCode.SELECTED,
    policyVersion: 'policy-v1',
    registryVersion: registry.version,
    registryConfigurationDigest: registry.configurationDigest,
    policyConfigurationDigest: POLICY_DIGEST,
    configurationDigest: combinedRoutingConfigurationDigest(registry.configurationDigest, POLICY_DIGEST),
  };
}

function plan(
  registry: ProviderRegistrySnapshot,
  bindings: ProviderBindingRegistry,
  profiles: ValidationProfileRegistry,
  validationProfile = GENERAL_CHAT,
): ProviderExecutionPlan {
  return new ProviderExecutionPlanner().create(decision(registry), registry, bindings, profiles, {
    capability: Capability.GENERAL_CHAT,
    validationProfile,
    deadlineClass: DeadlineClass.STANDARD,
    executionId: 'caller-execution-1',
  });
}

function gateway(
  bindings: ProviderBindingRegistry,
  profiles: ValidationProfileRegistry,
  clock = new FakeClock(),
): ProviderRoutingGateway {
  return new ProviderRoutingGateway(bindings, profiles, DEADLINE_POLICY, clock);
}

describe('ProviderRoutingGateway — bounded two-attempt orchestration', () => {
  it('validates and returns only bounded primary output', async () => {
    const primary = fakeProvider('provider-a', async () => ({
      text: 'bounded answer',
      raw: { providerPrivate: 'must-not-escape' },
      audit: { hidden: 'provider-audit' },
    }));
    const registry = snapshot([descriptor('provider-a')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(primary)]);
    const profiles = createDefaultValidationProfileRegistry();
    const result = await gateway(bindings, profiles).execute(plan(registry, bindings, profiles), {
      ...REQUEST,
      timeoutMs: 123,
    });

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.ACCEPTED,
      failureCode: null,
      humanReviewRequired: false,
      output: { text: 'bounded answer' },
      audit: {
        schemaVersion: 'provider-execution-audit-v2',
        path: 'PRIMARY_ONLY',
        attemptCount: 1,
        deadlinePolicyVersion: 'test-deadline-v1',
        terminalStatus: ProviderGatewayTerminalStatus.ACCEPTED,
      },
    });
    expect(primary.execute).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 123 }));
    expect(primary.isAvailable).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/must-not-escape|provider-audit|privateInput|private request body/);
    expect(result.audit.transitions).toHaveLength(4);
  });

  it('uses one pre-fixed fallback after a primary operational failure and stops at two attempts', async () => {
    const primary = fakeProvider('provider-a', async () => {
      throw new AiProviderError(AiFailureKind.TIMEOUT, 'private timeout detail');
    });
    const fallback = fakeProvider('provider-b', async () => ({ text: 'fallback answer' }));
    const registry = snapshot([descriptor('provider-a'), descriptor('provider-b')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(primary), binding(fallback)]);
    const profiles = createDefaultValidationProfileRegistry();
    const result = await gateway(bindings, profiles).execute(plan(registry, bindings, profiles), REQUEST);

    expect(result.status).toBe(ProviderGatewayTerminalStatus.ACCEPTED);
    expect(result.output?.text).toBe('fallback answer');
    expect(result.audit.path).toBe('FALLBACK');
    expect(result.audit.attemptCount).toBe(2);
    expect(result.audit.transitions.length).toBeLessThanOrEqual(MAX_ROUTING_TRANSITIONS);
    expect(result.audit.attempts[0]).toMatchObject({
      outcome: ProviderAttemptOutcome.PROVIDER_FAILED,
      failureCode: RoutingFailureCode.PROVIDER_TIMEOUT,
    });
    expect(primary.execute).toHaveBeenCalledTimes(1);
    expect(fallback.execute).toHaveBeenCalledTimes(1);
    expect(fallback.execute).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 950 }));
  });

  it('uses semantic escalation only for the fixed escalation-enabled profile', async () => {
    const primary = fakeProvider('provider-a', async () => ({
      text: 'I verified that production is currently healthy.',
    }));
    const escalation = fakeProvider('provider-b', async () => ({
      text: 'That current-state claim cannot be independently verified from the supplied context.',
    }));
    const registry = snapshot([
      descriptor('provider-a', ReliabilityTier.LOW),
      descriptor('provider-b', ReliabilityTier.HIGH),
    ]);
    const bindings = new ProviderBindingRegistry(registry, [binding(primary), binding(escalation)]);
    const profiles = createDefaultValidationProfileRegistry();
    const result = await gateway(bindings, profiles).execute(
      plan(registry, bindings, profiles, AUTHORITY_SENSITIVE),
      REQUEST,
    );

    expect(result.status).toBe(ProviderGatewayTerminalStatus.ACCEPTED);
    expect(result.audit.path).toBe('ESCALATION');
    expect(result.audit.attemptCount).toBe(2);
    expect(primary.execute).toHaveBeenCalledTimes(1);
    expect(escalation.execute).toHaveBeenCalledTimes(1);
  });

  it('fails closed on safety before deadline and never invokes an alternate', async () => {
    const primary = fakeProvider('provider-a', async () => ({ text: `leak: ${REQUEST.prompt}` }));
    const alternate = fakeProvider('provider-b', async () => ({ text: 'must not run' }));
    const registry = snapshot([descriptor('provider-a'), descriptor('provider-b')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(primary), binding(alternate)]);
    const profiles = createDefaultValidationProfileRegistry();
    const clock = new FakeClock();
    primary.execute.mockImplementationOnce(async () => {
      clock.value = 2_000;
      return { text: `leak: ${REQUEST.prompt}` };
    });
    const result = await gateway(bindings, profiles, clock).execute(plan(registry, bindings, profiles), REQUEST);

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.SAFETY_BLOCKED,
      failureCode: RoutingFailureCode.PROMPT_LEAK,
      humanReviewRequired: true,
      audit: { attemptCount: 1, path: 'PRIMARY_ONLY' },
    });
    expect(alternate.execute).not.toHaveBeenCalled();
  });

  it('does not fallback for output-limit rejection', async () => {
    const primary = fakeProvider('provider-a', async () => ({ text: 'too long' }));
    const fallback = fakeProvider('provider-b', async () => ({ text: 'must not run' }));
    const registry = snapshot([descriptor('provider-a'), descriptor('provider-b')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(primary), binding(fallback)]);
    const profiles = new ValidationProfileRegistry([
      {
        profileId: GENERAL_CHAT,
        version: '1',
        rules: [RuntimeValidationRule.NON_EMPTY, RuntimeValidationRule.OUTPUT_LIMIT],
        outputLimitBytes: 1,
        escalationEnabled: false,
      },
    ]);
    const result = await gateway(bindings, profiles).execute(plan(registry, bindings, profiles), REQUEST);

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.REJECTED,
      failureCode: RoutingFailureCode.OUTPUT_LIMIT_VIOLATION,
      audit: { attemptCount: 1 },
    });
    expect(fallback.execute).not.toHaveBeenCalled();
  });

  it('terminates from PRIMARY_READY with zero attempts when its deadline budget is exhausted', async () => {
    const primary = fakeProvider('provider-a', async () => ({ text: 'must not run' }));
    const registry = snapshot([descriptor('provider-a')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(primary)]);
    const profiles = createDefaultValidationProfileRegistry();
    const clock = new FakeClock();
    let reads = 0;
    clock.nowMs = () => (reads++ === 0 ? 0 : 1_000);
    const result = await gateway(bindings, profiles, clock).execute(plan(registry, bindings, profiles), REQUEST);

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.EXECUTION_FAILED,
      failureCode: RoutingFailureCode.DEADLINE_EXHAUSTED,
      audit: { attemptCount: 0 },
    });
    expect(result.audit.transitions.map((entry) => [entry.from, entry.to])).toContainEqual([
      'PRIMARY_READY',
      'TERMINAL',
    ]);
    expect(primary.execute).not.toHaveBeenCalled();
  });

  it('records successful validation but returns deadline failure when validation completes after deadline', async () => {
    const clock = new FakeClock();
    const primary = fakeProvider('provider-a', async () => {
      clock.value = 1_000;
      return { text: 'valid but late' };
    });
    const registry = snapshot([descriptor('provider-a')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(primary)]);
    const profiles = createDefaultValidationProfileRegistry();
    const result = await gateway(bindings, profiles, clock).execute(plan(registry, bindings, profiles), REQUEST);

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.EXECUTION_FAILED,
      failureCode: RoutingFailureCode.DEADLINE_EXHAUSTED,
      audit: {
        attemptCount: 1,
        attempts: [{ validationSucceeded: true, outcome: ProviderAttemptOutcome.VALIDATION_ACCEPTED }],
      },
    });
    expect(result.output).toBeUndefined();
  });

  it('terminates from FALLBACK_READY without consuming a second attempt when its budget is exhausted', async () => {
    const clock = new FakeClock();
    const primary = fakeProvider('provider-a', async () => {
      clock.value = 1_000;
      throw new AiProviderError(AiFailureKind.TIMEOUT, 'private timeout detail');
    });
    const fallback = fakeProvider('provider-b', async () => ({ text: 'must not run' }));
    const registry = snapshot([descriptor('provider-a'), descriptor('provider-b')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(primary), binding(fallback)]);
    const profiles = createDefaultValidationProfileRegistry();
    const result = await gateway(bindings, profiles, clock).execute(plan(registry, bindings, profiles), REQUEST);

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.EXECUTION_FAILED,
      failureCode: RoutingFailureCode.DEADLINE_EXHAUSTED,
      audit: { attemptCount: 1, path: 'FALLBACK' },
    });
    expect(result.audit.transitions.map((entry) => [entry.from, entry.to])).toContainEqual([
      'FALLBACK_READY',
      'TERMINAL',
    ]);
    expect(fallback.execute).not.toHaveBeenCalled();
  });

  it('returns human review after the one allowed semantic escalation remains unresolved', async () => {
    const unresolved = async () => ({ text: 'I verified that production is currently healthy.' });
    const primary = fakeProvider('provider-a', unresolved);
    const escalation = fakeProvider('provider-b', unresolved);
    const registry = snapshot([
      descriptor('provider-a', ReliabilityTier.LOW),
      descriptor('provider-b', ReliabilityTier.HIGH),
    ]);
    const bindings = new ProviderBindingRegistry(registry, [binding(primary), binding(escalation)]);
    const profiles = createDefaultValidationProfileRegistry();
    const result = await gateway(bindings, profiles).execute(
      plan(registry, bindings, profiles, AUTHORITY_SENSITIVE),
      REQUEST,
    );

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.HUMAN_REVIEW_REQUIRED,
      failureCode: RoutingFailureCode.SEMANTIC_VALIDATION_UNRESOLVED,
      humanReviewRequired: true,
      audit: { attemptCount: 2, path: 'ESCALATION' },
    });
    expect(primary.execute).toHaveBeenCalledTimes(1);
    expect(escalation.execute).toHaveBeenCalledTimes(1);
  });

  it('blocks stale binding provenance before invocation', async () => {
    const primary = fakeProvider('provider-a', async () => ({ text: 'must not run' }));
    const registry = snapshot([descriptor('provider-a')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(primary)]);
    const profiles = createDefaultValidationProfileRegistry();
    const executionPlan = plan(registry, bindings, profiles);
    primary.id = 'provider-mutated';
    const result = await gateway(bindings, profiles).execute(executionPlan, REQUEST);

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.CONFIGURATION_FAILED,
      failureCode: ProviderBindingFailureCode.PROVIDER_BINDING_MISMATCH,
      audit: { attemptCount: 0 },
    });
    expect(primary.execute).not.toHaveBeenCalled();
  });

  it('maps an unknown Provider exception to the existing execution-failure contract', async () => {
    const primary = fakeProvider('provider-a', async () => {
      throw new Error('private implementation detail');
    });
    const registry = snapshot([descriptor('provider-a')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(primary)]);
    const profiles = createDefaultValidationProfileRegistry();
    const result = await gateway(bindings, profiles).execute(plan(registry, bindings, profiles), REQUEST);

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.EXECUTION_FAILED,
      failureCode: RoutingFailureCode.PROVIDER_EXECUTION_FAILED,
      audit: { attemptCount: 1 },
    });
    expect(JSON.stringify(result)).not.toContain('private implementation detail');
  });

  it('blocks a missing selected binding before invocation', async () => {
    const primary = fakeProvider('provider-a', async () => ({ text: 'must not run' }));
    const other = fakeProvider('provider-b', async () => ({ text: 'other' }));
    const registry = snapshot([descriptor('provider-a'), descriptor('provider-b')]);
    const complete = new ProviderBindingRegistry(registry, [binding(primary), binding(other)]);
    const onlyOther = new ProviderBindingRegistry(registry, [binding(other)]);
    const profiles = createDefaultValidationProfileRegistry();
    const result = await gateway(onlyOther, profiles).execute(plan(registry, complete, profiles), REQUEST);

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.CONFIGURATION_FAILED,
      failureCode: ProviderBindingFailureCode.PROVIDER_BINDING_NOT_FOUND,
      audit: { attemptCount: 0 },
    });
    expect(primary.execute).not.toHaveBeenCalled();
    expect(other.execute).not.toHaveBeenCalled();
  });

  it('blocks a current registry identity mismatch before invocation', async () => {
    const first = fakeProvider('provider-a', async () => ({ text: 'must not run' }));
    const second = fakeProvider('provider-a', async () => ({ text: 'must not run either' }));
    const firstRegistry = snapshot([descriptor('provider-a')], 'registry-v1');
    const secondRegistry = snapshot([descriptor('provider-a')], 'registry-v2');
    const firstBindings = new ProviderBindingRegistry(firstRegistry, [binding(first)]);
    const secondBindings = new ProviderBindingRegistry(secondRegistry, [binding(second)]);
    const profiles = createDefaultValidationProfileRegistry();
    const result = await gateway(secondBindings, profiles).execute(
      plan(firstRegistry, firstBindings, profiles),
      REQUEST,
    );

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.CONFIGURATION_FAILED,
      failureCode: ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH,
      audit: { attemptCount: 0 },
    });
    expect(first.execute).not.toHaveBeenCalled();
    expect(second.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['failure matrix version', (value: ProviderExecutionPlan) => ({ ...value, failureMatrixVersion: 'forged-v0' })],
    ['plan digest', (value: ProviderExecutionPlan) => ({ ...value, planDigest: 'd'.repeat(64) })],
  ])('blocks a forged execution plan %s before invocation', async (_name, forge) => {
    const primary = fakeProvider('provider-a', async () => ({ text: 'must not run' }));
    const registry = snapshot([descriptor('provider-a')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(primary)]);
    const profiles = createDefaultValidationProfileRegistry();
    const forged = forge(plan(registry, bindings, profiles)) as ProviderExecutionPlan;
    const result = await gateway(bindings, profiles).execute(forged, REQUEST);

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.CONFIGURATION_FAILED,
      failureCode: ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH,
      audit: { attemptCount: 0 },
    });
    expect(primary.execute).not.toHaveBeenCalled();
  });

  it('rechecks fallback binding provenance immediately before the second attempt', async () => {
    const fallback = fakeProvider('provider-b', async () => ({ text: 'must not run' }));
    const primary = fakeProvider('provider-a', async () => {
      fallback.id = 'provider-mutated';
      throw new AiProviderError(AiFailureKind.TIMEOUT, 'private timeout detail');
    });
    const registry = snapshot([descriptor('provider-a'), descriptor('provider-b')]);
    const bindings = new ProviderBindingRegistry(registry, [binding(primary), binding(fallback)]);
    const profiles = createDefaultValidationProfileRegistry();
    const result = await gateway(bindings, profiles).execute(plan(registry, bindings, profiles), REQUEST);

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.CONFIGURATION_FAILED,
      failureCode: ProviderBindingFailureCode.PROVIDER_BINDING_MISMATCH,
      audit: { attemptCount: 1, path: 'FALLBACK' },
    });
    expect(primary.execute).toHaveBeenCalledTimes(1);
    expect(fallback.execute).not.toHaveBeenCalled();
  });
});
