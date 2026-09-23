import { Capability, RiskLevel } from '../domain';
import type { ExecutionPlan, Id, Task, WorkItem } from '../domain';
import { ApprovalPolicy } from './approval-policy';
import { isCanonicalText, matchesLiveExecutionPlanStructure } from './continuation-live-plan-proof';
import { RiskPolicy } from './risk-policy';

/** Caller-owned, same-invocation input. No approval id, dispatch state or authority token. */
export interface ContinuationExecutionRequestContext {
  readonly trigger: 'EXPLICIT_CONTINUATION_EXECUTION_REQUEST';
  readonly handoffId: Id;
  readonly taskId: Id;
  readonly actorId: Id;
  readonly projectId?: Id;
  /** Original supplied live plan; never loaded/reconstructed from a persisted reference. */
  readonly plan: ExecutionPlan;
}

/** Shared strict public request boundary; never accept injected canonical facts or authority. */
export function hasOnlyContinuationRequestFields(input: ContinuationExecutionRequestContext): boolean {
  return !!input && Object.keys(input).every(key =>
    ['trigger', 'handoffId', 'taskId', 'actorId', 'projectId', 'plan'].includes(key));
}

/** Copy and recursively freeze the caller's live value, without freezing its original plan. */
export function createContinuationExecutionRequestContext(
  input: ContinuationExecutionRequestContext,
): ContinuationExecutionRequestContext {
  const plan: ExecutionPlan = {
    ...input.plan,
    steps: input.plan.steps.map(step => Object.freeze({ ...step })),
    requiredCapabilities: [...input.plan.requiredCapabilities],
    requiredResources: [...input.plan.requiredResources],
    estimatedChanges: Object.freeze({ ...input.plan.estimatedChanges }),
    expectedArtifacts: [...input.plan.expectedArtifacts],
    ...(input.plan.integrity ? { integrity: Object.freeze({ ...input.plan.integrity }) } : {}),
  };
  Object.freeze(plan.steps);
  Object.freeze(plan.requiredCapabilities);
  Object.freeze(plan.requiredResources);
  Object.freeze(plan.expectedArtifacts);
  return Object.freeze({ trigger: input.trigger, handoffId: input.handoffId, taskId: input.taskId,
    actorId: input.actorId, projectId: input.projectId, plan: Object.freeze(plan) });
}

export type ContinuationExecutionProductDenial =
  | 'INVALID_REQUEST' | 'UNSUPPORTED_TRIGGER' | 'ACTOR_NOT_AUTHORIZED'
  | 'PROJECT_NOT_AUTHORIZED' | 'UNSUPPORTED_RECEIVER_CAPABILITY'
  | 'HUMAN_WAIT_REQUIRED' | 'PLAN_UNPROVABLE';

/** Ephemeral evaluation only; not a reservation, lease, claim or execution authorization. */
export type ContinuationExecutionProductDecision = Readonly<
  { disposition: 'ELIGIBLE_NO_WAIT' }
  | { disposition: 'DENY'; reason: ContinuationExecutionProductDenial }
>;

const SUPPORTED: readonly Capability[] = Object.freeze([
  Capability.GENERAL_CHAT, Capability.SUMMARIZATION, Capability.DOCUMENT_ANALYSIS,
  Capability.CODE_REVIEW, Capability.ARCHITECTURE_PLANNING, Capability.READONLY_LOOKUP,
  Capability.PROJECT_ANALYSIS,
]);
const deny = (reason: ContinuationExecutionProductDenial): ContinuationExecutionProductDecision =>
  Object.freeze({ disposition: 'DENY', reason });

/**
 * ADR-0089 Family A. Pure Product eligibility over canonical values supplied by the caller.
 * The future caller must resolve the exact handoff/binding/WorkItem/Task relationship via existing
 * owners. This policy adds explicit request authorization; it does not replace admission or lifecycle
 * preparation. WorkHandoff provenance, lifecycle, profiles and approved requests are never triggers.
 * No approval acquisition/reentry: any human-wait gate denies even if an approved request exists.
 * guardedStart remains effect-time authority; M3E-6J caller and receiver execution remain unimplemented.
 */
export class ContinuationExecutionProductPolicy {
  evaluate(
    request: ContinuationExecutionRequestContext,
    work: WorkItem,
    task: Task,
  ): ContinuationExecutionProductDecision {
    if (!request || !work || !task || !isCanonicalText(request.handoffId)
      || !isCanonicalText(request.taskId) || request.taskId !== task.id) return deny('INVALID_REQUEST');
    if (request.trigger !== 'EXPLICIT_CONTINUATION_EXECUTION_REQUEST') return deny('UNSUPPORTED_TRIGGER');
    if (!isCanonicalText(request.actorId) || request.actorId !== work.actorId
      || request.actorId !== task.actorId) return deny('ACTOR_NOT_AUTHORIZED');
    if (request.projectId !== work.projectId || request.projectId !== task.projectId
      || request.projectId !== undefined && !isCanonicalText(request.projectId)) return deny('PROJECT_NOT_AUTHORIZED');
    if (!task.intent || !SUPPORTED.includes(task.intent.capability)) return deny('UNSUPPORTED_RECEIVER_CAPABILITY');
    if (!Object.values(RiskLevel).includes(task.riskLevel)) return deny('INVALID_REQUEST');
    const plan = request.plan;
    if (!matchesLiveExecutionPlanStructure(plan, task)) return deny('PLAN_UNPROVABLE');
    // ExecutionStep is executable, not structural-only. Deny hidden or undeclared step capabilities too.
    if (!plan.requiredCapabilities.every(capability => SUPPORTED.includes(capability))
      || !plan.steps.every(step => step && SUPPORTED.includes(step.capability)
        && plan.requiredCapabilities.includes(step.capability))) return deny('UNSUPPORTED_RECEIVER_CAPABILITY');
    const risk = new RiskPolicy();
    const approval = new ApprovalPolicy(risk).evaluate(plan, request.actorId);
    if (risk.requiresApproval(risk.max(task.riskLevel, risk.assessCapability(task.intent.capability)))
      || risk.requiresApproval(plan.overallRisk) || plan.approvalRequired || approval.requiresApproval
      || plan.requiredCapabilities.some(capability => risk.requiresApproval(risk.assessCapability(capability)))) {
      return deny('HUMAN_WAIT_REQUIRED');
    }
    return Object.freeze({ disposition: 'ELIGIBLE_NO_WAIT' });
  }
}
