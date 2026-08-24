import { describe, expect, it } from 'vitest';
import {
  DURABLE_MEMORY_REPOSITORY,
  MemoryType,
  createDurableMemory,
  createMemoryCandidate,
  createMemoryRetrievalRequest,
  createRetrievedMemory,
} from '..';
import type {
  DurableMemory,
  DurableMemoryRepository,
  MemoryRetriever,
  MemoryWriter,
} from '..';

const createdAt = '2026-08-24T01:00:00.000Z';

const memory = (): DurableMemory =>
  createDurableMemory({
    id: 'memory-1',
    content: 'The user prefers concise status updates.',
    provenance: 'USER_PROVIDED',
    authorityLevel: 'USER_CLAIM_OR_INTENT',
    scope: { actorId: 'actor-1', projectId: 'project-1' },
    createdAt,
    updatedAt: createdAt,
    metadata: { importance: 0.8 },
  });

describe('durable memory domain (ADR-0073)', () => {
  it('constructs an attributable, scoped LONG_TERM memory', () => {
    expect(memory()).toEqual({
      id: 'memory-1',
      content: 'The user prefers concise status updates.',
      memoryType: MemoryType.LONG_TERM,
      provenance: 'USER_PROVIDED',
      authorityLevel: 'USER_CLAIM_OR_INTENT',
      scope: { actorId: 'actor-1', projectId: 'project-1' },
      createdAt,
      updatedAt: createdAt,
      metadata: { importance: 0.8 },
    });
  });

  it('rejects empty content, unscoped memory, invalid chronology, and self-supersession', () => {
    const base = memory();
    expect(() => createDurableMemory({ ...base, content: '  ' })).toThrow(
      'content must not be empty',
    );
    expect(() => createDurableMemory({ ...base, scope: {} })).toThrow(
      'scope must contain at least one constraint',
    );
    expect(() =>
      createDurableMemory({
        ...base,
        updatedAt: '2026-08-23T23:59:59.000Z',
      }),
    ).toThrow('updatedAt must not precede createdAt');
    expect(() => createDurableMemory({ ...base, supersededBy: base.id })).toThrow(
      'a memory cannot supersede itself',
    );
  });

  it('requires expiry to be a valid timestamp after creation', () => {
    const base = memory();
    expect(() => createDurableMemory({ ...base, expiresAt: 'tomorrow' })).toThrow(
      'expiresAt must be an ISO-8601 timestamp',
    );
    expect(() => createDurableMemory({ ...base, expiresAt: createdAt })).toThrow(
      'expiresAt must follow createdAt',
    );
  });
});

describe('durable memory value objects', () => {
  it('keeps a candidate distinct from persisted memory and defaults validation to PENDING', () => {
    const candidate = createMemoryCandidate({
      content: 'Use concise updates.',
      sourceContent: 'Please remember that I prefer concise updates.',
      trigger: 'EXPLICIT_USER_INSTRUCTION',
      provenance: 'USER_PROVIDED',
      authorityLevel: 'USER_CLAIM_OR_INTENT',
      scope: { actorId: 'actor-1' },
    });

    expect(candidate.validationState).toBe('PENDING');
    expect(candidate.metadata).toEqual({});
    expect(candidate).not.toHaveProperty('id');
    expect(candidate).not.toHaveProperty('memoryType');
    expect(candidate).not.toHaveProperty('createdAt');
  });

  it('requires candidate content, source content, and an exact scope constraint', () => {
    const valid = {
      content: 'Use concise updates.',
      sourceContent: 'Remember concise updates.',
      trigger: 'EXPLICIT_USER_INSTRUCTION' as const,
      provenance: 'USER_PROVIDED' as const,
      authorityLevel: 'USER_CLAIM_OR_INTENT' as const,
      scope: { actorId: 'actor-1' },
    };
    expect(() => createMemoryCandidate({ ...valid, sourceContent: '' })).toThrow(
      'sourceContent must not be empty',
    );
    expect(() => createMemoryCandidate({ ...valid, scope: {} })).toThrow(
      'scope must contain at least one constraint',
    );
  });

  it('constructs a bounded retrieval request with explicit authority fitness', () => {
    expect(
      createMemoryRetrievalRequest({
        query: 'How should status updates be written?',
        scope: { actorId: 'actor-1' },
        authorityFitness: ['USER_CLAIM_OR_INTENT'],
        maxResults: 5,
      }),
    ).toEqual({
      query: 'How should status updates be written?',
      scope: { actorId: 'actor-1' },
      authorityFitness: ['USER_CLAIM_OR_INTENT'],
      maxResults: 5,
      excludeIds: [],
    });
  });

  it('rejects unbounded retrieval and invalid exclusions', () => {
    const base = {
      query: 'status updates',
      scope: { projectId: 'project-1' },
      authorityFitness: ['NON_AUTHORITATIVE_BACKGROUND'] as const,
      maxResults: 5,
    };
    expect(() => createMemoryRetrievalRequest({ ...base, maxResults: 0 })).toThrow(
      'maxResults must be an integer between 1 and 100',
    );
    expect(() => createMemoryRetrievalRequest({ ...base, maxResults: 101 })).toThrow(
      'maxResults must be an integer between 1 and 100',
    );
    expect(() => createMemoryRetrievalRequest({ ...base, authorityFitness: [] })).toThrow(
      'authorityFitness must not be empty',
    );
    expect(() => createMemoryRetrievalRequest({ ...base, excludeIds: ['same', 'same'] })).toThrow(
      'excludeIds must not contain duplicates',
    );
  });

  it('bounds relevance and requires an explainable retrieval reason', () => {
    expect(
      createRetrievedMemory({
        memory: memory(),
        relevanceScore: 0.75,
        retrievalReason: 'actor scope and semantic relevance matched',
      }),
    ).toMatchObject({ relevanceScore: 0.75 });
    expect(() =>
      createRetrievedMemory({ memory: memory(), relevanceScore: 1.1, retrievalReason: 'match' }),
    ).toThrow('relevanceScore must be between 0 and 1');
    expect(() =>
      createRetrievedMemory({ memory: memory(), relevanceScore: 0.5, retrievalReason: ' ' }),
    ).toThrow('retrievalReason must not be empty');
  });

  it('exports the storage-neutral service, repository, and DI contracts', () => {
    const repository: DurableMemoryRepository = {
      save: async (value) => value,
      get: async () => null,
      findByScope: async () => [],
      update: async (value) => value,
      softDelete: async () => true,
    };
    const retriever: MemoryRetriever = { retrieve: async () => [] };
    const writer: MemoryWriter = {
      createCandidate: (input) => createMemoryCandidate(input),
      promote: async () => null,
    };

    expect(repository).toBeDefined();
    expect(retriever).toBeDefined();
    expect(writer).toBeDefined();
    expect(DURABLE_MEMORY_REPOSITORY.description).toBe('DurableMemoryRepository');
  });
});
