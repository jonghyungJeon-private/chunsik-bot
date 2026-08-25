import { describe, expect, it, vi } from 'vitest';
import { Capability, IntentType } from '../domain';
import type { AiExecutionResult, AiProvider, AiRequest } from '../ports';
import type { MonotonicClock, ProviderDeadlinePolicy } from './deadline-policy';
import type { ExecutableProviderBinding } from './provider-binding-registry';
import { ProviderRegistry } from './provider-registry';
import { ProviderGatewayTerminalStatus } from './provider-routing-gateway';
import {
  AvailabilityClass,
  AuthorityRequirement,
  ConcurrencyClass,
  ContextCapacity,
  CostTier,
  ExecutionLocality,
  LatencyClass,
  LatencyTier,
  OutputSizeClass,
  RankingDimension,
  ReliabilityTier,
  Requirement,
  RoutingClass,
  RoutingReasonCode,
  RoutingRequestType,
  SemanticRisk,
  SortDirection,
  SupportLevel,
  TerminalDecision,
  TimeoutClass,
  adapterId,
  policyId,
  providerId,
  type ProviderDescriptor,
  type RoutingPolicy,
} from './provider-routing-contracts';
import { RoutingPolicyEngine } from './routing-policy-engine';
import { RoutingFailureCode } from './runtime-response-validation-contracts';
import {
  RuntimeProviderRoutingService,
  mapRuntimeProviderRoutingContext,
} from './runtime-provider-routing-service';
import { GENERAL_CHAT, createDefaultValidationProfileRegistry } from './validation-profile-registry';

const REQUEST: AiRequest = {
  capability: Capability.GENERAL_CHAT,
  prompt: 'private request body',
  metadata: { privateInput: 'must-not-enter-audit' },
};

const DEADLINE_POLICY: ProviderDeadlinePolicy = Object.freeze({
  version: 'slice-5a-test-v1',
  resolve: () => Object.freeze({ overallBudgetMs: 1_000, validationReserveMs: 50, minimumAttemptBudgetMs: 10 }),
});

const CLOCK: MonotonicClock = Object.freeze({ nowMs: () => 0 });

