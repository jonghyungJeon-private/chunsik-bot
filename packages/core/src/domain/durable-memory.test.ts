import { describe, expect, it } from 'vitest';
import * as core from '..';
import {
  MemoryType,
  createDurableMemory,
  createMemoryCandidate,
  createMemoryRetrievalRequest,
  createRetrievedMemory,
} from '..';
import type {
  DurableMemory,
  DurableMemoryAuthorityLevel,
  DurableMemoryProvenance,
  MemoryForgetResult,
  MemoryRetriever,
  MemoryWriteDecision,
  MemoryWriter,
} from '..';

const createdAt = '2026-08-24T01:00:00.000Z';

const memory = (): DurableMemory =>
  createDurableMemory({
    id: 'memory-1',
    content: 'The user prefers concise status updates.',
    kind: 'SEMANTIC',
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
      kind: 'SEMANTIC',
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

  it('rejects authoritative current facts at the runtime construction boundary', () => {
    const base = memory();
    expect(() =>
      createDurableMemory({
        ...base,
        authorityLevel: 'AUTHORITATIVE_CURRENT_FACT',
      } as unknown as Parameters<typeof createDurableMemory>[0]),
    ).toThrow('durable memory cannot have AUTHORITATIVE_CURRENT_FACT authority');
  });

  it('rejects provenance and authority combinations that overstate their source', () => {
    const base = memory();
    expect(() =>
      createDurableMemory({
        ...base,
        provenance: 'ASSISTANT_GENERATED',
        authorityLevel: 'USER_CLAIM_OR_INTENT',
      }),
    ).toThrow(
      'ASSISTANT_GENERATED provenance requires ASSISTANT_NON_AUTHORITATIVE authority',
    );
    expect(() =>
      createDurableMemory({
        ...base,
        provenance: 'CANONICAL_PROJECT',
        authorityLevel: 'USER_CLAIM_OR_INTENT',
      }),
    ).toThrow(
      'CANONICAL_PROJECT provenance requires NON_AUTHORITATIVE_BACKGROUND authority',
    );
  });

  it.each<readonly [DurableMemoryProvenance, DurableMemoryAuthorityLevel]>([
    ['USER_PROVIDED', 'USER_CLAIM_OR_INTENT'],
    ['ASSISTANT_GENERATED', 'ASSISTANT_NON_AUTHORITATIVE'],
    ['CORE_RUNTIME', 'NON_AUTHORITATIVE_BACKGROUND'],
    ['CANONICAL_PROJECT', 'NON_AUTHORITATIVE_BACKGROUND'],
    ['TOOL_OR_CONNECTOR', 'NON_AUTHORITATIVE_BACKGROUND'],
    ['LEGACY_UNKNOWN', 'NON_AUTHORITATIVE_BACKGROUND'],
  ])('accepts the bounded %s provenance authority mapping', (provenance, authorityLevel) => {
    const base = memory();
    expect(createDurableMemory({ ...base, provenance, authorityLevel })).toMatchObject({
      provenance,
      authorityLevel,
    });
  });
});

