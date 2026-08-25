import { AiFailureKind, Capability } from '../domain';
import { AiProviderError } from '../errors';
import type { AiExecutionResult, AiRequest } from '../ports';
import {
  DEFAULT_PROVIDER_DEADLINE_POLICY,
  DeadlineBudget,
  MonotonicClock,
  ProviderDeadlinePolicy,
  SYSTEM_MONOTONIC_CLOCK,
  effectiveProviderTimeoutMs,
} from './deadline-policy';
import type { ProviderExecutionPlan, ProviderExecutionTarget } from './provider-execution-plan';
import {
  DeadlineClass,
  ExecutionTargetPurpose,
  MAX_ADDITIONAL_PROVIDER_HOPS,
  MAX_PROVIDER_ATTEMPTS,
  combinedRoutingConfigurationDigest,
  computeProviderExecutionConfigurationDigest,
  computeProviderExecutionPlanDigest,
} from './provider-execution-plan';
import {
  ProviderBindingFailureCode,
  ProviderBindingRegistry,
  ValidatedExecutableProviderBinding,
} from './provider-binding-registry';
import type { PolicyId, ProviderId, ValidationProfileId } from './provider-routing-contracts';
import { isRoutingIdentifier } from './provider-routing-contracts';
import {
  classifyProviderFailure,
  classifyValidationFailure,
  failurePolicy,
} from './routing-failure-classifier';
import {
  RoutingExecutionState,
  RoutingExecutionStateMachine,
  RoutingTransitionAudit,
} from './routing-execution-state';
import {
  BoundedProviderOutput,
  ResponseValidationReasonCode,
  ROUTING_FAILURE_MATRIX_VERSION,
  RoutingFailureClass,
  RoutingFailureCode,
  RuntimeValidationResult,
  ValidationDisposition,
} from './runtime-response-validation-contracts';
import { RuntimeResponseValidator, projectBoundedProviderOutput } from './runtime-response-validator';
import { ValidationProfileDefinition, ValidationProfileRegistry } from './validation-profile-registry';

const SHA_256 = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CAPABILITIES = new Set(Object.values(Capability));
const AI_FAILURE_KINDS = new Set(Object.values(AiFailureKind));

export enum ProviderGatewayTerminalStatus {
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  HUMAN_REVIEW_REQUIRED = 'HUMAN_REVIEW_REQUIRED',
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  SAFETY_BLOCKED = 'SAFETY_BLOCKED',
  CONFIGURATION_FAILED = 'CONFIGURATION_FAILED',
}

export enum ProviderAttemptOutcome {
  PROVIDER_FAILED = 'PROVIDER_FAILED',
  VALIDATION_ACCEPTED = 'VALIDATION_ACCEPTED',
  VALIDATION_REJECTED = 'VALIDATION_REJECTED',
}

export type ProviderGatewayFailureCode = RoutingFailureCode | ProviderBindingFailureCode;

export interface ProviderAttemptAudit {
  readonly attemptIndex: 1 | 2;
  readonly purpose: ExecutionTargetPurpose;
  readonly providerId: ProviderId;
  readonly bindingDigest: string;
  readonly outcome: ProviderAttemptOutcome;
  readonly failureCode: RoutingFailureCode | null;
  readonly validationDisposition: ValidationDisposition | null;
  readonly validationReasonCodes: readonly ResponseValidationReasonCode[];
  readonly validationSucceeded: boolean;
  readonly responseSha256: string | null;
  readonly responseByteCount: number | null;
  readonly providerBudgetMs: number;
  readonly durationMs: number;
}

export type ProviderExecutionPath = 'PRIMARY_ONLY' | 'FALLBACK' | 'ESCALATION';

