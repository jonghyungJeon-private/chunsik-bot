import { AiProviderError } from '../errors';
import { AiFailureKind } from '../domain';
import type { AiExecutionResult, AiRequest } from '../ports';
import type { ProviderExecutionPlan } from './provider-execution-plan';
import { ProviderExecutionPlanError } from './provider-execution-plan';
import type { ProviderBindingRegistry } from './provider-binding-registry';
import type { PolicyId, ProviderId, ValidationProfileId } from './provider-routing-contracts';

export enum ProviderExecutionOutcome {
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

export interface ProviderExecutionAudit {
  schemaVersion: 'provider-execution-audit-v1';
  providerId: ProviderId;
  executionOrder: readonly [ProviderId];
  attemptBudget: 1;
  attemptCount: 1;
  outcome: ProviderExecutionOutcome;
  failureKind: AiFailureKind | null;
  capability: AiRequest['capability'];
  validationProfile: ValidationProfileId;
  matchedPolicyId: PolicyId;
  policyVersion: string;
  registryVersion: string;
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
      failureKind: AiFailureKind;
      audit: ProviderExecutionAudit;
    };

function validateSingleAttemptPlan(plan: ProviderExecutionPlan, request: AiRequest): void {
  if (
    plan.attemptBudget !== 1 ||
    plan.executionOrder.length !== 1 ||
    plan.executionOrder[0] !== plan.selectedProviderId
  ) {
    throw new ProviderExecutionPlanError('Gateway requires exactly one selected Provider attempt');
  }
  if (plan.overallDeadlineMs !== null || plan.fallbackEligible || plan.escalationEligible) {
    throw new ProviderExecutionPlanError('Slice 2 prohibits deadline, fallback, and escalation policy');
  }
  if (request.capability !== plan.capability) {
    throw new ProviderExecutionPlanError('Execution request capability does not match the plan');
  }
}

function audit(
  plan: ProviderExecutionPlan,
  outcome: ProviderExecutionOutcome,
  failureKind: AiFailureKind | null,
): ProviderExecutionAudit {
  return Object.freeze({
    schemaVersion: 'provider-execution-audit-v1',
    providerId: plan.selectedProviderId,
    executionOrder: Object.freeze([...plan.executionOrder]) as readonly [ProviderId],
    attemptBudget: 1,
    attemptCount: 1,
    outcome,
    failureKind,
    capability: plan.capability,
    validationProfile: plan.validationProfile,
    matchedPolicyId: plan.matchedPolicyId,
    policyVersion: plan.policyVersion,
    registryVersion: plan.registryVersion,
    configurationDigest: plan.configurationDigest,
    fallbackAttempted: false,
    escalationAttempted: false,
  });
}

/** Single-attempt execution owner. No availability probe, retry, fallback, escalation, or validation. */
export class ProviderRoutingGateway {
  constructor(private readonly bindings: ProviderBindingRegistry) {}

  async execute(plan: ProviderExecutionPlan, request: AiRequest): Promise<ProviderGatewayResult> {
    validateSingleAttemptPlan(plan, request);
    const provider = this.bindings.get(plan.selectedProviderId);
    if (!provider) {
      throw new ProviderExecutionPlanError('Selected Provider has no executable binding');
    }

    try {
      const result = await provider.execute(request);
      return Object.freeze({
        status: ProviderExecutionOutcome.SUCCEEDED,
        result,
        audit: audit(plan, ProviderExecutionOutcome.SUCCEEDED, null),
      });
    } catch (error) {
      const failureKind = error instanceof AiProviderError ? error.kind : AiFailureKind.EXECUTION_FAILED;
      return Object.freeze({
        status: ProviderExecutionOutcome.FAILED,
        failureKind,
        audit: audit(plan, ProviderExecutionOutcome.FAILED, failureKind),
      });
    }
  }
}
