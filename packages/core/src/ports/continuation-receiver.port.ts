import type { ContinuationRoutingAudit } from './continuation-routing-audit';
import type { AgentProfile, Capability, ExecutionPlan, Id, IntentType, TaskRun, WorkHandoff } from '../domain';

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;

export interface ContinuationBoundTaskFacts {
  readonly capability: Capability;
  readonly intentType: IntentType;
}

/** Canonical same-invocation values only. Capability is taskRun.capability; no authority overrides. */
export interface ContinuationReceiverInput {
  readonly handoff: WorkHandoff;
  readonly destinationAgentProfile: AgentProfile;
  readonly plan: Immutable<ExecutionPlan>;
  readonly taskRun: Immutable<TaskRun>;
  readonly boundTaskFacts: ContinuationBoundTaskFacts;
}

/** Receiver reports bounded facts; TaskManager alone mutates the exact attempt. No workflow authority. */
export type ContinuationReceiverOutcome =
  | Readonly<{ disposition: 'SUCCEEDED'; artifactIds: readonly Id[]; acceptedProviderId?: string; routingAudit?: ContinuationRoutingAudit }>
  | Readonly<{ disposition: 'FAILED'; error: 'CONTINUATION_RECEIVER_FAILED'; routingAudit?: ContinuationRoutingAudit }>
  | Readonly<{ disposition: 'UNRESOLVED'; reason: 'EXECUTION_UNCERTAIN'; routingAudit?: ContinuationRoutingAudit }>;

/** Above AiProvider: no storage, approval, routing or framework dependencies. No production binding yet. */
export interface ContinuationReceiver {
  readonly supportedCapabilities: readonly Capability[];
  receive(input: ContinuationReceiverInput): Promise<ContinuationReceiverOutcome>;
}
export const CONTINUATION_RECEIVER = Symbol('CONTINUATION_RECEIVER');
