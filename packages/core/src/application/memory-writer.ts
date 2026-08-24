import type {
  DurableMemory,
  MemoryCandidate,
  MemoryCandidateInput,
} from '../domain';

/** Candidate creation and durable promotion policy boundary (ADR-0073 Section 5). */
export interface MemoryWriter {
  createCandidate(input: MemoryCandidateInput): MemoryCandidate;
  promote(candidate: MemoryCandidate): Promise<DurableMemory | null>;
}