describe('durable memory value objects', () => {
  it('keeps a candidate distinct from persisted memory and defaults validation to PENDING', () => {
    const candidate = createMemoryCandidate({
      content: 'Use concise updates.',
      sourceContent: 'Please remember that I prefer concise updates.',
      trigger: 'EXPLICIT_USER_INSTRUCTION',
      kind: 'SEMANTIC',
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
      kind: 'SEMANTIC' as const,
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
    expect(() =>
      createMemoryRetrievalRequest({
        ...base,
        authorityFitness: ['AUTHORITATIVE_CURRENT_FACT'],
      } as unknown as Parameters<typeof createMemoryRetrievalRequest>[0]),
    ).toThrow('authorityFitness contains authority invalid for durable memory');
  });

  it('defensively copies and freezes nested mutable input values', () => {
    const scope = { actorId: 'actor-1' };
    const nested = { labels: ['preference'], detail: { confidence: 0.8 } };
    const durable = createDurableMemory({
      id: 'memory-immutable',
      content: 'Prefer concise updates.',
      kind: 'SEMANTIC',
      provenance: 'USER_PROVIDED',
      authorityLevel: 'USER_CLAIM_OR_INTENT',
      scope,
      createdAt,
      updatedAt: createdAt,
      metadata: nested,
    });
    scope.actorId = 'mutated';
    nested.labels.push('mutated');
    nested.detail.confidence = 0;

    expect(durable.scope).toEqual({ actorId: 'actor-1' });
    expect(durable.metadata).toEqual({
      labels: ['preference'],
      detail: { confidence: 0.8 },
    });
    expect(Object.isFrozen(durable)).toBe(true);
    expect(Object.isFrozen(durable.scope)).toBe(true);
    expect(Object.isFrozen(durable.metadata)).toBe(true);
    expect(Object.isFrozen(durable.metadata['labels'])).toBe(true);
    expect(Object.isFrozen(durable.metadata['detail'])).toBe(true);
  });

  it('defensively copies and freezes retrieval scope, authority fitness, and exclusions', () => {
    const scope = { actorId: 'actor-1' };
    const authorityFitness: DurableMemoryAuthorityLevel[] = ['USER_CLAIM_OR_INTENT'];
    const excludeIds = ['memory-old'];
    const request = createMemoryRetrievalRequest({
      query: 'status updates',
      scope,
      authorityFitness,
      maxResults: 5,
      excludeIds,
    });
    scope.actorId = 'mutated';
    authorityFitness.push('NON_AUTHORITATIVE_BACKGROUND');
    excludeIds.push('memory-new');

    expect(request.scope).toEqual({ actorId: 'actor-1' });
    expect(request.authorityFitness).toEqual(['USER_CLAIM_OR_INTENT']);
    expect(request.excludeIds).toEqual(['memory-old']);
    expect(Object.isFrozen(request.scope)).toBe(true);
    expect(Object.isFrozen(request.authorityFitness)).toBe(true);
    expect(Object.isFrozen(request.excludeIds)).toBe(true);
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

  it('exports decision-shaped writer and forgetting ownership contracts', async () => {
    const retriever: MemoryRetriever = { retrieve: async () => [] };
    const writer: MemoryWriter = {
      createCandidate: (input) => createMemoryCandidate(input),
      promote: async (): Promise<MemoryWriteDecision> => ({
        outcome: 'DUPLICATE',
        existingMemoryId: 'memory-1',
        policyReason: 'normalized content already exists in the exact scope',
      }),
      forget: async (request): Promise<MemoryForgetResult> => ({
        outcome: 'FORGOTTEN',
        memoryId: request.memoryId,
        policyReason: 'exact scoped forget request accepted',
      }),
    };

    expect(retriever).toBeDefined();
    await expect(
      writer.promote(
        createMemoryCandidate({
          content: 'Use concise updates.',
          sourceContent: 'Remember concise updates.',
          trigger: 'EXPLICIT_USER_INSTRUCTION',
          kind: 'SEMANTIC',
          provenance: 'USER_PROVIDED',
          authorityLevel: 'USER_CLAIM_OR_INTENT',
          scope: { actorId: 'actor-1' },
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'DUPLICATE', policyReason: expect.any(String) });
    await expect(
      writer.forget({ memoryId: 'memory-1', scope: { actorId: 'actor-1' } }),
    ).resolves.toMatchObject({ outcome: 'FORGOTTEN', policyReason: expect.any(String) });

    const writeDecisions: readonly MemoryWriteDecision[] = [
      { outcome: 'PROMOTED', memory: memory(), policyReason: 'candidate accepted' },
      {
        outcome: 'DUPLICATE',
        existingMemoryId: 'memory-1',
        policyReason: 'exact duplicate',
      },
      { outcome: 'REJECTED', policyReason: 'policy rejected candidate' },
      {
        outcome: 'SUPERSEDING',
        memory: memory(),
        supersededMemoryId: 'memory-old',
        policyReason: 'changed scoped knowledge',
      },
    ];
    const forgetResults: readonly MemoryForgetResult[] = [
      { outcome: 'FORGOTTEN', memoryId: 'memory-1', policyReason: 'forgotten' },
      { outcome: 'NOT_FOUND', memoryId: 'memory-2', policyReason: 'not found in scope' },
      { outcome: 'REJECTED', memoryId: 'memory-3', policyReason: 'policy retained record' },
    ];

    expect(writeDecisions.map(({ outcome }) => outcome)).toEqual([
      'PROMOTED',
      'DUPLICATE',
      'REJECTED',
      'SUPERSEDING',
    ]);
    expect(forgetResults.map(({ outcome }) => outcome)).toEqual([
      'FORGOTTEN',
      'NOT_FOUND',
      'REJECTED',
    ]);
  });

  it('does not publicly export the removed parallel durable repository ownership', () => {
    expect(core).not.toHaveProperty('DURABLE_MEMORY_REPOSITORY');
  });
});
