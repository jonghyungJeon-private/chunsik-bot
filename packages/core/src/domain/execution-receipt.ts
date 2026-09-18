import type { Id, IsoTimestamp } from './common';

/** The producer aggregate kind represented by an execution receipt. */
export enum ExecutionKind {
  COMMAND = 'COMMAND',
}

/** The bounded terminal outcome recorded by CAP-013. */
export enum ExecutionReceiptOutcome {
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

/** The bounded failure classification for a failed receipt. */
export enum ExecutionReceiptFailureClass {
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  TIMED_OUT = 'TIMED_OUT',
}

/** Approval provenance only; approval decision details remain owned by Approval. */
export type ExecutionReceiptAuthorization =
  | { kind: 'NOT_REQUIRED' }
  | { kind: 'APPROVAL'; approvalId: Id };

/**
 * Immutable CAP-013 provenance for one actual terminal producer execution.
 * Receipt identity is independent from the canonical producer aggregate identity.
 */
export interface ExecutionReceipt {
  id: Id;
  executionKind: ExecutionKind;
  sourceId: Id;
  executionPlanId: Id;
  authorization: ExecutionReceiptAuthorization;
  outcome: ExecutionReceiptOutcome;
  failureClass?: ExecutionReceiptFailureClass;
  recordedAt: IsoTimestamp;
}
