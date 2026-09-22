import type { AgentProfile, ExecutionPlan, Id, TaskRun, WorkHandoff } from '../domain';

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;

/** Canonical same-invocation values only. Capability is taskRun.capability; no authority overrides. */
export interface ContinuationReceiverInput {
  readonly handoff: WorkHandoff;
  readonly destinationAgentProfile: AgentProfile;
  readonly plan: Immutable<ExecutionPlan>;
  readonly taskRun: Immutable<TaskRun>;
}

/** Receiver reports bounded facts; TaskManager alone mutates the exact attempt. No workflow authority. */
export type ContinuationReceiverOutcome =
  | Readonly<{ disposition: 'SUCCEEDED'; artifactIds: readonly Id[] }>
  | Readonly<{ disposition: 'FAILED'; error: 'CONTINUATION_RECEIVER_FAILED' }>;

/** Above AiProvider: no storage, approval, routing or framework dependencies. No production binding yet. */
export interface ContinuationReceiver {
  receive(input: ContinuationReceiverInput): Promise<ContinuationReceiverOutcome>;
}
export const CONTINUATION_RECEIVER = Symbol('CONTINUATION_RECEIVER');
