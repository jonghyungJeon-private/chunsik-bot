import { ApprovalStatus, Capability, createWorkHandoff, executionPlanRef, ExecutionStatus, IntentType, RiskLevel,
  TaskRunStatus, TaskStatus, WorkItemStatus } from '../domain';
import type { ExecutionPlan, ExecutionPlanRef, Id, TaskRun } from '../domain';
import type { ContinuationBindingRepository, StorageProvider } from '../ports';
import { AgentProfileConfigurationError, type AgentProfileRegistry } from './agent-profile-registry';
import { ApprovalPolicy } from './approval-policy';
import { RiskPolicy } from './risk-policy';

type Reads = {
  [K in 'workHandoffs' | 'workItems' | 'tasks' | 'approvals']: Pick<StorageProvider[K], 'get'>;
} & { taskRuns: Pick<StorageProvider['taskRuns'], 'listByTask'> };

export type ContinuationExecutionAdmissionReason =
  | 'INVALID_REQUEST' | 'HANDOFF_NOT_ACTIONABLE' | 'BINDING_MISMATCH'
  | 'WORK_ITEM_NOT_CONTINUABLE' | 'TASK_NOT_EXECUTABLE' | 'AGENT_PROFILE_UNAVAILABLE'
  | 'APPROVAL_UNPROVABLE' | 'APPROVAL_NOT_APPROVED'
  | 'INVALID_RUN_HISTORY' | 'UNRESOLVED_STARTED_RUN';

/** Point-in-time prerequisites only. Never persist, dispatch with, or reuse as authority. */
export type ContinuationExecutionAdmissionDecision = Readonly<
  { disposition: 'ELIGIBLE_TO_START_ATTEMPT'; handoffId: Id; taskId: Id }
  | { disposition: 'DENY'; reason: ContinuationExecutionAdmissionReason }
>;

export interface ContinuationExecutionAdmissionInput {
  handoffId: Id;
  taskId: Id;
  /** Original live plan from its owner, never reconstructed from Task.planId or an ApprovalRef. */
  plan?: ExecutionPlan;
  approvalId?: Id;
}

/** Canonical lifecycle alone decides unresolvedness; finishedAt/age never resolves STARTED. */
export function isUnresolvedStartedTaskRun(run: TaskRun, taskId: Id): boolean {
  return run.taskId === taskId && run.status === TaskRunStatus.STARTED;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}
