import {
  AiFailureKind,
  AiProviderError,
  AiRequest,
  AiProvider,
  AvailabilityClass,
  Capability,
  ConcurrencyClass,
  ContextCapacity,
  CostTier,
  DeadlineClass,
  ExecutionLocality,
  ExecutableProviderBinding,
  GENERAL_CHAT,
  AUTHORITY_SENSITIVE,
  LatencyTier,
  MonotonicClock,
  ProviderAvailability,
  ProviderBindingRegistry,
  ProviderDeadlinePolicy,
  ProviderDescriptor,
  ProviderExecutionPlanner,
  ProviderGatewayResult,
  ProviderRegistry,
  ProviderRoutingGateway,
  ProviderSelectionDecision,
  ReliabilityTier,
  RoutingClass,
  RoutingReasonCode,
  SupportLevel,
  TimeoutClass,
  adapterId,
  combinedRoutingConfigurationDigest,
  createDefaultValidationProfileRegistry,
  policyId,
  providerId,
} from '@chunsik/core';
import { harnessDigest } from './canonical';
import {
  CanonicalAuditProjection,
  ProviderFixture,
  ReplayResult,
  RoutingValidationFixture,
} from './contracts';

const POLICY_DIGEST = 'c'.repeat(64);

class ScriptedMonotonicClock implements MonotonicClock {
  constructor(private value: number) {}
  nowMs(): number { return this.value; }
  advance(milliseconds: number): void { this.value += milliseconds; }
}

class ScriptedAiProvider implements AiProvider {
  readonly capabilities = [{ capability: Capability.GENERAL_CHAT, priority: 1 }] as const;
  invocationCount = 0;

  constructor(readonly id: string, private readonly fixture: ProviderFixture, private readonly clock: ScriptedMonotonicClock) {}

  async isAvailable(): Promise<boolean> {
    throw new Error('Harness invariant: runtime availability probes are prohibited');
  }

  async execute(_request: AiRequest) {
    this.invocationCount += 1;
    this.clock.advance(this.fixture.outcome.advanceMs);
    if (this.fixture.outcome.kind === 'RETURN') return { text: this.fixture.outcome.text };
    if (this.fixture.outcome.kind === 'THROW_CLASSIFIED') {
      throw new AiProviderError(this.fixture.outcome.failureKind as AiFailureKind, 'synthetic classified failure');
    }
    throw new Error('synthetic unknown provider failure');
  }
}

function reliability(value: ProviderFixture['authorityReliability']): ReliabilityTier {
  return ReliabilityTier[value];
}

