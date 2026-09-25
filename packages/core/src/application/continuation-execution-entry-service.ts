import { constrainedEntry, type ContinuationExecutionConstraint, type BoundContinuationStart } from './continuation-execution-internal';
import { isFamilyACapability } from './continuation-family-a-capability';
import { executionPlanRef } from '../domain';
import type { ApprovalRequest, ContinuationBinding, Task, TaskRun, WorkHandoff, WorkItem } from '../domain';
import type { ContinuationBindingRepository, GuardedTaskRunStartFacts, StorageProvider } from '../ports';
import { AgentProfileConfigurationError, type AgentProfileRegistry } from './agent-profile-registry';
import { ContinuationExecutionAdmissionService } from './continuation-execution-admission-service';
import type { ContinuationExecutionAdmissionInput, ContinuationExecutionAdmissionReason } from './continuation-execution-admission-service';
import type { TaskManager } from './task-manager';

type Reads = {
  [K in 'workHandoffs' | 'workItems' | 'tasks' | 'approvals']: Pick<StorageProvider[K], 'get'>;
} & { taskRuns: Pick<StorageProvider['taskRuns'], 'listByTask'> };

export class ContinuationExecutionEntryError extends Error {
  constructor(readonly reason: ContinuationExecutionAdmissionReason) {
    super(reason);
    this.name = 'ContinuationExecutionEntryError';
  }
}

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * ADR-0088 execution entry. The guarded commit begins a real attempt and returns its exact identity.
 * No lifecycle preparation, Approval acquisition, execution callback, rediscovery, or recovery.
 * Unwired from production activation; a later receiver must consume this return in the SAME invocation.
 */
export class ContinuationExecutionEntryService {
  constructor(
    private readonly storage: Reads,
    private readonly profiles: AgentProfileRegistry,
    private readonly bindings: Pick<ContinuationBindingRepository, 'get'>,
    private readonly tasks: Pick<TaskManager, 'guardedStartRun'>,
  ) {}

  async start(input: ContinuationExecutionAdmissionInput): Promise<TaskRun> {
    return (await this.startBound(input)).taskRun;
  }

  async [constrainedEntry](input: ContinuationExecutionAdmissionInput, constraint: ContinuationExecutionConstraint): Promise<BoundContinuationStart> {
    return this.startBound(input, constraint);
  }

  private async startBound(input: ContinuationExecutionAdmissionInput, constraint?: ContinuationExecutionConstraint): Promise<BoundContinuationStart> {
    let request: ContinuationExecutionAdmissionInput;
    try { request = snapshot(input); }
    catch { throw new ContinuationExecutionEntryError('INVALID_REQUEST'); }
    const facts: {
      handoff: WorkHandoff | null; binding: ContinuationBinding | null; workItem: WorkItem | null;
      task: Task | null; approval: ApprovalRequest | null;
    } = { handoff: null, binding: null, workItem: null, task: null, approval: null };
    // Retain exactly the fresh snapshots evaluated, not different second reads after policy succeeds.
    // These snapshots are only expectations: the repository re-reads them all inside its transaction.
    const admission = new ContinuationExecutionAdmissionService({
      workHandoffs: { get: async id => (facts.handoff = snapshot(await this.storage.workHandoffs.get(id))) },
      workItems: { get: async id => (facts.workItem = snapshot(await this.storage.workItems.get(id))) },
      tasks: { get: async id => (facts.task = snapshot(await this.storage.tasks.get(id))) },
      approvals: { get: async id => (facts.approval = snapshot(await this.storage.approvals.get(id))) },
      taskRuns: { listByTask: id => this.storage.taskRuns.listByTask(id) },
    }, this.profiles, { get: async id => (facts.binding = snapshot(await this.bindings.get(id))) });
    const decision = await admission.evaluate(request);
    if (decision.disposition === 'DENY') throw new ContinuationExecutionEntryError(decision.reason);
    if (!facts.handoff || !facts.binding || !facts.workItem || !facts.task) {
      throw new ContinuationExecutionEntryError('INVALID_REQUEST');
    }
    try {
      this.profiles.get(facts.handoff.fromAgentProfileId);
      this.profiles.get(facts.handoff.toAgentProfileId);
    } catch (error) {
      if (error instanceof AgentProfileConfigurationError) throw new ContinuationExecutionEntryError('AGENT_PROFILE_UNAVAILABLE');
      throw error;
    }
    if (constraint && (!constraint.supportedCapabilities.includes(facts.task.intent.capability)
      || !isFamilyACapability(facts.task.intent.capability))) {
      throw new ContinuationExecutionEntryError('INVALID_REQUEST');
    }
    const boundTaskFacts = Object.freeze({ capability: facts.task.intent.capability, intentType: facts.task.intent.type });
    const planRef = request.plan ? executionPlanRef(request.plan) : undefined;
    const expected: GuardedTaskRunStartFacts = {
      handoff: facts.handoff, binding: facts.binding, workItem: facts.workItem, task: facts.task,
      approval: facts.approval && planRef
        ? { kind: 'APPROVED', request: facts.approval, planRef }
        : { kind: 'NOT_REQUIRED', ...(planRef ? { planRef } : {}) },
    };
    const taskRun = await this.tasks.guardedStartRun(expected, facts.task.intent.capability);
    return Object.freeze({ taskRun, boundTaskFacts });
  }
}
