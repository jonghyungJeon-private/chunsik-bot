import { MemoryType } from './enums';
import type { Id, IsoTimestamp, Metadata } from './common';
import type { EpistemicStatus } from './prompting';

export const MAX_MEMORY_RETRIEVAL_RESULTS = 100;

export type DurableMemoryProvenance =
  | 'USER_PROVIDED'
  | 'ASSISTANT_GENERATED'
  | 'CANONICAL_PROJECT'
  | 'EPISODIC'
  | 'SEMANTIC';

/** Durable recall is background; it can never establish a current authoritative fact. */
export type DurableMemoryAuthorityLevel = Exclude<
  EpistemicStatus,
  'AUTHORITATIVE_CURRENT_FACT'
>;

export interface DurableMemoryScope {
  sessionId?: Id;
  projectId?: Id;
  actorId?: Id;
}

export interface DurableMemory {
  id: Id;
  content: string;
  memoryType: MemoryType.LONG_TERM;
  provenance: DurableMemoryProvenance;
  authorityLevel: DurableMemoryAuthorityLevel;
  scope: DurableMemoryScope;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  expiresAt?: IsoTimestamp;
  supersededBy?: Id;
  metadata: Metadata;
}

export type DurableMemoryInput = Omit<DurableMemory, 'memoryType'> & {
  memoryType?: MemoryType.LONG_TERM;
};

export type MemoryPromotionTrigger =
  | 'EXPLICIT_USER_INSTRUCTION'
  | 'SYSTEM_DETECTED_IMPORTANCE'
  | 'PERIODIC_CONSOLIDATION';

export type MemoryCandidateValidationState = 'PENDING' | 'VALIDATED' | 'REJECTED';

export interface MemoryCandidateInput {
  content: string;
  sourceContent: string;
  trigger: MemoryPromotionTrigger;
  provenance: DurableMemoryProvenance;
  authorityLevel: DurableMemoryAuthorityLevel;
  scope: DurableMemoryScope;
  metadata?: Metadata;
}

/** A transient proposal. It intentionally has no persisted-memory identity or timestamps. */
export interface MemoryCandidate {
  content: string;
  sourceContent: string;
  trigger: MemoryPromotionTrigger;
  provenance: DurableMemoryProvenance;
  authorityLevel: DurableMemoryAuthorityLevel;
  scope: DurableMemoryScope;
  validationState: MemoryCandidateValidationState;
  metadata: Metadata;
}

export interface MemoryRetrievalRequestInput {
  query: string;
  scope: DurableMemoryScope;
  authorityFitness: readonly DurableMemoryAuthorityLevel[];
  maxResults: number;
  excludeIds?: readonly Id[];
}

export interface MemoryRetrievalRequest {
  query: string;
  scope: DurableMemoryScope;
  authorityFitness: readonly DurableMemoryAuthorityLevel[];
  maxResults: number;
  excludeIds: readonly Id[];
}

export interface RetrievedMemoryInput {
  memory: DurableMemory;
  relevanceScore: number;
  retrievalReason: string;
}

export interface RetrievedMemory extends RetrievedMemoryInput {}

export class DurableMemoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DurableMemoryValidationError';
  }
}

function requireText(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new DurableMemoryValidationError(`${field} must not be empty`);
  }
}

function requireTimestamp(value: IsoTimestamp, field: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new DurableMemoryValidationError(`${field} must be an ISO-8601 timestamp`);
  }
}

function validateScope(scope: DurableMemoryScope): void {
  const values = [scope.sessionId, scope.projectId, scope.actorId];
  if (!values.some((value) => value !== undefined)) {
    throw new DurableMemoryValidationError('scope must contain at least one constraint');
  }
  for (const value of values) {
    if (value !== undefined) requireText(value, 'scope identifier');
  }
}

export function createDurableMemory(input: DurableMemoryInput): DurableMemory {
  requireText(input.id, 'id');
  requireText(input.content, 'content');
  validateScope(input.scope);
  requireTimestamp(input.createdAt, 'createdAt');
  requireTimestamp(input.updatedAt, 'updatedAt');
  if (input.updatedAt < input.createdAt) {
    throw new DurableMemoryValidationError('updatedAt must not precede createdAt');
  }
  if (input.expiresAt !== undefined) {
    requireTimestamp(input.expiresAt, 'expiresAt');
    if (input.expiresAt <= input.createdAt) {
      throw new DurableMemoryValidationError('expiresAt must follow createdAt');
    }
  }
  if (input.supersededBy !== undefined) {
    requireText(input.supersededBy, 'supersededBy');
    if (input.supersededBy === input.id) {
      throw new DurableMemoryValidationError('a memory cannot supersede itself');
    }
  }

  return { ...input, memoryType: MemoryType.LONG_TERM };
}

export function createMemoryCandidate(input: MemoryCandidateInput): MemoryCandidate {
  requireText(input.content, 'content');
  requireText(input.sourceContent, 'sourceContent');
  validateScope(input.scope);
  return {
    ...input,
    validationState: 'PENDING',
    metadata: input.metadata ?? {},
  };
}

export function createMemoryRetrievalRequest(
  input: MemoryRetrievalRequestInput,
): MemoryRetrievalRequest {
  requireText(input.query, 'query');
  validateScope(input.scope);
  if (
    !Number.isInteger(input.maxResults) ||
    input.maxResults < 1 ||
    input.maxResults > MAX_MEMORY_RETRIEVAL_RESULTS
  ) {
    throw new DurableMemoryValidationError(
      `maxResults must be an integer between 1 and ${MAX_MEMORY_RETRIEVAL_RESULTS}`,
    );
  }
  if (input.authorityFitness.length === 0) {
    throw new DurableMemoryValidationError('authorityFitness must not be empty');
  }
  const excludeIds = input.excludeIds ?? [];
  for (const id of excludeIds) requireText(id, 'excludeId');
  if (new Set(excludeIds).size !== excludeIds.length) {
    throw new DurableMemoryValidationError('excludeIds must not contain duplicates');
  }
  return { ...input, excludeIds };
}

export function createRetrievedMemory(input: RetrievedMemoryInput): RetrievedMemory {
  if (
    !Number.isFinite(input.relevanceScore) ||
    input.relevanceScore < 0 ||
    input.relevanceScore > 1
  ) {
    throw new DurableMemoryValidationError('relevanceScore must be between 0 and 1');
  }
  requireText(input.retrievalReason, 'retrievalReason');
  return { ...input };
}
