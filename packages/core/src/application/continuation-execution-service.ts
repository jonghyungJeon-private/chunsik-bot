import { WorkItemStatus } from '../domain';
import type { TaskRun } from '../domain';
import type { ContinuationBindingRepository, StorageProvider } from '../ports';
import type { AgentProfileRegistry } from './agent-profile-registry';
import type { ContinuationExecutionEntryService } from './continuation-execution-entry-service';
import { ContinuationExecutionProductPolicy, createContinuationExecutionRequestContext } from './continuation-execution-product-policy';
import type { ContinuationExecutionProductDenial, ContinuationExecutionRequestContext } from './continuation-execution-product-policy';
import { isCanonicalText, isTimestampText } from './continuation-live-plan-proof';
import { WorkHandoffConsumptionService } from './work-handoff-consumption-service';
import type { ContinuationLifecycleResult, WorkHandoffContinuationService } from './work-handoff-continuation-service';

type Reads = { [K in 'workHandoffs' | 'workItems' | 'tasks']: Pick<StorageProvider[K], 'get'> };
type PreparationDenial = Extract<ContinuationLifecycleResult, { disposition: 'DENY' }>['reason'];

/** Same-invocation outcome only; never a reusable execution/dispatch authorization. */
export type ContinuationExecutionResult = Readonly<
  | { disposition: 'ATTEMPT_STARTED'; taskRun: TaskRun }
  | { disposition: 'DENY'; stage: 'CONTEXT' | 'CANONICAL'; reason:
      'INVALID_REQUEST' | 'BINDING_MISMATCH' | 'WORK_ITEM_NOT_CONTINUABLE' | 'TASK_MISMATCH' }
  | { disposition: 'DENY'; stage: 'PRODUCT_POLICY'; reason: ContinuationExecutionProductDenial }
  | { disposition: 'DENY'; stage: 'PREPARE'; reason: PreparationDenial | 'HUMAN_WAIT_REQUIRED' }
>;

/**
 * ADR-0089 Family A / M3E-6J explicit caller. No transport, receiver, Provider, approval reentry or retry.
 * Consumption owns handoff/profile provenance checks; Product policy owns explicit authorization;
 * preparation owns lifecycle; entry performs fresh admission and the effect-time guarded start.
 * Canonical reads are point-in-time, not an atomic snapshot or authority. Entry/guarded-start errors
 * propagate unchanged, including unresolved attempts, expectation races and storage contention.
 */
export class ContinuationExecutionService {
  constructor(
    private readonly storage: Reads,
    private readonly profiles: AgentProfileRegistry,
    private readonly bindings: Pick<ContinuationBindingRepository, 'get'>,
    private readonly preparation: Pick<WorkHandoffContinuationService, 'prepare'>,
    private readonly entry: Pick<ContinuationExecutionEntryService, 'start'>,
  ) {}

  async startExplicitContinuation(input: ContinuationExecutionRequestContext): Promise<ContinuationExecutionResult> {
    let request: ContinuationExecutionRequestContext;
    try {
      // No caller-supplied canonical entities or approval authority, including untyped transport extras.
      if (!input || Object.keys(input).some(key =>
        !['trigger', 'handoffId', 'taskId', 'actorId', 'projectId', 'plan'].includes(key))) {
        return Object.freeze({ disposition: 'DENY', stage: 'CONTEXT', reason: 'INVALID_REQUEST' });
      }
      // Must precede the first await. Only this independent frozen snapshot survives async boundaries.
      request = createContinuationExecutionRequestContext(input);
    } catch {
      return Object.freeze({ disposition: 'DENY', stage: 'CONTEXT', reason: 'INVALID_REQUEST' });
    }
    if (!isCanonicalText(request.handoffId) || !isCanonicalText(request.taskId)) {
      return Object.freeze({ disposition: 'DENY', stage: 'CONTEXT', reason: 'INVALID_REQUEST' });
    }
    const consumed = await new WorkHandoffConsumptionService(this.storage, this.profiles).evaluate(request.handoffId);
    if (consumed.disposition !== 'CONTINUE') {
      return Object.freeze({ disposition: 'DENY', stage: 'CANONICAL', reason: 'WORK_ITEM_NOT_CONTINUABLE' });
    }
    const binding = await this.bindings.get(request.handoffId);
    if (!binding || binding.handoffId !== request.handoffId || binding.taskId !== request.taskId
      || !isTimestampText(binding.recordedAt)) {
      return Object.freeze({ disposition: 'DENY', stage: 'CANONICAL', reason: 'BINDING_MISMATCH' });
    }
    // Consumption returns canonical handoff-derived identity, not caller facts. Re-read the work value
    // needed by Product policy because consumption deliberately exposes provenance only.
    const work = await this.storage.workItems.get(consumed.workItemId);
    if (!work || work.id !== consumed.workItemId || work.status !== WorkItemStatus.ACTIVE) {
      return Object.freeze({ disposition: 'DENY', stage: 'CANONICAL', reason: 'WORK_ITEM_NOT_CONTINUABLE' });
    }
    const task = await this.storage.tasks.get(binding.taskId);
    if (!task || task.id !== request.taskId) {
      return Object.freeze({ disposition: 'DENY', stage: 'CANONICAL', reason: 'TASK_MISMATCH' });
    }
    const policy = new ContinuationExecutionProductPolicy().evaluate(request, work, task);
    if (policy.disposition !== 'ELIGIBLE_NO_WAIT') {
      return Object.freeze({ disposition: 'DENY', stage: 'PRODUCT_POLICY', reason: policy.reason });
    }
    const exact = Object.freeze({ handoffId: request.handoffId, taskId: request.taskId, plan: request.plan });
    const prepared = await this.preparation.prepare(exact);
    if (prepared.disposition === 'DENY') {
      return Object.freeze({ disposition: 'DENY', stage: 'PREPARE', reason: prepared.reason });
    }
    if (prepared.disposition !== 'RUNNING_READY' && prepared.disposition !== 'ALREADY_RUNNING') {
      return Object.freeze({ disposition: 'DENY', stage: 'PREPARE', reason: 'HUMAN_WAIT_REQUIRED' });
    }
    const taskRun = await this.entry.start(exact);
    // Preserve the exact returned object. No lookup, ordinal selection, receiver or terminalization.
    return Object.freeze({ disposition: 'ATTEMPT_STARTED', taskRun });
  }
}