function timestamp(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function samePlanRef(a: ExecutionPlanRef, b: ExecutionPlanRef): boolean {
  if (!a || a.id !== b.id || a.goal !== b.goal) return false;
  const x = a.integrity; const y = b.integrity;
  return x === undefined && y === undefined || !!x && !!y
    && text(x.kind) && text(x.contractVersion) && text(x.digest)
    && x.kind === y.kind && x.contractVersion === y.contractVersion && x.digest === y.digest;
}
const deny = (reason: ContinuationExecutionAdmissionReason): ContinuationExecutionAdmissionDecision =>
  Object.freeze({ disposition: 'DENY', reason });

/**
 * ADR-0087 / M3E-6B. No managers with write methods, execution callbacks or runtime wiring.
 * Reads are not an atomic snapshot. Future effect-time guards must re-read all canonical facts.
 * Storage failures propagate; policy failures return bounded decisions, never guessed eligibility.
 */
export class ContinuationExecutionAdmissionService {
  constructor(
    private readonly storage: Reads,
    private readonly profiles: AgentProfileRegistry,
    private readonly bindings: Pick<ContinuationBindingRepository, 'get'>,
  ) {}

  async evaluate(input: ContinuationExecutionAdmissionInput): Promise<ContinuationExecutionAdmissionDecision> {
    if (!input || !text(input.handoffId) || !text(input.taskId)
      || input.approvalId !== undefined && !text(input.approvalId)) return deny('INVALID_REQUEST');
    // Isolate caller-owned live plan/ids from mutation across awaits; this is not a persisted plan.
    const { handoffId, taskId, approvalId } = input;
    let plan: ExecutionPlan | undefined;
    if (input.plan !== undefined) {
      if (!input.plan || typeof input.plan !== 'object') return deny('APPROVAL_UNPROVABLE');
      try { plan = JSON.parse(JSON.stringify(input.plan)) as ExecutionPlan; }
      catch { return deny('APPROVAL_UNPROVABLE'); }
    }
    const loaded = await this.storage.workHandoffs.get(handoffId);
    if (!loaded || loaded.id !== handoffId) return deny('HANDOFF_NOT_ACTIONABLE');
    let handoff;
    try { handoff = createWorkHandoff(loaded); }
    catch { return deny('HANDOFF_NOT_ACTIONABLE'); }
    if (handoff.workItemId !== loaded.workItemId) return deny('HANDOFF_NOT_ACTIONABLE');
    const binding = await this.bindings.get(handoffId);
    if (!binding || binding.handoffId !== handoffId || binding.taskId !== taskId
      || !timestamp(binding.recordedAt)) return deny('BINDING_MISMATCH');
    const work = await this.storage.workItems.get(handoff.workItemId);
    if (!work || work.id !== handoff.workItemId || work.status !== WorkItemStatus.ACTIVE
      || !text(work.actorId) || !timestamp(work.createdAt) || !timestamp(work.updatedAt)
      || !['conversation', 'connector'].includes(work.origin) || !Array.isArray(work.resourceRefs)
      || work.projectId !== undefined && !text(work.projectId)) return deny('WORK_ITEM_NOT_CONTINUABLE');
    const task = await this.storage.tasks.get(taskId);
    // Strict immediate-start prerequisite. Planning/transitions remain TaskManager's responsibility.
    if (!task || task.id !== taskId || task.status !== TaskStatus.RUNNING
      || task.actorId !== work.actorId || task.projectId !== work.projectId
      || !timestamp(task.createdAt) || !timestamp(task.updatedAt)
      || !task.context || !text(task.context.platform) || !text(task.context.channelId) || !text(task.context.userId)
      || !task.intent || !Object.values(IntentType).includes(task.intent.type)
      || !Object.values(Capability).includes(task.intent.capability)
      || !Object.values(RiskLevel).includes(task.riskLevel)) return deny('TASK_NOT_EXECUTABLE');
    try {
      this.profiles.get(handoff.fromAgentProfileId);
      this.profiles.get(handoff.toAgentProfileId);
    } catch (error) {
      if (error instanceof AgentProfileConfigurationError) return deny('AGENT_PROFILE_UNAVAILABLE');
      throw error;
    }
    const risk = new RiskPolicy();
    const taskRequiresApproval = risk.requiresApproval(risk.max(task.riskLevel, risk.assessCapability(task.intent.capability)));
    // A planned Task or selected approval cannot be evaluated using only its persisted id/ref.
    if (!plan && (taskRequiresApproval || task.planId !== undefined || approvalId !== undefined)) {
      return deny('APPROVAL_UNPROVABLE');
    }
    if (plan) {
      if (!text(plan.id) || !text(plan.goal) || task.planId !== plan.id || plan.projectId !== task.projectId
        || !Object.values(RiskLevel).includes(plan.overallRisk) || typeof plan.approvalRequired !== 'boolean'
        || !Object.values(ExecutionStatus).includes(plan.status)
        || !Array.isArray(plan.requiredCapabilities) || !plan.requiredCapabilities.includes(task.intent.capability)
        || plan.requiredCapabilities.some(c => !Object.values(Capability).includes(c))
        || !Array.isArray(plan.steps) || !Array.isArray(plan.requiredResources)
        || !plan.estimatedChanges || !Array.isArray(plan.expectedArtifacts) || !timestamp(plan.createdAt)
        || plan.integrity !== undefined && (!text(plan.integrity.kind)
          || !text(plan.integrity.contractVersion) || !text(plan.integrity.digest))) return deny('APPROVAL_UNPROVABLE');
      const policy = new ApprovalPolicy(risk).evaluate(plan, work.actorId);
      const requiresApproval = taskRequiresApproval || plan.approvalRequired || policy.requiresApproval
        || plan.requiredCapabilities.some(c => risk.requiresApproval(risk.assessCapability(c)));
      if (requiresApproval && !approvalId) return deny('APPROVAL_UNPROVABLE');
      if (approvalId) {
        const approval = await this.storage.approvals.get(approvalId);
        if (!approval || approval.id !== approvalId || !samePlanRef(approval.executionPlanRef, executionPlanRef(plan))) {
          return deny('APPROVAL_UNPROVABLE');
        }
        if (approval.status !== ApprovalStatus.APPROVED) return deny('APPROVAL_NOT_APPROVED');
      }
    }
    const runs = await this.storage.taskRuns.listByTask(taskId);
    const ids = new Set<Id>();
    for (const run of runs) {
      if (!run || !text(run.id) || ids.has(run.id) || run.taskId !== taskId
        || !Number.isSafeInteger(run.attempt) || run.attempt < 1 || !timestamp(run.startedAt)
        || !Object.values(TaskRunStatus).includes(run.status)) return deny('INVALID_RUN_HISTORY');
      ids.add(run.id);
    }
    if (runs.some(run => isUnresolvedStartedTaskRun(run, taskId))) return deny('UNRESOLVED_STARTED_RUN');
    return Object.freeze({ disposition: 'ELIGIBLE_TO_START_ATTEMPT', handoffId, taskId });
  }
}