export interface ProviderExecutionAudit {
  readonly schemaVersion: 'provider-execution-audit-v2';
  readonly executionId: string;
  readonly decisionId: string;
  readonly planDigest: string;
  readonly executionConfigurationDigest: string;
  readonly deadlinePolicyVersion: string;
  readonly capability: AiRequest['capability'];
  readonly validationProfile: ValidationProfileId;
  readonly matchedPolicyId: PolicyId;
  readonly policyVersion: string;
  readonly registryVersion: string;
  readonly registryConfigurationDigest: string;
  readonly policyConfigurationDigest: string;
  readonly configurationDigest: string;
  readonly path: ProviderExecutionPath;
  readonly attemptCount: 0 | 1 | 2;
  readonly attempts: readonly ProviderAttemptAudit[];
  readonly transitions: readonly RoutingTransitionAudit[];
  readonly terminalStatus: ProviderGatewayTerminalStatus;
  readonly terminalCode: ProviderGatewayFailureCode | null;
  readonly finalProviderId: ProviderId | null;
  readonly finalPurpose: ExecutionTargetPurpose | null;
  readonly acceptedResponseSha256: string | null;
}

export interface ProviderGatewayResult {
  readonly status: ProviderGatewayTerminalStatus;
  readonly failureCode: ProviderGatewayFailureCode | null;
  readonly humanReviewRequired: boolean;
  readonly output?: BoundedProviderOutput;
  readonly audit: ProviderExecutionAudit;
}

interface AttemptResult {
  readonly target: ProviderExecutionTarget;
  readonly result?: AiExecutionResult;
  readonly failureCode?: RoutingFailureCode;
  readonly providerBudgetMs: number;
  readonly durationMs: number;
}

function validatePlanShape(plan: ProviderExecutionPlan, request: AiRequest): ProviderBindingFailureCode | null {
  if (
    !isRoutingIdentifier(plan.matchedPolicyId) ||
    !VERSION.test(plan.policyVersion) ||
    !VERSION.test(plan.registryVersion) ||
    !SHA_256.test(plan.registryConfigurationDigest) ||
    !SHA_256.test(plan.policyConfigurationDigest) ||
    !SHA_256.test(plan.configurationDigest) ||
    !SHA_256.test(plan.validationProfileConfigurationDigest) ||
    !SHA_256.test(plan.executionConfigurationDigest) ||
    !SHA_256.test(plan.decisionId) ||
    !SHA_256.test(plan.planDigest) ||
    !VERSION.test(plan.validationProfileVersion) ||
    !isRoutingIdentifier(plan.validationProfile) ||
    !isRoutingIdentifier(plan.executionId) ||
    !CAPABILITIES.has(plan.capability) ||
    (request.timeoutMs !== undefined && (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0))
  ) {
    return ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH;
  }
  if (
    plan.configurationDigest !==
      combinedRoutingConfigurationDigest(plan.registryConfigurationDigest, plan.policyConfigurationDigest) ||
    plan.operationalFallback === undefined ||
    plan.semanticEscalation === undefined ||
    plan.primary?.purpose !== ExecutionTargetPurpose.PRIMARY ||
    (plan.operationalFallback !== null && plan.operationalFallback.purpose !== ExecutionTargetPurpose.FALLBACK) ||
    (plan.semanticEscalation !== null && plan.semanticEscalation.purpose !== ExecutionTargetPurpose.ESCALATION) ||
    plan.operationalFallback?.providerId === plan.primary.providerId ||
    plan.semanticEscalation?.providerId === plan.primary.providerId ||
    (plan.operationalFallback !== null &&
      plan.semanticEscalation !== null &&
      plan.operationalFallback.providerId === plan.semanticEscalation.providerId) ||
    [plan.primary, plan.operationalFallback, plan.semanticEscalation]
      .filter((target): target is ProviderExecutionTarget => target !== null)
      .some(
        (target) =>
          !isRoutingIdentifier(target.providerId) ||
          target.bindingIdentity.providerId !== target.providerId ||
          !VERSION.test(target.bindingIdentity.bindingVersion) ||
          !SHA_256.test(target.bindingIdentity.bindingDigest),
      ) ||
    plan.failureMatrixVersion !== ROUTING_FAILURE_MATRIX_VERSION ||
    plan.maxAttempts !== MAX_PROVIDER_ATTEMPTS ||
    plan.maxAdditionalHops !== MAX_ADDITIONAL_PROVIDER_HOPS ||
    !Object.values(DeadlineClass).includes(plan.deadlineClass) ||
    plan.executionConfigurationDigest !== computeProviderExecutionConfigurationDigest(plan) ||
    plan.planDigest !== computeProviderExecutionPlanDigest(plan.decisionId, plan.executionConfigurationDigest) ||
    request.capability !== plan.capability
  ) {
    return ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH;
  }
  return null;
}

