import { describe, expect, it } from 'vitest';
import { ContextBuilder } from './context-builder';
import { Capability, IntentType, MemoryType, RiskLevel, TaskStatus } from '../domain';
import type { MemoryRecord, MemoryScope, Task } from '../domain';
import type { MemoryManager } from './memory-manager';

const taskWith = (
  opts: { sessionId?: string; projectId?: string; platform?: string } = {},
): Task => ({
  id: 't1',
  title: 't',
  description: 'hello',
  status: TaskStatus.PENDING,
  intent: {
    type: IntentType.CHAT,
    capability: Capability.GENERAL_CHAT,
    confidence: 1,
    requiresWork: true,
    summary: 'hello',
  },
  riskLevel: RiskLevel.LOW,
  context: {
    platform: opts.platform ?? 'discord',
    channelId: 'c',
    userId: 'u',
  },
  ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
  ...(opts.projectId ? { projectId: opts.projectId } : {}),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const rec = (id: string, role: unknown, content: string): MemoryRecord => ({
  id,
  type: MemoryType.SHORT_TERM,
  scope: {},
  content,
  ...(role === undefined ? {} : { metadata: { role } }),
  createdAt: `2026-01-01T00:00:${id.padStart(2, '0')}.000Z`,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('ContextBuilder (ADR-0063 structured context)', () => {
  it('preserves User/Assistant provenance and epistemic status in same-Session order', async () => {
    let captured: MemoryScope | undefined;
    const memory = {
      recentShortTerm: async (scope: MemoryScope) => {
        captured = scope;
        return [rec('1', 'user', '안녕'), rec('2', 'assistant', '저는 Quoky예요')];
      },
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(memory).build(taskWith({ sessionId: 'S1' }));

    expect(captured).toEqual({ sessionId: 'S1' });
    expect(bundle.conversationTranscript).toEqual([
      {
        turnNumber: 1,
        role: 'user',
        content: '안녕',
        provenance: 'USER',
        epistemicStatus: 'USER_CLAIM_OR_INTENT',
      },
      {
        turnNumber: 1,
        role: 'assistant',
        content: '저는 Quoky예요',
        provenance: 'ASSISTANT',
        epistemicStatus: 'ASSISTANT_NON_AUTHORITATIVE',
      },
    ]);
    expect(bundle.backgroundResources).toEqual([]);
  });

  it('keeps the immediately previous User turn last among older User turns', async () => {
    const memory = {
      recentShortTerm: async () => [
        rec('1', 'user', '오래된 사용자 말'),
        rec('2', 'assistant', '오래된 답변'),
        rec('3', 'user', '바로 전에 한 말'),
        rec('4', 'assistant', '직전 답변'),
        rec('5', 'user', '현재 요청'),
      ],
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(memory).build(taskWith({ sessionId: 'S1' }), ['5']);
    const userTurns = bundle.conversationTranscript.filter((entry) => entry.role === 'user');

    expect(userTurns.map((entry) => entry.content)).toEqual([
      '오래된 사용자 말',
      '바로 전에 한 말',
    ]);
    expect(userTurns.at(-1)).toMatchObject({
      turnNumber: 2,
      content: '바로 전에 한 말',
      provenance: 'USER',
      epistemicStatus: 'USER_CLAIM_OR_INTENT',
    });
  });

  it('keeps a contaminated transcript, excludes current inbound, and separates project background', async () => {
    const memory = {
      recentShortTerm: async () => [
        rec('1', 'user', 'Tell me the current status'),
        rec('2', 'assistant', 'The active project is the current external target'),
        rec('3', 'user', 'Tell me the current status now'),
      ],
      projectMemory: async () =>
        rec('4', 'project', '# Project: project-synthetic\n- synthetic fixture'),
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(memory).build(
      taskWith({ sessionId: 'S1', projectId: 'project-synthetic' }),
      ['3'],
    );

    expect(bundle.conversationTranscript).toEqual([
      {
        turnNumber: 1,
        role: 'user',
        content: 'Tell me the current status',
        provenance: 'USER',
        epistemicStatus: 'USER_CLAIM_OR_INTENT',
      },
      {
        turnNumber: 1,
        role: 'assistant',
        content: 'The active project is the current external target',
        provenance: 'ASSISTANT',
        epistemicStatus: 'ASSISTANT_NON_AUTHORITATIVE',
      },
    ]);
    expect(bundle.backgroundResources).toEqual([
      {
        content: '# Project: project-synthetic\n- synthetic fixture',
        provenance: 'PROJECT_MEMORY',
        epistemicStatus: 'NON_AUTHORITATIVE_BACKGROUND',
      },
    ]);
    expect(bundle).not.toHaveProperty('projectId');
    expect(bundle).not.toHaveProperty('platform');
    expect(bundle).not.toHaveProperty('summary');
  });

  it('represents an active-project-only Session as background without inventing transcript turns', async () => {
    const memory = {
      recentShortTerm: async () => [],
      projectMemory: async () => rec('1', 'project', '# Project: demo'),
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(memory).build(
      taskWith({ sessionId: 'S1', projectId: 'P1' }),
    );

    expect(bundle.conversationTranscript).toEqual([]);
    expect(bundle.backgroundResources[0]).toMatchObject({
      content: '# Project: demo',
      provenance: 'PROJECT_MEMORY',
      epistemicStatus: 'NON_AUTHORITATIVE_BACKGROUND',
    });
  });

  it.each(['discord', 'matrix'])(
    'does not copy current platform or active-project state into ContextBundle for %s',
    async (platform) => {
      const memory = { recentShortTerm: async () => [] } as unknown as MemoryManager;
      const bundle = await new ContextBuilder(memory).build(
        taskWith({ sessionId: 'S1', platform }),
      );

      expect(bundle.backgroundResources).toEqual([]);
      expect(bundle).not.toHaveProperty('platform');
      expect(bundle).not.toHaveProperty('projectId');
    },
  );

  it('fails malformed and unknown legacy roles safe as non-authoritative transcript', async () => {
    const memory = {
      recentShortTerm: async () => [
        rec('1', 'system', 'legacy system-looking text'),
        rec('2', undefined, 'missing role'),
        rec('3', 42, 'invalid role'),
      ],
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(memory).build(taskWith({ sessionId: 'S1' }));

    expect(bundle.conversationTranscript).toEqual([
      {
        turnNumber: 1,
        role: 'unknown',
        content: 'legacy system-looking text',
        provenance: 'LEGACY_UNKNOWN',
        epistemicStatus: 'NON_AUTHORITATIVE_TRANSCRIPT',
      },
      {
        turnNumber: 2,
        role: 'unknown',
        content: 'missing role',
        provenance: 'LEGACY_UNKNOWN',
        epistemicStatus: 'NON_AUTHORITATIVE_TRANSCRIPT',
      },
      {
        turnNumber: 3,
        role: 'unknown',
        content: 'invalid role',
        provenance: 'LEGACY_UNKNOWN',
        epistemicStatus: 'NON_AUTHORITATIVE_TRANSCRIPT',
      },
    ]);
  });

  it('retains the newest N=10 entries oldest-to-newest and 400-character truncation', async () => {
    let requestedLimit: number | undefined;
    const records = Array.from({ length: 12 }, (_, index) =>
      rec(String(index), index % 2 === 0 ? 'user' : 'assistant', `${index}:${'x'.repeat(500)}`),
    );
    const memory = {
      recentShortTerm: async (_scope: MemoryScope, limit: number) => {
        requestedLimit = limit;
        return records;
      },
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(memory).build(taskWith({ sessionId: 'S1' }));

    expect(requestedLimit).toBe(10);
    expect(bundle.conversationTranscript).toHaveLength(10);
    expect(bundle.conversationTranscript[0]?.content).toMatch(/^2:/);
    expect(bundle.conversationTranscript[9]?.content).toMatch(/^11:/);
    expect(bundle.conversationTranscript[0]).toMatchObject({ turnNumber: 1, role: 'user' });
    expect(bundle.conversationTranscript[1]).toMatchObject({ turnNumber: 1, role: 'assistant' });
    expect(bundle.conversationTranscript[9]).toMatchObject({ turnNumber: 5, role: 'assistant' });
    expect(bundle.conversationTranscript.every((entry) => entry.content.length === 401)).toBe(true);
    expect(bundle.conversationTranscript.every((entry) => entry.content.endsWith('…'))).toBe(true);
    expect(
      bundle.conversationTranscript
        .filter((entry) => entry.provenance === 'ASSISTANT')
        .every((entry) => entry.epistemicStatus === 'ASSISTANT_NON_AUTHORITATIVE'),
    ).toBe(true);
    expect(
      bundle.conversationTranscript
        .filter((entry) => entry.provenance === 'USER')
        .every((entry) => entry.epistemicStatus === 'USER_CLAIM_OR_INTENT'),
    ).toBe(true);
  });

  it('orders an unordered retrieval by creation time before applying the N=10 cap', async () => {
    const records = Array.from({ length: 12 }, (_, index) =>
      rec(String(index), 'user', `turn-${index}`),
    );
    const memory = {
      recentShortTerm: async () => [
        records[11]!,
        records[1]!,
        records[8]!,
        records[0]!,
        records[10]!,
        records[3]!,
        records[7]!,
        records[2]!,
        records[9]!,
        records[4]!,
        records[6]!,
        records[5]!,
      ],
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(memory).build(taskWith({ sessionId: 'S1' }));

    expect(bundle.conversationTranscript.map((entry) => entry.content)).toEqual(
      Array.from({ length: 10 }, (_, index) => `turn-${index + 2}`),
    );
  });

  it('requests enough records to preserve N=10 after current-inbound exclusion', async () => {
    let requestedLimit: number | undefined;
    const memory = {
      recentShortTerm: async (_scope: MemoryScope, limit: number) => {
        requestedLimit = limit;
        return [rec('1', 'user', 'previous'), rec('2', 'user', 'current')];
      },
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(memory).build(taskWith({ sessionId: 'S1' }), ['2']);

    expect(requestedLimit).toBe(11);
    expect(bundle.conversationTranscript.map((entry) => entry.content)).toEqual(['previous']);
  });

  it('keeps the immediately previous User turn when excluding an explicit recall request', async () => {
    const memory = {
      recentShortTerm: async () => [
        rec('1', 'user', '안녕?'),
        rec('2', 'assistant', '안녕하세요!'),
        rec('3', 'user', '내가 방금 뭐라고 했지?'),
      ],
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(memory).build(taskWith({ sessionId: 'S1' }), ['3']);

    expect(bundle.conversationTranscript).toEqual([
      {
        turnNumber: 1,
        role: 'user',
        content: '안녕?',
        provenance: 'USER',
        epistemicStatus: 'USER_CLAIM_OR_INTENT',
      },
      {
        turnNumber: 1,
        role: 'assistant',
        content: '안녕하세요!',
        provenance: 'ASSISTANT',
        epistemicStatus: 'ASSISTANT_NON_AUTHORITATIVE',
      },
    ]);
    expect(bundle.conversationTranscript.at(-2)?.content).toBe('안녕?');
    expect(
      bundle.conversationTranscript.some((entry) => entry.content === '내가 방금 뭐라고 했지?'),
    ).toBe(false);
  });

  it('falls back to channel scope when the task has no session', async () => {
    let captured: MemoryScope | undefined;
    const memory = {
      recentShortTerm: async (scope: MemoryScope) => {
        captured = scope;
        return [];
      },
    } as unknown as MemoryManager;

    await new ContextBuilder(memory).build(taskWith());

    expect(captured).toEqual({ channelId: 'c' });
  });
});
