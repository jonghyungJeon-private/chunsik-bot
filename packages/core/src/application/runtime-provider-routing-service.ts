import { Capability, IntentType } from '../domain';
import type { AiRequest } from '../ports';
import {
  DEFAULT_PROVIDER_DEADLINE_POLICY,
  SYSTEM_MONOTONIC_CLOCK,
  type MonotonicClock,
  type ProviderDeadlinePolicy,
} from './deadline-policy';
import {
  type ExecutableProviderBinding,
  ProviderBindingFailureCode,
  ProviderBindingRegistry,
} from './provider-binding-registry';
import { DeadlineClass, ProviderExecutionPlanError, ProviderExecutionPlanner } from './provider-execution-plan';
import { ProviderRegistry } from './provider-registry';
import {
  ProviderGatewayTerminalStatus,
  ProviderRoutingGateway,
  type ProviderExecutionAudit,
  type ProviderGatewayFailureCode,
} from './provider-routing-gateway';
import {
  AuthorityRequirement,
  LatencyClass,
  OutputSizeClass,
  ProviderAvailability,
  type ProviderId,
  type ProviderSelectionDecision,
  Requirement,
  type RoutingContext,
  RoutingReasonCode,
  RoutingRequestType,
  SemanticRisk,
} from './provider-routing-contracts';
import { RoutingPolicyEngine } from './routing-policy-engine';
import {
  type BoundedProviderOutput,
  RoutingFailureCode,
} from './runtime-response-validation-contracts';
import {
  GENERAL_CHAT,
  type ValidationProfileRegistry,
} from './validation-profile-registry';

/** Existing, bounded Runtime facts used by the deterministic Stage 2B mapping. */
export interface RuntimeProviderRoutingFacts {
  readonly capability: Capability;
  readonly intentType: IntentType;
  readonly requiresWork: boolean;
}

/** The single Runtime route approved for the offline Slice 5A seam. */
const GENERAL_CHAT_CONTEXT = Object.freeze({
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
}) satisfies RoutingContext;

const RUNTIME_ROUTING_CONTEXTS = Object.freeze({
  [Capability.GENERAL_CHAT]: GENERAL_CHAT_CONTEXT,
}) satisfies Readonly<Partial<Record<Capability, RoutingContext>>>;

/**
 * Pure Runtime-facts mapping. It does not inspect message text, Provider/model identity,
 * evidence, time, randomness, or external state.
 */
export function mapRuntimeProviderRoutingContext(
  facts: RuntimeProviderRoutingFacts,
): RoutingContext | null {
  if (
    facts.capability !== Capability.GENERAL_CHAT ||
    facts.intentType !== IntentType.CHAT ||
    facts.requiresWork !== true
  ) {
    return null;
  }
  return RUNTIME_ROUTING_CONTEXTS[facts.capability] ?? null;
}

export type RuntimeProviderRoutingFailureCode = ProviderGatewayFailureCode | RoutingReasonCode;

/** Bounded TaskRun metadata; deliberately excludes prompts, outputs, raw errors, and model identity. */
export interface RuntimeProviderRoutingAudit {
  readonly schemaVersion: 'runtime-provider-routing-audit-v1';
  readonly routingContext: RoutingContext | null;
  readonly selectionDecision: ProviderSelectionDecision | null;
  readonly gatewayAudit: ProviderExecutionAudit | null;
  readonly terminalStatus: ProviderGatewayTerminalStatus;
  readonly terminalCode: RuntimeProviderRoutingFailureCode | null;
}

export interface RuntimeProviderRoutingResult {
  readonly status: ProviderGatewayTerminalStatus;
  readonly failureCode: RuntimeProviderRoutingFailureCode | null;
  /** Present only for an accepted, validated Gateway output. */
  readonly output?: BoundedProviderOutput;
  /** Present only for an accepted output and never copied to a non-accepted TaskRun. */
  readonly acceptedProviderId?: ProviderId;
  readonly audit: RuntimeProviderRoutingAudit;
}