function bindingFailure(
  bindings: ProviderBindingRegistry,
  target: ProviderExecutionTarget,
): ProviderBindingFailureCode | null {
  const binding = bindings.get(target.providerId);
  if (!binding) return ProviderBindingFailureCode.PROVIDER_BINDING_NOT_FOUND;
  if (
    binding.providerId !== target.providerId ||
    binding.identity.providerId !== target.providerId ||
    binding.provider.id !== target.providerId ||
    binding.identity.bindingVersion !== target.bindingIdentity.bindingVersion ||
    binding.identity.bindingDigest !== target.bindingIdentity.bindingDigest
  ) {
    return ProviderBindingFailureCode.PROVIDER_BINDING_MISMATCH;
  }
  return null;
}

function terminalStatus(code: ProviderGatewayFailureCode): ProviderGatewayTerminalStatus {
  if (Object.values(ProviderBindingFailureCode).includes(code as ProviderBindingFailureCode)) {
    return ProviderGatewayTerminalStatus.CONFIGURATION_FAILED;
  }
  const routingCode = code as RoutingFailureCode;
  if (
    routingCode === RoutingFailureCode.SEMANTIC_VALIDATION_UNRESOLVED ||
    routingCode === RoutingFailureCode.STRUCTURAL_VALIDATION_UNRESOLVED
  ) {
    return ProviderGatewayTerminalStatus.HUMAN_REVIEW_REQUIRED;
  }
  const policy = failurePolicy(routingCode);
  if (policy.failureClass === RoutingFailureClass.SAFETY) return ProviderGatewayTerminalStatus.SAFETY_BLOCKED;
  if (policy.failureClass === RoutingFailureClass.CONFIGURATION) return ProviderGatewayTerminalStatus.CONFIGURATION_FAILED;
  if (
    routingCode === RoutingFailureCode.EMPTY_OUTPUT ||
    routingCode === RoutingFailureCode.OUTPUT_LIMIT_VIOLATION ||
    policy.failureClass === RoutingFailureClass.VALIDATION
  ) {
    return ProviderGatewayTerminalStatus.REJECTED;
  }
  return ProviderGatewayTerminalStatus.EXECUTION_FAILED;
}

/** Owns bounded execution only; it does not select Providers or integrate Runtime. */
export class ProviderRoutingGateway {
  private readonly validator: RuntimeResponseValidator;

  constructor(
    private readonly bindings: ProviderBindingRegistry,
    private readonly profiles: ValidationProfileRegistry,
    private readonly deadlinePolicy: ProviderDeadlinePolicy = DEFAULT_PROVIDER_DEADLINE_POLICY,
    private readonly clock: MonotonicClock = SYSTEM_MONOTONIC_CLOCK,
  ) {
    this.validator = new RuntimeResponseValidator(profiles);
  }

