import { createWorkHandoff } from '../domain';
import type { TaskRun } from '../domain';
import type { ContinuationReceiver, ContinuationReceiverOutcome, StorageProvider } from '../ports';
import type { AgentProfileRegistry } from './agent-profile-registry';
import { createContinuationExecutionRequestContext, hasOnlyContinuationRequestFields } from './continuation-execution-product-policy';
import type { ContinuationExecutionRequestContext } from './continuation-execution-product-policy';
import type { ContinuationExecutionResult, ContinuationExecutionService } from './continuation-execution-service';
import type { TaskManager } from './task-manager';
import { WorkHandoffConsumptionService } from './work-handoff-consumption-service';
import { WorkHandoffConsumptionError, WorkHandoffConsumptionFailureCode } from './work-handoff-consumption-service';

export type ContinuationReceiverExecutionResult =
  | Extract<ContinuationExecutionResult, { disposition: 'DENY' }>
  | Readonly<{ disposition: 'DENY'; stage: 'RECEIVER_PREFLIGHT'; reason: 'RECEIVER_UNAVAILABLE' }>
  | Readonly<{ disposition: 'ATTEMPT_SUCCEEDED' | 'ATTEMPT_FAILED'; taskRun: TaskRun }>;

/** Freeze in place to retain exact started-run identity, including any nested audit metadata. */
function freezeValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) freezeValue(child, seen);
    Object.freeze(value);
  }
  return value;
}

/**
 * ADR-0089 / M3E-6K. Same invocation only: preflight → real 6J start → receiver → TaskManager.
 * No direct admission/start/save, lookup after start, Provider, retry or production receiver binding.
 * Pre-start typed errors retain their meaning. A process crash may leave STARTED unresolved;
 * no exactly-once external effects, auto-recovery, replacement attempt or redispatch is claimed.
 */
export class ContinuationReceiverExecutionService {
  constructor(
    private readonly storage: {
      workHandoffs: Pick<StorageProvider['workHandoffs'], 'get'>;
      workItems: Pick<StorageProvider['workItems'], 'get'>;
    },
    private readonly profiles: AgentProfileRegistry,
    private readonly continuation: Pick<ContinuationExecutionService, 'startExplicitContinuation'>,
    private readonly tasks: Pick<TaskManager, 'completeRun' | 'failRun'>,
    private readonly receiver: ContinuationReceiver | undefined,
  ) {}

  async executeExplicitContinuation(input: ContinuationExecutionRequestContext): Promise<ContinuationReceiverExecutionResult> {
    let request: ContinuationExecutionRequestContext;
    try {
      if (!hasOnlyContinuationRequestFields(input)) throw new Error('Invalid request');
      request = createContinuationExecutionRequestContext(input);
    } catch {
      return Object.freeze({ disposition: 'DENY', stage: 'CONTEXT', reason: 'INVALID_REQUEST' });
    }
    const receiver = this.receiver;
    if (!receiver || typeof receiver.receive !== 'function') {
      return Object.freeze({ disposition: 'DENY', stage: 'RECEIVER_PREFLIGHT', reason: 'RECEIVER_UNAVAILABLE' });
    }
    // Consumption validates exactly the immutable handoff retained for receiver context, without a
    // second handoff lookup. Its canonical lifecycle/profile checks stay with the existing owner.
    let handoff: ReturnType<typeof createWorkHandoff> | undefined;
    const consumed = await new WorkHandoffConsumptionService({
      workItems: this.storage.workItems,
      workHandoffs: { get: async id => {
        const loaded = await this.storage.workHandoffs.get(id);
        if (!loaded) return null;
        try { handoff = createWorkHandoff(loaded); }
        catch { throw new WorkHandoffConsumptionError(WorkHandoffConsumptionFailureCode.INVALID_HANDOFF); }
        return loaded;
      } },
    }, this.profiles).evaluate(request.handoffId);
    if (consumed.disposition !== 'CONTINUE') {
      return Object.freeze({ disposition: 'DENY', stage: 'CANONICAL', reason: 'WORK_ITEM_NOT_CONTINUABLE' });
    }
    if (!handoff) throw new WorkHandoffConsumptionError(WorkHandoffConsumptionFailureCode.HANDOFF_NOT_FOUND);
    const destinationAgentProfile = this.profiles.get(handoff.toAgentProfileId);
    const started = await this.continuation.startExplicitContinuation(request);
    if (started.disposition === 'DENY') return started;
    const startedRun = started.taskRun;
    let outcome: ContinuationReceiverOutcome;
    try {
      const input = Object.freeze({ handoff, destinationAgentProfile, plan: request.plan,
        taskRun: freezeValue(startedRun) });
      const reported = await receiver.receive(input);
      // Runtime malformed/unexpected output is a bounded receiver failure, never fabricated success.
      if (reported?.disposition === 'SUCCEEDED' && Array.isArray(reported.artifactIds)
        && reported.artifactIds.every(id => typeof id === 'string' && id.length > 0 && id.trim() === id)) {
        outcome = { disposition: 'SUCCEEDED', artifactIds: [...reported.artifactIds] };
      } else {
        outcome = { disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED' };
      }
    } catch {
      // Never copy arbitrary exception messages, stacks, paths or payloads into persisted failure text.
      outcome = { disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED' };
    }
    // Keep persistence outside the receiver catch: no fallback save or retry after terminalization errors.
    if (outcome.disposition === 'SUCCEEDED') {
      const taskRun = await this.tasks.completeRun(startedRun, { artifactIds: [...outcome.artifactIds] });
      return Object.freeze({ disposition: 'ATTEMPT_SUCCEEDED', taskRun });
    }
    const taskRun = await this.tasks.failRun(startedRun, outcome.error);
    return Object.freeze({ disposition: 'ATTEMPT_FAILED', taskRun });
  }
}