function descriptor(
  id: string,
  options: {
    routingClass?: RoutingClass;
    semanticReliability?: ReliabilityTier;
  } = {},
): ProviderDescriptor {
  return {
    providerId: providerId(id),
    adapterId: adapterId('fake-text-adapter'),
    modelId: `opaque-${id}`,
    capabilities: {
      supportedCapabilities: [Capability.GENERAL_CHAT],
      routingClasses: [options.routingClass ?? RoutingClass.BALANCED],
      semanticReliability: options.semanticReliability ?? ReliabilityTier.STANDARD,
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
    enabled: true,
    profileVersion: 'profile-v1',
  };
}

const POLICY: RoutingPolicy = {
  policyId: policyId('general-chat-v1'),
  version: 'policy-v1',
  precedence: 100,
  when: {
    capabilities: [Capability.GENERAL_CHAT],
    requestTypes: [RoutingRequestType.CONVERSATIONAL],
    intentTypes: [IntentType.CHAT],
    semanticRisks: [SemanticRisk.STANDARD],
    latencyClasses: [LatencyClass.BALANCED],
    toolUseRequirements: [Requirement.NOT_REQUIRED],
    authorityRequirements: [AuthorityRequirement.NOT_REQUIRED],
    continuityRequirements: [Requirement.UNKNOWN],
    outputSizes: [OutputSizeClass.MEDIUM],
    validationProfiles: [GENERAL_CHAT],
  },
  eligibility: {},
  ranking: [
    {
      dimension: RankingDimension.ROUTING_CLASS,
      direction: SortDirection.ASCENDING,
      routingClassPreference: [RoutingClass.BALANCED, RoutingClass.SEMANTIC_HIGH],
    },
    { dimension: RankingDimension.SEMANTIC_RELIABILITY, direction: SortDirection.DESCENDING },
  ],
  terminal: TerminalDecision.NO_SELECTION,
};

type FakeProvider = AiProvider & {
  isAvailable: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
};

function fakeProvider(
  id: string,
  available: boolean | 'throw',
  result: AiExecutionResult = { text: `answer from ${id}` },
): FakeProvider {
  return {
    id,
    capabilities: [{ capability: Capability.GENERAL_CHAT, priority: 1 }],
    isAvailable: vi.fn(async () => {
      if (available === 'throw') throw new Error('private availability detail');
      return available;
    }),
    execute: vi.fn(async () => result),
  };
}

function serviceFor(
  providers: readonly FakeProvider[],
  descriptorOptions: Readonly<
    Record<string, { routingClass?: RoutingClass; semanticReliability?: ReliabilityTier }>
  > = {},
): RuntimeProviderRoutingService {
  const descriptors = providers.map((provider) => descriptor(provider.id, descriptorOptions[provider.id]));
  const providerRegistry = new ProviderRegistry(
    'registry-v1',
    descriptors.map((value) => ({ providerId: value.providerId, descriptor: value })),
  );
  const bindings: ExecutableProviderBinding[] = providers.map((provider) => ({
    providerId: providerId(provider.id),
    adapterId: adapterId('fake-text-adapter'),
    modelId: `opaque-${provider.id}`,
    bindingVersion: 'binding-v1',
    provider,
  }));
  return new RuntimeProviderRoutingService({
    providerRegistry,
    policyEngine: new RoutingPolicyEngine({ version: 'policy-config-v1', policies: [POLICY] }),
    bindings,
    validationProfiles: createDefaultValidationProfileRegistry(),
    deadlinePolicy: DEADLINE_POLICY,
    clock: CLOCK,
  });
}

describe('RuntimeProviderRoutingService — Slice 5A offline seam', () => {
  it('maps only a TaskRun-backed GENERAL_CHAT work fact set to the exact static RoutingContext', () => {
    const context = mapRuntimeProviderRoutingContext({
      capability: Capability.GENERAL_CHAT,
      intentType: IntentType.CHAT,
      requiresWork: true,
    });

    expect(context).toEqual({
      capability: Capability.GENERAL_CHAT,
      requestType: RoutingRequestType.CONVERSATIONAL,
      intentType: IntentType.CHAT,
      semanticRisk: SemanticRisk.STANDARD,
      latencyClass: LatencyClass.BALANCED,
      toolUseRequirement: Requirement.NOT_REQUIRED,
      authorityRequirement: AuthorityRequirement.NOT_REQUIRED,
      continuityRequirement: Requirement.UNKNOWN,
      expectedOutputSize: OutputSizeClass.MEDIUM,
      validationProfile: GENERAL_CHAT,
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(
      mapRuntimeProviderRoutingContext({
        capability: Capability.PROJECT_ANALYSIS,
        intentType: IntentType.PROJECT_ANALYSIS,
        requiresWork: true,
      }),
    ).toBeNull();
    expect(
      mapRuntimeProviderRoutingContext({
        capability: Capability.GENERAL_CHAT,
        intentType: IntentType.CHAT,
        requiresWork: false,
      }),
    ).toBeNull();
  });

  it('probes each configured fake Provider once, then connects selection → plan → Gateway without re-probing', async () => {
    const alpha = fakeProvider('alpha', true, {
      text: 'bounded answer',
      raw: { privateRaw: 'must-not-escape' },
      audit: { privateAdapterAudit: 'must-not-escape' },
    });
    const beta = fakeProvider('beta', true);
    const service = serviceFor([beta, alpha]);

    expect(alpha.isAvailable).not.toHaveBeenCalled();
    expect(beta.isAvailable).not.toHaveBeenCalled();

    const result = await service.execute({
      facts: { capability: Capability.GENERAL_CHAT, intentType: IntentType.CHAT, requiresWork: true },
      request: REQUEST,
      executionId: 'task-run-1',
    });

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.ACCEPTED,
      failureCode: null,
      acceptedProviderId: 'alpha',
      output: { text: 'bounded answer' },
      audit: {
        schemaVersion: 'runtime-provider-routing-audit-v1',
        terminalStatus: ProviderGatewayTerminalStatus.ACCEPTED,
        terminalCode: null,
        selectionDecision: { selectedProviderId: 'alpha', reasonCode: RoutingReasonCode.SELECTED },
        gatewayAudit: {
          schemaVersion: 'provider-execution-audit-v2',
          terminalStatus: ProviderGatewayTerminalStatus.ACCEPTED,
          finalProviderId: 'alpha',
        },
      },
    });
    expect(alpha.isAvailable).toHaveBeenCalledTimes(1);
    expect(beta.isAvailable).toHaveBeenCalledTimes(1);
    expect(alpha.execute).toHaveBeenCalledTimes(1);
    expect(beta.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/private request body|must-not-enter-audit|must-not-escape|opaque-alpha/);
  });

  it('fails before selection for an unsupported capability and performs no availability or Provider call', async () => {
    const provider = fakeProvider('alpha', true);
    const result = await serviceFor([provider]).execute({
      facts: {
        capability: Capability.PROJECT_ANALYSIS,
        intentType: IntentType.PROJECT_ANALYSIS,
        requiresWork: true,
      },
      request: { capability: Capability.PROJECT_ANALYSIS, prompt: 'private unsupported input' },
      executionId: 'task-run-unsupported',
    });

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.CONFIGURATION_FAILED,
      failureCode: RoutingFailureCode.ROUTING_CONFIGURATION_MISMATCH,
      audit: {
        routingContext: null,
        selectionDecision: null,
        gatewayAudit: null,
        terminalStatus: ProviderGatewayTerminalStatus.CONFIGURATION_FAILED,
      },
    });
    expect(provider.isAvailable).not.toHaveBeenCalled();
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it('passes through a real Gateway safety terminal with audit and no accepted Provider identity', async () => {
    const provider = fakeProvider('alpha', true, { text: `leak: ${REQUEST.prompt}` });
    const result = await serviceFor([provider]).execute({
      facts: { capability: Capability.GENERAL_CHAT, intentType: IntentType.CHAT, requiresWork: true },
      request: REQUEST,
      executionId: 'task-run-safety-blocked',
    });

    expect(result.status).toBe(ProviderGatewayTerminalStatus.SAFETY_BLOCKED);
    expect(result.failureCode).toBe(RoutingFailureCode.PROMPT_LEAK);
    expect(result.audit.gatewayAudit).not.toBeNull();
    expect(result.acceptedProviderId).toBeUndefined();
    expect(result).not.toHaveProperty('humanReviewRequired');
    expect(result.audit.terminalCode).toBe(RoutingFailureCode.PROMPT_LEAK);
    expect(provider.isAvailable).toHaveBeenCalledTimes(1);
    expect(provider.execute).toHaveBeenCalledTimes(1);
  });

  it('uses the existing bounded semantic escalation path and revalidates the repaired grounded response', async () => {
    const fact = 'The selected release codename is Atlas.';
    const request: AiRequest = {
      capability: Capability.GENERAL_CHAT,
      prompt: `# Context\nimmediatelyPreviousUserTurn: ${JSON.stringify(fact)}`,
    };
    const primary = fakeProvider('alpha', true, { text: 'The selected release codename is Zephyr.' });
    const repair = fakeProvider('beta', true, { text: 'The selected release codename is Atlas.' });
    const service = serviceFor([primary, repair], {
      beta: {
        routingClass: RoutingClass.SEMANTIC_HIGH,
        semanticReliability: ReliabilityTier.HIGH,
      },
    });

    const result = await service.execute({
      facts: { capability: Capability.GENERAL_CHAT, intentType: IntentType.CHAT, requiresWork: true },
      request,
      executionId: 'task-run-grounding-repair',
    });

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.ACCEPTED,
      failureCode: null,
      acceptedProviderId: 'beta',
      output: { text: 'The selected release codename is Atlas.' },
      audit: {
        gatewayAudit: {
          path: 'ESCALATION',
          attemptCount: 2,
          attempts: [
            {
              failureCode: RoutingFailureCode.SEMANTIC_VALIDATION_FAILED,
              validationReasonCodes: ['RECENCY_GROUNDING_VIOLATION'],
            },
            { failureCode: null, validationReasonCodes: [] },
          ],
        },
      },
    });
    expect(primary.execute).toHaveBeenCalledTimes(1);
    expect(repair.execute).toHaveBeenCalledTimes(1);
  });

  it('turns unavailable/throwing probes into one immutable no-selection snapshot and a bounded audited result', async () => {
    const unavailable = fakeProvider('alpha', false);
    const throwing = fakeProvider('beta', 'throw');
    const result = await serviceFor([unavailable, throwing]).execute({
      facts: { capability: Capability.GENERAL_CHAT, intentType: IntentType.CHAT, requiresWork: true },
      request: REQUEST,
      executionId: 'task-run-unavailable',
    });

    expect(result).toMatchObject({
      status: ProviderGatewayTerminalStatus.EXECUTION_FAILED,
      failureCode: RoutingReasonCode.NO_ELIGIBLE_PROVIDER,
      audit: {
        terminalStatus: ProviderGatewayTerminalStatus.EXECUTION_FAILED,
        terminalCode: RoutingReasonCode.NO_ELIGIBLE_PROVIDER,
        selectionDecision: {
          selectedProviderId: null,
          eligibleProviderIds: [],
          reasonCode: RoutingReasonCode.NO_ELIGIBLE_PROVIDER,
        },
        gatewayAudit: null,
      },
    });
    expect(unavailable.isAvailable).toHaveBeenCalledTimes(1);
    expect(throwing.isAvailable).toHaveBeenCalledTimes(1);
    expect(unavailable.execute).not.toHaveBeenCalled();
    expect(throwing.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private availability detail');
  });
});