  async execute(
    plan: ProviderExecutionPlan,
    request: AiRequest,
    validationFacts: Readonly<{ recencyFact?: string; currentUserTurn?: string }> = {},
  ): Promise<ProviderGatewayResult> {
    const machine = new RoutingExecutionStateMachine();
    const attempts: ProviderAttemptAudit[] = [];
    let path: ProviderExecutionPath = 'PRIMARY_ONLY';
    let finalTarget: ProviderExecutionTarget | null = null;

    const finish = (
      status: ProviderGatewayTerminalStatus,
      failureCode: ProviderGatewayFailureCode | null,
      output?: BoundedProviderOutput,
    ): ProviderGatewayResult => {
      if (machine.state !== RoutingExecutionState.TERMINAL) machine.transition(RoutingExecutionState.TERMINAL, failureCode ?? 'ACCEPTED');
      const acceptedResponseSha256 = output?.responseSha256 ?? null;
      const audit: ProviderExecutionAudit = Object.freeze({
        schemaVersion: 'provider-execution-audit-v2',
        executionId: isRoutingIdentifier(plan.executionId) ? plan.executionId : 'invalid-execution',
        decisionId: SHA_256.test(plan.decisionId) ? plan.decisionId : '0'.repeat(64),
        planDigest: SHA_256.test(plan.planDigest) ? plan.planDigest : '0'.repeat(64),
        executionConfigurationDigest: SHA_256.test(plan.executionConfigurationDigest)
          ? plan.executionConfigurationDigest
          : '0'.repeat(64),
        deadlinePolicyVersion: VERSION.test(this.deadlinePolicy.version) ? this.deadlinePolicy.version : 'invalid',
        capability: CAPABILITIES.has(plan.capability) ? plan.capability : Capability.GENERAL_CHAT,
        validationProfile: isRoutingIdentifier(plan.validationProfile)
          ? plan.validationProfile
          : ('invalid-profile' as ValidationProfileId),
        matchedPolicyId: isRoutingIdentifier(plan.matchedPolicyId)
          ? plan.matchedPolicyId
          : ('invalid-policy' as PolicyId),
        policyVersion: VERSION.test(plan.policyVersion) ? plan.policyVersion : 'invalid',
        registryVersion: VERSION.test(plan.registryVersion) ? plan.registryVersion : 'invalid',
        registryConfigurationDigest: SHA_256.test(plan.registryConfigurationDigest)
          ? plan.registryConfigurationDigest
          : '0'.repeat(64),
        policyConfigurationDigest: SHA_256.test(plan.policyConfigurationDigest)
          ? plan.policyConfigurationDigest
          : '0'.repeat(64),
        configurationDigest: SHA_256.test(plan.configurationDigest) ? plan.configurationDigest : '0'.repeat(64),
        path,
        attemptCount: attempts.length as 0 | 1 | 2,
        attempts: Object.freeze([...attempts]),
        transitions: machine.transitions,
        terminalStatus: status,
        terminalCode: failureCode,
        finalProviderId: finalTarget?.providerId ?? null,
        finalPurpose: finalTarget?.purpose ?? null,
        acceptedResponseSha256,
      });
      const humanReviewRequired =
        status === ProviderGatewayTerminalStatus.HUMAN_REVIEW_REQUIRED ||
        (failureCode !== null &&
          !Object.values(ProviderBindingFailureCode).includes(failureCode as ProviderBindingFailureCode) &&
          failurePolicy(failureCode as RoutingFailureCode).humanReviewCandidate);
      return Object.freeze({
        status,
        failureCode,
        humanReviewRequired,
        ...(output === undefined ? {} : { output }),
        audit,
      });
    };

    const invalidPlan = validatePlanShape(plan, request);
    if (invalidPlan) return finish(ProviderGatewayTerminalStatus.CONFIGURATION_FAILED, invalidPlan);
    if (
      !VERSION.test(this.deadlinePolicy.version) ||
      plan.registryVersion !== this.bindings.registryVersion ||
      plan.registryConfigurationDigest !== this.bindings.registryConfigurationDigest
    ) {
      return finish(
        ProviderGatewayTerminalStatus.CONFIGURATION_FAILED,
        ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH,
      );
    }

    let profile: ValidationProfileDefinition;
    try {
      profile = this.profiles.resolve(plan.validationProfile);
    } catch {
      return finish(ProviderGatewayTerminalStatus.CONFIGURATION_FAILED, RoutingFailureCode.UNKNOWN_VALIDATION_PROFILE);
    }
    if (
      profile.version !== plan.validationProfileVersion ||
      profile.configurationDigest !== plan.validationProfileConfigurationDigest
    ) {
      return finish(
        ProviderGatewayTerminalStatus.CONFIGURATION_FAILED,
        ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH,
      );
    }

    for (const target of [plan.primary, plan.operationalFallback, plan.semanticEscalation]) {
      if (!target) continue;
      const failure = bindingFailure(this.bindings, target);
      if (failure) return finish(ProviderGatewayTerminalStatus.CONFIGURATION_FAILED, failure);
    }

    let budget: DeadlineBudget;
    try {
      budget = this.deadlinePolicy.resolve(plan.deadlineClass);
    } catch {
      return finish(
        ProviderGatewayTerminalStatus.CONFIGURATION_FAILED,
        ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH,
      );
    }
    if (
      ![budget.overallBudgetMs, budget.validationReserveMs, budget.minimumAttemptBudgetMs].every(
        (value) => Number.isFinite(value) && value > 0,
      ) ||
      budget.validationReserveMs + budget.minimumAttemptBudgetMs > budget.overallBudgetMs
    ) {
      return finish(
        ProviderGatewayTerminalStatus.CONFIGURATION_FAILED,
        ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH,
      );
    }
    const deadlineAt = this.clock.nowMs() + budget.overallBudgetMs;
    machine.transition(RoutingExecutionState.PRIMARY_READY, 'PREFLIGHT_PASSED');

    const runAttempt = async (target: ProviderExecutionTarget): Promise<AttemptResult | ProviderGatewayResult> => {
      const remaining = deadlineAt - this.clock.nowMs();
      const providerBudgetMs = Math.floor(remaining - budget.validationReserveMs);
      if (providerBudgetMs < budget.minimumAttemptBudgetMs) {
        finalTarget = target;
        return finish(
          ProviderGatewayTerminalStatus.EXECUTION_FAILED,
          RoutingFailureCode.DEADLINE_EXHAUSTED,
        );
      }
      const currentBindingFailure = bindingFailure(this.bindings, target);
      if (currentBindingFailure) {
        finalTarget = target;
        return finish(ProviderGatewayTerminalStatus.CONFIGURATION_FAILED, currentBindingFailure);
      }
      const states =
        target.purpose === ExecutionTargetPurpose.PRIMARY
          ? [RoutingExecutionState.PRIMARY_EXECUTING, RoutingExecutionState.PRIMARY_VALIDATING]
          : target.purpose === ExecutionTargetPurpose.FALLBACK
            ? [RoutingExecutionState.FALLBACK_EXECUTING, RoutingExecutionState.FALLBACK_VALIDATING]
            : [RoutingExecutionState.ESCALATION_EXECUTING, RoutingExecutionState.ESCALATION_VALIDATING];
      machine.transition(states[0]!, 'ATTEMPT_DISPATCHED');
      const binding = this.bindings.get(target.providerId) as ValidatedExecutableProviderBinding;
      const startedAt = this.clock.nowMs();
      try {
        const result = await binding.provider.execute({
          ...request,
          timeoutMs: effectiveProviderTimeoutMs(request.timeoutMs, providerBudgetMs),
        });
        const durationMs = Math.max(0, this.clock.nowMs() - startedAt);
        machine.transition(states[1]!, 'PROVIDER_RETURNED');
        return { target, result, providerBudgetMs, durationMs };
      } catch (error) {
        const durationMs = Math.max(0, this.clock.nowMs() - startedAt);
        const kind =
          error instanceof AiProviderError && AI_FAILURE_KINDS.has(error.kind)
            ? error.kind
            : AiFailureKind.EXECUTION_FAILED;
        return { target, failureCode: classifyProviderFailure(kind), providerBudgetMs, durationMs };
      }
    };

    let target = plan.primary;
    while (attempts.length < MAX_PROVIDER_ATTEMPTS) {
      finalTarget = target;
      const attempt = await runAttempt(target);
      if ('status' in attempt) return attempt;
      const attemptIndex = (attempts.length + 1) as 1 | 2;

      if (attempt.failureCode) {
        attempts.push(
          Object.freeze({
            attemptIndex,
            purpose: target.purpose,
            providerId: target.providerId,
            bindingDigest: target.bindingIdentity.bindingDigest,
            outcome: ProviderAttemptOutcome.PROVIDER_FAILED,
            failureCode: attempt.failureCode,
            validationDisposition: null,
            validationReasonCodes: Object.freeze([]),
            validationSucceeded: false,
            responseSha256: null,
            responseByteCount: null,
            providerBudgetMs: attempt.providerBudgetMs,
            durationMs: attempt.durationMs,
          }),
        );
        const policy = failurePolicy(attempt.failureCode);
        if (
          target.purpose === ExecutionTargetPurpose.PRIMARY &&
          policy.fallbackAllowed &&
          plan.operationalFallback &&
          attempts.length < MAX_PROVIDER_ATTEMPTS
        ) {
          path = 'FALLBACK';
          target = plan.operationalFallback;
          machine.transition(RoutingExecutionState.FALLBACK_READY, attempt.failureCode);
          continue;
        }
        return finish(terminalStatus(attempt.failureCode), attempt.failureCode);
      }

      const result = attempt.result!;
      const validation: RuntimeValidationResult = this.validator.validate({
        validationProfile: plan.validationProfile,
        prompt: request.prompt,
        ...validationFacts,
        contextCorpus: request.contextFiles?.map((file) => file.content),
        result,
      });
      const validationFailure = classifyValidationFailure(validation);
      attempts.push(
        Object.freeze({
          attemptIndex,
          purpose: target.purpose,
          providerId: target.providerId,
          bindingDigest: target.bindingIdentity.bindingDigest,
          outcome:
            validationFailure === null
              ? ProviderAttemptOutcome.VALIDATION_ACCEPTED
              : ProviderAttemptOutcome.VALIDATION_REJECTED,
          failureCode: validationFailure,
          validationDisposition: validation.disposition,
          validationReasonCodes: Object.freeze([...validation.reasonCodes]),
          validationSucceeded: validationFailure === null,
          responseSha256: validation.responseSha256,
          responseByteCount: validation.byteCount,
          providerBudgetMs: attempt.providerBudgetMs,
          durationMs: attempt.durationMs,
        }),
      );

      if (
        validationFailure !== null &&
        failurePolicy(validationFailure).failureClass === RoutingFailureClass.SAFETY
      ) {
        return finish(ProviderGatewayTerminalStatus.SAFETY_BLOCKED, validationFailure);
      }
      if (this.clock.nowMs() >= deadlineAt) {
        return finish(
          ProviderGatewayTerminalStatus.EXECUTION_FAILED,
          RoutingFailureCode.DEADLINE_EXHAUSTED,
        );
      }
      if (validationFailure === null) {
        return finish(
          ProviderGatewayTerminalStatus.ACCEPTED,
          null,
          projectBoundedProviderOutput(result, validation),
        );
      }

      const policy = failurePolicy(validationFailure);
      if (
        target.purpose === ExecutionTargetPurpose.PRIMARY &&
        policy.fallbackAllowed &&
        plan.operationalFallback &&
        attempts.length < MAX_PROVIDER_ATTEMPTS
      ) {
        path = 'FALLBACK';
        target = plan.operationalFallback;
        machine.transition(RoutingExecutionState.FALLBACK_READY, validationFailure);
        continue;
      }
      if (
        target.purpose === ExecutionTargetPurpose.PRIMARY &&
        validation.disposition === ValidationDisposition.ESCALATE &&
        policy.escalationAllowed &&
        profile.escalationEnabled &&
        plan.semanticEscalation &&
        attempts.length < MAX_PROVIDER_ATTEMPTS
      ) {
        path = 'ESCALATION';
        target = plan.semanticEscalation;
        machine.transition(RoutingExecutionState.ESCALATION_READY, validationFailure);
        continue;
      }
      if (
        validationFailure === RoutingFailureCode.SEMANTIC_VALIDATION_FAILED ||
        validationFailure === RoutingFailureCode.STRUCTURAL_VALIDATION_FAILED
      ) {
        const unresolved =
          validationFailure === RoutingFailureCode.SEMANTIC_VALIDATION_FAILED
            ? RoutingFailureCode.SEMANTIC_VALIDATION_UNRESOLVED
            : RoutingFailureCode.STRUCTURAL_VALIDATION_UNRESOLVED;
        return finish(ProviderGatewayTerminalStatus.HUMAN_REVIEW_REQUIRED, unresolved);
      }
      return finish(terminalStatus(validationFailure), validationFailure);
    }

    return finish(
      ProviderGatewayTerminalStatus.EXECUTION_FAILED,
      RoutingFailureCode.PROVIDER_EXECUTION_FAILED,
    );
  }
}