export interface RuntimeProviderRoutingRequest {
  readonly facts: RuntimeProviderRoutingFacts;
  readonly request: AiRequest;
  /** Caller-owned TaskRun identity. */
  readonly executionId: string;
}

/** Narrow ConversationRuntime collaborator; production activation remains a composition-root decision. */
export interface RuntimeProviderRouting {
  execute(input: RuntimeProviderRoutingRequest): Promise<RuntimeProviderRoutingResult>;
}

export interface RuntimeProviderRoutingConfiguration {
  readonly providerRegistry: ProviderRegistry;
  readonly policyEngine: RoutingPolicyEngine;
  readonly bindings: readonly ExecutableProviderBinding[];
  readonly validationProfiles: ValidationProfileRegistry;
  readonly planner?: ProviderExecutionPlanner;
  readonly deadlinePolicy?: ProviderDeadlinePolicy;
  readonly clock?: MonotonicClock;
}

const GATEWAY_FAILURE_CODES = new Set<string>([
  ...Object.values(ProviderBindingFailureCode),
  ...Object.values(RoutingFailureCode),
]);

function configurationFailureCode(error: unknown): ProviderGatewayFailureCode {
  if (error instanceof ProviderExecutionPlanError) return error.code;
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    GATEWAY_FAILURE_CODES.has(error.code)
  ) {
    return error.code as ProviderGatewayFailureCode;
  }
  return RoutingFailureCode.ROUTING_CONFIGURATION_MISMATCH;
}

function freezeAudit(
  routingContext: RoutingContext | null,
  selectionDecision: ProviderSelectionDecision | null,
  gatewayAudit: ProviderExecutionAudit | null,
  terminalStatus: ProviderGatewayTerminalStatus,
  terminalCode: RuntimeProviderRoutingFailureCode | null,
): RuntimeProviderRoutingAudit {
  return Object.freeze({
    schemaVersion: 'runtime-provider-routing-audit-v1',
    routingContext,
    selectionDecision,
    gatewayAudit,
    terminalStatus,
    terminalCode,
  });
}

/**
 * Offline-ready integration seam from bounded Runtime facts to the existing Stage 2B Gateway.
 * It owns neither prompt creation nor persistence, response wording, adapter construction, or startup.
 */
export class RuntimeProviderRoutingService implements RuntimeProviderRouting {
  private readonly providerRegistry: ProviderRegistry;
  private readonly policyEngine: RoutingPolicyEngine;
  private readonly bindings: readonly ExecutableProviderBinding[];
  private readonly validationProfiles: ValidationProfileRegistry;
  private readonly planner: ProviderExecutionPlanner;
  private readonly deadlinePolicy: ProviderDeadlinePolicy;
  private readonly clock: MonotonicClock;

  constructor(configuration: RuntimeProviderRoutingConfiguration) {
    this.providerRegistry = configuration.providerRegistry;
    this.policyEngine = configuration.policyEngine;
    this.bindings = Object.freeze(
      configuration.bindings.map((binding) => Object.freeze({ ...binding })),
    );
    this.validationProfiles = configuration.validationProfiles;
    this.planner = configuration.planner ?? new ProviderExecutionPlanner();
    this.deadlinePolicy = configuration.deadlinePolicy ?? DEFAULT_PROVIDER_DEADLINE_POLICY;
    this.clock = configuration.clock ?? SYSTEM_MONOTONIC_CLOCK;

    // Construction validation is descriptor/binding/profile-only and performs no availability probe.
    new ProviderBindingRegistry(configuration.providerRegistry.snapshot(), this.bindings);
    configuration.validationProfiles.resolve(GENERAL_CHAT);
  }

