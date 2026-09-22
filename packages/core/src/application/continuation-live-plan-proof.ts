import { Capability, ExecutionStatus, RiskLevel } from '../domain';
import type { ExecutionPlan, ExecutionPlanRef, Task } from '../domain';

/**
 * ADR-0089 / M3E-6I-a: the single shared PURE STRUCTURAL proof about a caller-supplied live
 * `ExecutionPlan`, extracted from `WorkHandoffContinuationService.prepare` and
 * `ContinuationExecutionAdmissionService.evaluate` so a third consumer at the future receiver boundary
 * cannot drift from them.
 *
 * Deliberate boundaries:
 * - It is pure. No storage, ApprovalManager, TaskManager, AgentProfileRegistry, Provider, environment,
 *   configuration, clock, I/O or mutable state participates, and nothing is persisted or cached.
 * - It VALIDATES a live plan the caller already owns. It never obtains, persists, caches or reconstructs
 *   one — not from `Task.planId`, not from an `ExecutionPlanRef`, and not from an `ApprovalRequest`.
 *   The post-wait live-plan source therefore remains unresolved (M3E-6I-b).
 * - It owns NO gate policy. Lifecycle status expectations, approval acquisition, requester identity,
 *   exact-approval-id authority, approval-policy consistency and each caller's failure taxonomy stay with
 *   their existing owners. Callers map a `false` result into their own bounded reason.
 * - `Task.planId` participates only as a structural consistency check. It is never execution authority
 *   and never a substitute for the live plan.
 * - Booleans are intentional: both callers already map failures cleanly, so no new failure taxonomy,
 *   decision object or authority value is introduced here.
 */

/** Non-empty, already-canonical text: no surrounding whitespace to normalize away. */
export function isCanonicalText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

/** Parseable ISO-like timestamp text. Never used to age out or resolve any lifecycle state. */
export function isTimestampText(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** Structural integrity-ref equality: present on both sides with identical canonical triple, or absent on both. */
export function matchesExecutionPlanIntegrity(
  actual: ExecutionPlanRef['integrity'],
  expected: ExecutionPlanRef['integrity'],
): boolean {
  if (actual === undefined && expected === undefined) return true;
  return !!actual && !!expected
    && isCanonicalText(actual.kind) && isCanonicalText(actual.contractVersion) && isCanonicalText(actual.digest)
    && actual.kind === expected.kind
    && actual.contractVersion === expected.contractVersion
    && actual.digest === expected.digest;
}

/**
 * Structural plan-reference equality (identity, goal and integrity). It proves only that a reference
 * describes the same plan; it grants no approval authority and proves no operation scope. The exact
 * ApprovalRequest id, its status and requester remain each caller's own checks.
 */
export function matchesExecutionPlanRef(actual: ExecutionPlanRef | undefined, expected: ExecutionPlanRef): boolean {
  return !!actual && !!expected && actual.id === expected.id && actual.goal === expected.goal
    && matchesExecutionPlanIntegrity(actual.integrity, expected.integrity);
}

/**
 * The shared structural proof that a live plan is internally well formed and consistent with the exact
 * bound continuation Task. Ordering and history are irrelevant here: nothing is inferred from a latest or
 * maximum value, and no persisted record is consulted.
 */
export function matchesLiveExecutionPlanStructure(plan: ExecutionPlan, task: Task): boolean {
  if (!plan || typeof plan !== 'object' || !task || typeof task !== 'object') return false;
  return isCanonicalText(plan.id)
    && isCanonicalText(plan.goal)
    // Structural consistency only; Task.planId never substitutes for or authorizes the live plan.
    && task.planId === plan.id
    && plan.projectId === task.projectId
    && Object.values(RiskLevel).includes(plan.overallRisk)
    && typeof plan.approvalRequired === 'boolean'
    && Object.values(ExecutionStatus).includes(plan.status)
    && Array.isArray(plan.requiredCapabilities)
    && plan.requiredCapabilities.includes(task.intent.capability)
    && plan.requiredCapabilities.every((capability) => Object.values(Capability).includes(capability))
    && Array.isArray(plan.steps)
    && Array.isArray(plan.requiredResources)
    && !!plan.estimatedChanges
    && Array.isArray(plan.expectedArtifacts)
    && isTimestampText(plan.createdAt)
    && (plan.integrity === undefined
      || isCanonicalText(plan.integrity.kind)
        && isCanonicalText(plan.integrity.contractVersion)
        && isCanonicalText(plan.integrity.digest));
}
