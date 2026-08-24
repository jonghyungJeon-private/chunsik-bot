import type {
  DurableMemory,
  DurableMemoryScope,
  Id,
  MemoryCandidate,
  MemoryCandidateInput,
} from '../domain';

export type MemoryWriteDecision =
  | {
      readonly outcome: 'PROMOTED';
      readonly memory: DurableMemory;
      readonly policyReason: string;
    }
  | {
      readonly outcome: 'DUPLICATE';
      readonly existingMemoryId: Id;
      readonly policyReason: string;
    }
  | {
      readonly outcome: 'REJECTED';
      readonly policyReason: string;
    }
  | {
      readonly outcome: 'SUPERSEDING';
      readonly memory: DurableMemory;
      readonly supersededMemoryId: Id;
      readonly policyReason: string;
    };

/** An exact, scope-bound forget request; scope-wide deletion is intentionally absent. */
export interface MemoryForgetRequest {
  readonly memoryId: Id;
  readonly scope: DurableMemoryScope;
}

export type MemoryForgetResult =
  | {
      readonly outcome: 'FORGOTTEN';
      readonly memoryId: Id;
      readonly policyReason: string;
    }
  | {
      readonly outcome: 'NOT_FOUND';
      readonly memoryId: Id;
      readonly policyReason: string;
    }
  | {
      readonly outcome: 'REJECTED';
      readonly memoryId: Id;
      readonly policyReason: string;
    };

/** Candidate creation and durable promotion policy boundary (ADR-0073 Section 5). */
export interface MemoryWriter {
  createCandidate(input: MemoryCandidateInput): MemoryCandidate;
  promote(candidate: MemoryCandidate): Promise<MemoryWriteDecision>;
  forget(request: MemoryForgetRequest): Promise<MemoryForgetResult>;
}
