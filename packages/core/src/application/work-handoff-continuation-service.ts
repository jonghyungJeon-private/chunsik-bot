import { Capability, ContinuationAdmissionError, createWorkHandoff, IntentType, RiskLevel, TaskStatus, TaskRunStatus, WorkItemStatus } from '../domain';
import type { ContinuationBinding, Id } from '../domain';
import type { ContinuationBindingRepository, StorageProvider } from '../ports';
import type { AgentProfileRegistry } from './agent-profile-registry';
import { WorkHandoffConsumptionService } from './work-handoff-consumption-service';

type Reads = { [K in 'workHandoffs' | 'workItems' | 'tasks' | 'taskRuns']: Pick<StorageProvider[K], 'get'> };
export type ContinuationAdmission = Readonly<
  { disposition: 'NO_ACTION' } | { disposition: 'BOUND'; binding: ContinuationBinding }
>;

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
    const handoff = createWorkHandoff(loaded);
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
