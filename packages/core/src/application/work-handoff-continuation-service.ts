import { ApprovalStatus, ExecutionStatus, executionPlanRef, Capability, ContinuationAdmissionError, createWorkHandoff, IntentType, RiskLevel, TaskStatus, TaskRunStatus, WorkItemStatus } from '../domain';
import type { ApprovalRequest, ContinuationBinding, ExecutionPlan, Id } from '../domain';
import type { ContinuationBindingRepository, StorageProvider } from '../ports';
import { AgentProfileConfigurationError, type AgentProfileRegistry } from './agent-profile-registry';
import type { TaskManager } from './task-manager';
import type { ApprovalManager } from './approval-manager';
import { ApprovalPolicy } from './approval-policy';
import { RiskPolicy } from './risk-policy';
import { WorkHandoffConsumptionService } from './work-handoff-consumption-service';

type Reads = { [K in 'workHandoffs' | 'workItems' | 'tasks' | 'taskRuns']: Pick<StorageProvider[K], 'get'> };
export type ContinuationAdmission = Readonly<
  { disposition: 'NO_ACTION' } | { disposition: 'BOUND'; binding: ContinuationBinding }
>;

/** Caller-owned live data only; neither a saved plan nor a prior readiness result is authority. */
export interface ContinuationLifecycleInput {
  handoffId: Id;
  taskId: Id;
  plan?: ExecutionPlan;
  approvalId?: Id;
}

export type ContinuationLifecycleResult = Readonly<
  | { disposition: 'RUNNING_READY' | 'ALREADY_RUNNING'; handoffId: Id; taskId: Id }
  | { disposition: 'WAITING_FOR_APPROVAL'; handoffId: Id; taskId: Id; approvalId?: Id }
  | { disposition: 'DENY'; reason: 'INVALID_REQUEST' | 'BINDING_MISMATCH' | 'INCONSISTENT_STATE'
      | 'WORK_ITEM_NOT_CONTINUABLE' | 'TASK_NOT_PREPARABLE' | 'APPROVAL_UNPROVABLE' | 'APPROVAL_DENIED' }
>;

export interface ContinuationLifecycleOwners {
  tasks: Pick<TaskManager, 'transition'>;
  approvals: Pick<ApprovalManager, 'requestFor' | 'get'>;
}