function descriptor(provider: ProviderFixture): ProviderDescriptor {
  return {
    providerId: providerId(provider.id),
    adapterId: adapterId('scripted-validation-adapter'),
    modelId: `synthetic-${provider.id}`,
    capabilities: {
      supportedCapabilities: [Capability.GENERAL_CHAT],
      routingClasses: [RoutingClass.BALANCED],
      semanticReliability: ReliabilityTier.STANDARD,
      authorityReliability: reliability(provider.authorityReliability),
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
    profileVersion: 'synthetic-profile-v1',
  };
}

function binding(provider: ScriptedAiProvider): ExecutableProviderBinding {
  return {
    providerId: providerId(provider.id),
    adapterId: adapterId('scripted-validation-adapter'),
    modelId: `synthetic-${provider.id}`,
    bindingVersion: 'synthetic-binding-v1',
    provider,
  };
}

function project(result: ProviderGatewayResult): CanonicalAuditProjection {
  return Object.freeze({
    terminalStatus: result.status,
    failureCode: result.failureCode,
    humanReviewRequired: result.humanReviewRequired,
    outputText: result.output?.text ?? null,
    path: result.audit.path,
    attemptCount: result.audit.attemptCount,
    attempts: Object.freeze(result.audit.attempts.map((attempt) => Object.freeze({
      attemptIndex: attempt.attemptIndex,
      purpose: attempt.purpose,
      providerId: attempt.providerId,
      outcome: attempt.outcome,
      failureCode: attempt.failureCode,
      validationDisposition: attempt.validationDisposition,
      validationReasonCodes: Object.freeze([...attempt.validationReasonCodes]),
      validationSucceeded: attempt.validationSucceeded,
    }))),
    transitions: Object.freeze(result.audit.transitions.map((transition) => Object.freeze({ ...transition }))),
    finalProviderId: result.audit.finalProviderId,
    finalPurpose: result.audit.finalPurpose,
  });
}

/** Replays one strict fixture through real Core planner, validator and gateway contracts. */
export async function replayFixture(fixture: RoutingValidationFixture): Promise<ReplayResult> {
  const clock = new ScriptedMonotonicClock(fixture.deadline.initialMs);
  const providers = fixture.providers.map((entry) => new ScriptedAiProvider(entry.id, entry, clock));
  const descriptors = fixture.providers.map(descriptor);
  const registry = new ProviderRegistry(
    'synthetic-registry-v1',
    descriptors.map((entry) => ({ providerId: entry.providerId, descriptor: entry })),
  );
  const snapshot = registry.snapshot(
    Object.fromEntries(descriptors.map((entry) => [entry.providerId, ProviderAvailability.AVAILABLE])),
  );
  const bindings = new ProviderBindingRegistry(snapshot, providers.map(binding));
  const profiles = createDefaultValidationProfileRegistry();
  const decision: ProviderSelectionDecision = {
    selectedProviderId: providerId(fixture.selectedProviderId),
    eligibleProviderIds: fixture.providers.map((entry) => providerId(entry.id)),
    matchedPolicyId: policyId('synthetic-balanced-v1'),
    reasonCode: RoutingReasonCode.SELECTED,
    policyVersion: 'synthetic-policy-v1',
    registryVersion: snapshot.version,
    registryConfigurationDigest: snapshot.configurationDigest,
    policyConfigurationDigest: POLICY_DIGEST,
    configurationDigest: combinedRoutingConfigurationDigest(snapshot.configurationDigest, POLICY_DIGEST),
  };
  const profile = fixture.validationProfile === 'GENERAL_CHAT' ? GENERAL_CHAT : AUTHORITY_SENSITIVE;
  const plan = new ProviderExecutionPlanner().create(decision, snapshot, bindings, profiles, {
    capability: Capability.GENERAL_CHAT,
    validationProfile: profile,
    deadlineClass: DeadlineClass.STANDARD,
    executionId: `fixture-${fixture.scenarioId}`,
  });
  const deadlinePolicy: ProviderDeadlinePolicy = Object.freeze({
    version: 'scripted-deadline-v1',
    resolve: () => Object.freeze({
      overallBudgetMs: fixture.deadline.overallBudgetMs,
      validationReserveMs: fixture.deadline.validationReserveMs,
      minimumAttemptBudgetMs: fixture.deadline.minimumAttemptBudgetMs,
    }),
  });
  const gateway = new ProviderRoutingGateway(bindings, profiles, deadlinePolicy, clock);
  const request: AiRequest = {
    capability: Capability.GENERAL_CHAT,
    prompt: fixture.request.prompt,
    ...(fixture.request.timeoutMs === undefined ? {} : { timeoutMs: fixture.request.timeoutMs }),
  };
  const result = await gateway.execute(plan, request);

  for (const attempt of result.audit.attempts) {
    const target = [plan.primary, plan.operationalFallback, plan.semanticEscalation]
      .find((candidate) => candidate?.providerId === attempt.providerId && candidate.purpose === attempt.purpose);
    if (!target || target.bindingIdentity.bindingDigest !== attempt.bindingDigest) {
      throw new Error('Harness invariant: binding provenance was not preserved');
    }
  }

  const projection = project(result);
  return Object.freeze({
    projection,
    projectionDigest: harnessDigest(projection),
    providerInvocations: providers.reduce((sum, provider) => sum + provider.invocationCount, 0),
  });
}

export async function replayFixtureTwice(fixture: RoutingValidationFixture): Promise<readonly [ReplayResult, ReplayResult]> {
  return Promise.all([replayFixture(fixture), replayFixture(fixture)]);
}