  async execute(input: RuntimeProviderRoutingRequest): Promise<RuntimeProviderRoutingResult> {
    const routingContext = mapRuntimeProviderRoutingContext(input.facts);
    if (routingContext === null || input.request.capability !== Capability.GENERAL_CHAT) {
      return this.failure(
        routingContext,
        null,
        null,
        ProviderGatewayTerminalStatus.CONFIGURATION_FAILED,
        RoutingFailureCode.ROUTING_CONFIGURATION_MISMATCH,
      );
    }

    let decision: ProviderSelectionDecision | null = null;
    let gatewayInvoked = false;
    try {
      const availabilityEntries = await Promise.all(
        this.bindings.map(async (binding): Promise<readonly [ProviderId, ProviderAvailability]> => {
          let available = false;
          try {
            available = (await binding.provider.isAvailable()) === true;
          } catch {
            available = false;
          }
          return Object.freeze([
            binding.providerId,
            available ? ProviderAvailability.AVAILABLE : ProviderAvailability.UNAVAILABLE,
          ] as const);
        }),
      );
      const availability = Object.freeze(Object.fromEntries(availabilityEntries));
      const snapshot = this.providerRegistry.snapshot(availability);
      const bindingRegistry = new ProviderBindingRegistry(snapshot, this.bindings);
      decision = this.policyEngine.select(routingContext, snapshot);

      if (decision.reasonCode !== RoutingReasonCode.SELECTED) {
        const status =
          decision.reasonCode === RoutingReasonCode.POLICY_NOT_MATCHED
            ? ProviderGatewayTerminalStatus.CONFIGURATION_FAILED
            : ProviderGatewayTerminalStatus.EXECUTION_FAILED;
        return this.failure(routingContext, decision, null, status, decision.reasonCode);
      }

      const plan = this.planner.create(
        decision,
        snapshot,
        bindingRegistry,
        this.validationProfiles,
        {
          capability: Capability.GENERAL_CHAT,
          validationProfile: GENERAL_CHAT,
          deadlineClass: DeadlineClass.STANDARD,
          executionId: input.executionId,
        },
      );
      const gateway = new ProviderRoutingGateway(
        bindingRegistry,
        this.validationProfiles,
        this.deadlinePolicy,
        this.clock,
      );
      gatewayInvoked = true;
      const result = await gateway.execute(plan, input.request);
      if (
        result.status === ProviderGatewayTerminalStatus.ACCEPTED &&
        result.output !== undefined &&
        result.audit.finalProviderId !== null
      ) {
        return Object.freeze({
          status: result.status,
          failureCode: result.failureCode,
          output: result.output,
          acceptedProviderId: result.audit.finalProviderId,
          audit: freezeAudit(routingContext, decision, result.audit, result.status, result.failureCode),
        });
      }
      if (result.status === ProviderGatewayTerminalStatus.ACCEPTED) {
        return this.failure(
          routingContext,
          decision,
          result.audit,
          ProviderGatewayTerminalStatus.CONFIGURATION_FAILED,
          RoutingFailureCode.ROUTING_CONFIGURATION_MISMATCH,
        );
      }
      return Object.freeze({
        status: result.status,
        failureCode: result.failureCode,
        audit: freezeAudit(routingContext, decision, result.audit, result.status, result.failureCode),
      });
    } catch (error) {
      return this.failure(
        routingContext,
        decision,
        null,
        gatewayInvoked
          ? ProviderGatewayTerminalStatus.EXECUTION_FAILED
          : ProviderGatewayTerminalStatus.CONFIGURATION_FAILED,
        gatewayInvoked
          ? RoutingFailureCode.PROVIDER_EXECUTION_FAILED
          : configurationFailureCode(error),
      );
    }
  }

  private failure(
    routingContext: RoutingContext | null,
    selectionDecision: ProviderSelectionDecision | null,
    gatewayAudit: ProviderExecutionAudit | null,
    status: Exclude<ProviderGatewayTerminalStatus, ProviderGatewayTerminalStatus.ACCEPTED>,
    failureCode: RuntimeProviderRoutingFailureCode,
  ): RuntimeProviderRoutingResult {
    return Object.freeze({
      status,
      failureCode,
      audit: freezeAudit(routingContext, selectionDecision, gatewayAudit, status, failureCode),
    });
  }
}