function canonicalText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function timestamp(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function requireId(id: Id): void {
  if (typeof id !== 'string' || !id || id.trim() !== id) {
    throw new ContinuationAdmissionError('INVALID_REQUEST');
  }
}

/** Admission prepares provenance, never execution. No decision object is accepted as authority. */
export class WorkHandoffContinuationService {
  constructor(
    private readonly storage: Reads,
    private readonly profiles: AgentProfileRegistry,
    private readonly bindings: ContinuationBindingRepository,
    private readonly lifecycle: ContinuationLifecycleOwners,
  ) {}

  async admit(handoffId: Id, taskId: Id): Promise<ContinuationAdmission> {
    requireId(handoffId);
    requireId(taskId);
    const decision = await new WorkHandoffConsumptionService(this.storage, this.profiles).evaluate(handoffId);
    if (decision.disposition === 'NO_ACTION') return Object.freeze({ disposition: 'NO_ACTION' });
    const { handoff, workItem, task } = await this.canonical(handoffId, taskId);
    if (workItem.status !== WorkItemStatus.ACTIVE || task.status !== TaskStatus.PENDING) {
      throw new ContinuationAdmissionError('STALE_STATE');
    }
    const binding = await this.bindings.admit({ handoff, workItem, task });
    if (binding.handoffId !== handoffId || binding.taskId !== taskId) {
      throw new ContinuationAdmissionError('INCONSISTENT_STATE');
    }
    return Object.freeze({ disposition: 'BOUND', binding: Object.freeze({ ...binding }) });
  }

  /**
   * Production lifecycle caller for an exact, already-admitted continuation. Stops before any run.
   * Like ordinary work, TaskManager alone walks the legal graph. Like ExecutionOrchestrator,
   * ApprovalManager requests/loads the decision and pending approval stops the invocation.
   * Reads/transitions are NOT atomic; this result cannot replace ADR-0088's future start guard.
   */
  async prepare(input: ContinuationLifecycleInput): Promise<ContinuationLifecycleResult> {
    const deny = (reason: Extract<ContinuationLifecycleResult, { disposition: 'DENY' }>['reason']) =>
      Object.freeze({ disposition: 'DENY' as const, reason });
    if (!input || !canonicalText(input.handoffId) || !canonicalText(input.taskId)
      || input.approvalId !== undefined && !canonicalText(input.approvalId)) return deny('INVALID_REQUEST');
    const { handoffId, taskId, approvalId } = input;
    // Snapshot the supplied live value across awaits; never load/reconstruct it from Task.planId.
    let plan: ExecutionPlan | undefined;
    if (input.plan !== undefined) {
      try { plan = JSON.parse(JSON.stringify(input.plan)) as ExecutionPlan; }
      catch { return deny('APPROVAL_UNPROVABLE'); }
      if (!plan) return deny('APPROVAL_UNPROVABLE');
    }
    const binding = await this.bindings.get(handoffId);
    if (!binding || binding.handoffId !== handoffId || binding.taskId !== taskId
      || !timestamp(binding.recordedAt)) return deny('BINDING_MISMATCH');
    let facts;
    try { facts = await this.canonical(handoffId, taskId); }
    catch (error) {
      if (error instanceof ContinuationAdmissionError || error instanceof AgentProfileConfigurationError) {
        return deny('INCONSISTENT_STATE');
      }
      throw error; // storage failures are not policy denials
    }
    const { workItem } = facts;
    let { task } = facts;
    if (workItem.status !== WorkItemStatus.ACTIVE) return deny('WORK_ITEM_NOT_CONTINUABLE');
    const identity = { handoffId, taskId };
    if (task.status === TaskStatus.RUNNING) return Object.freeze({ disposition: 'ALREADY_RUNNING', ...identity });
    if (![TaskStatus.PENDING, TaskStatus.PLANNING, TaskStatus.WAITING_APPROVAL].includes(task.status)) {
      return deny('TASK_NOT_PREPARABLE');
    }
    const risk = new RiskPolicy();
    const taskRequiresApproval = risk.requiresApproval(risk.max(task.riskLevel, risk.assessCapability(task.intent.capability)));
    if (!plan && (taskRequiresApproval || task.planId !== undefined || approvalId !== undefined
      || task.status === TaskStatus.WAITING_APPROVAL)) return deny('APPROVAL_UNPROVABLE');
    let requiresApproval = taskRequiresApproval;
    if (plan) {
      if (!canonicalText(plan.id) || !canonicalText(plan.goal) || task.planId !== plan.id
        || plan.projectId !== task.projectId || !Object.values(RiskLevel).includes(plan.overallRisk)
        || typeof plan.approvalRequired !== 'boolean' || !Object.values(ExecutionStatus).includes(plan.status)
        || !Array.isArray(plan.requiredCapabilities) || !plan.requiredCapabilities.includes(task.intent.capability)
        || plan.requiredCapabilities.some(c => !Object.values(Capability).includes(c))
        || !Array.isArray(plan.steps) || !Array.isArray(plan.requiredResources) || !plan.estimatedChanges
        || !Array.isArray(plan.expectedArtifacts) || !timestamp(plan.createdAt)
        || plan.integrity !== undefined && (!canonicalText(plan.integrity.kind)
          || !canonicalText(plan.integrity.contractVersion) || !canonicalText(plan.integrity.digest))) {
        return deny('APPROVAL_UNPROVABLE');
      }
      const evaluation = new ApprovalPolicy(risk).evaluate(plan, workItem.actorId);
      requiresApproval = requiresApproval || plan.approvalRequired || evaluation.requiresApproval
        || plan.requiredCapabilities.some(c => risk.requiresApproval(risk.assessCapability(c)));
      // Do not change ApprovalPolicy or synthesize a higher-risk plan to force requestFor to wait.
      if (requiresApproval && !evaluation.requiresApproval) return deny('APPROVAL_UNPROVABLE');
    }
    let approval: ApprovalRequest | null = null;
    if (approvalId) {
      approval = await this.lifecycle.approvals.get(approvalId);
      if (!approval || approval.id !== approvalId || !plan || !this.matchesApproval(approval, plan, workItem.actorId)) {
        return deny('APPROVAL_UNPROVABLE');
      }
      if (![ApprovalStatus.PENDING, ApprovalStatus.APPROVED].includes(approval.status)) return deny('APPROVAL_DENIED');
    }
    if (task.status === TaskStatus.WAITING_APPROVAL && !approval) {
      // Lost exact request identity is not permission to select latest or create a replacement.
      return Object.freeze({ disposition: 'WAITING_FOR_APPROVAL', ...identity });
    }
    if (task.status === TaskStatus.PENDING) task = await this.lifecycle.tasks.transition(task, TaskStatus.PLANNING);
    if (requiresApproval && !approval) {
      approval = await this.lifecycle.approvals.requestFor(plan!, workItem.actorId);
      if (!this.matchesApproval(approval, plan!, workItem.actorId)) return deny('APPROVAL_UNPROVABLE');
    }
    if (requiresApproval || approval || task.status === TaskStatus.WAITING_APPROVAL) {
      if (task.status === TaskStatus.PLANNING) task = await this.lifecycle.tasks.transition(task, TaskStatus.WAITING_APPROVAL);
      if (!approval || approval.status === ApprovalStatus.PENDING) {
        return Object.freeze({ disposition: 'WAITING_FOR_APPROVAL', ...identity,
          ...(approval ? { approvalId: approval.id } : {}) });
      }
      if (approval.status !== ApprovalStatus.APPROVED) return deny('APPROVAL_DENIED');
    }
    await this.lifecycle.tasks.transition(task, TaskStatus.RUNNING);
    return Object.freeze({ disposition: 'RUNNING_READY', ...identity });
  }

  private matchesApproval(approval: ApprovalRequest, plan: ExecutionPlan, actorId: Id): boolean {
    const ref = executionPlanRef(plan);
    const actual = approval.executionPlanRef;
    return canonicalText(approval.id) && approval.requestedBy === actorId
      && !!actual && actual.id === ref.id && actual.goal === ref.goal
      && (actual.integrity === undefined && ref.integrity === undefined
        || !!actual.integrity && !!ref.integrity && actual.integrity.kind === ref.integrity.kind
          && actual.integrity.contractVersion === ref.integrity.contractVersion
          && actual.integrity.digest === ref.integrity.digest);
  }

  /** Exact-id historical provenance lookup, not admission/claim or "latest run" selection. */
  async resolveRun(handoffId: Id, taskRunId: Id) {
    requireId(handoffId);
    requireId(taskRunId);
    const binding = await this.bindings.get(handoffId);
    if (!binding || binding.handoffId !== handoffId) throw new ContinuationAdmissionError('INCONSISTENT_STATE');
    const { handoff, workItem } = await this.canonical(handoffId, binding.taskId);
    const run = await this.storage.taskRuns.get(taskRunId);
    if (!run || run.id !== taskRunId || run.taskId !== binding.taskId
      || !Number.isSafeInteger(run.attempt) || run.attempt < 1
      || !Object.values(TaskRunStatus).includes(run.status)
      || typeof run.startedAt !== 'string' || !Number.isFinite(Date.parse(run.startedAt))) {
      throw new ContinuationAdmissionError('INCONSISTENT_STATE');
    }
    return Object.freeze({ handoffId, workItemId: workItem.id,
      destinationAgentProfileId: handoff.toAgentProfileId, taskId: binding.taskId, taskRunId: run.id });
  }

  private async canonical(handoffId: Id, taskId: Id) {
    const loaded = await this.storage.workHandoffs.get(handoffId);
    if (!loaded || loaded.id !== handoffId) throw new ContinuationAdmissionError('INCONSISTENT_STATE');
    let handoff;
    try { handoff = createWorkHandoff(loaded); }
    catch { throw new ContinuationAdmissionError('INCONSISTENT_STATE'); }
    if (handoff.workItemId !== loaded.workItemId) throw new ContinuationAdmissionError('INCONSISTENT_STATE');
    this.profiles.get(handoff.fromAgentProfileId);
    this.profiles.get(handoff.toAgentProfileId);
    const workItem = await this.storage.workItems.get(handoff.workItemId);
    const task = await this.storage.tasks.get(taskId);
    if (!workItem || workItem.id !== handoff.workItemId || !task || task.id !== taskId
      || !canonicalText(workItem.actorId)
      || (workItem.projectId !== undefined && !canonicalText(workItem.projectId))
      || !timestamp(workItem.createdAt) || !timestamp(workItem.updatedAt)
      || !['conversation', 'connector'].includes(workItem.origin)
      || !Array.isArray(workItem.resourceRefs)
      || workItem.resourceRefs.some(ref => !ref || !canonicalText(ref.source) || !canonicalText(ref.externalId))
      || !timestamp(task.createdAt) || !timestamp(task.updatedAt)
      || typeof task.title !== 'string' || typeof task.description !== 'string'
      || !Object.values(RiskLevel).includes(task.riskLevel)
      || !task.intent || !Object.values(IntentType).includes(task.intent.type)
      || !Object.values(Capability).includes(task.intent.capability)
      || task.actorId !== workItem.actorId || task.projectId !== workItem.projectId
      || !Object.values(WorkItemStatus).includes(workItem.status)
      || !Object.values(TaskStatus).includes(task.status)
      || !task.context || !canonicalText(task.context.platform)
      || !canonicalText(task.context.channelId) || !canonicalText(task.context.userId)) {
      throw new ContinuationAdmissionError('INCONSISTENT_STATE');
    }
    return { handoff, workItem, task };
  }
}
