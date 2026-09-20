import type { Id, IsoTimestamp } from './common';

/** Immutable correlation only. WorkHandoff supplies work/profile; TaskRun supplies attempt identity. */
export interface ContinuationBinding {
  readonly handoffId: Id;
  readonly taskId: Id;
  readonly recordedAt: IsoTimestamp;
}

export class ContinuationAdmissionError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'INCONSISTENT_STATE' | 'STALE_STATE' | 'CONFLICT') {
    super(code);
    this.name = 'ContinuationAdmissionError';
  }
}
