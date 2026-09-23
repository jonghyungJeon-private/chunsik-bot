import { Capability } from '../domain';
import type { TaskRun } from '../domain';
import type { ContinuationBoundTaskFacts } from '../ports/continuation-receiver.port';

// Package-internal cooperation keys: deliberately absent from the public barrels/request DTO.
export const constrainedContinuation = Symbol('constrainedContinuation');
export const constrainedEntry = Symbol('constrainedEntry');
export interface ContinuationExecutionConstraint {
  readonly supportedCapabilities: readonly Capability[];
}
export interface BoundContinuationStart {
  readonly taskRun: TaskRun;
  readonly boundTaskFacts: ContinuationBoundTaskFacts;
}
export function snapshotReceiverConstraint(value: unknown): ContinuationExecutionConstraint {
  if (!Array.isArray(value) || value.length === 0 || value.length > Object.values(Capability).length
    || value.some(v => !Object.values(Capability).includes(v)) || new Set(value).size !== value.length) {
    throw new Error('INVALID_RECEIVER_SUPPORT');
  }
  return Object.freeze({ supportedCapabilities: Object.freeze([...value]) });
}
