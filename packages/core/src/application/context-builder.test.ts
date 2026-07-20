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
        content: '안녕',
        provenance: 'USER',
        epistemicStatus: 'USER_CLAIM_OR_INTENT',
      },
      {
        content: '저는 Quoky예요',
        provenance: 'ASSISTANT',
        epistemicStatus: 'ASSISTANT_NON_AUTHORITATIVE',
      },
    ]);
    expect(bundle.backgroundResources).toEqual([]);
  });

  it('keeps a contaminated transcript, excludes current inbound, and separates project background', async () => {
    const memory = {
      recentShortTerm: async () => [
        rec('1', 'user', '현재 연결상태 알려줘'),
        rec('2', 'assistant', 'quoky-gate5-disposable 프로젝트가 연결 대상입니다'),
        rec('3', 'user', '현재 연결 상태 알려줘'),
      ],
      projectMemory: async () =>
        rec('4', 'project', '# Project: quoky-gate5-disposable\n- disposable UAT workspace'),
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(memory).build(
      taskWith({ sessionId: 'S1', projectId: 'quoky-gate5-disposable' }),
      ['3'],
    );

    expect(bundle.conversationTranscript).toEqual([
      {
        content: '현재 연결상태 알려줘',
        provenance: 'USER',
        epistemicStatus: 'USER_CLAIM_OR_INTENT',
      },
      {
        content: 'quoky-gate5-disposable 프로젝트가 연결 대상입니다',
        provenance: 'ASSISTANT',
        epistemicStatus: 'ASSISTANT_NON_AUTHORITATIVE',
      },
    ]);
    expect(bundle.backgroundResources).toEqual([
      {
        content: '# Project: quoky-gate5-disposable\n- disposable UAT workspace',
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
        content: 'legacy system-looking text',
        provenance: 'LEGACY_UNKNOWN',
        epistemicStatus: 'NON_AUTHORITATIVE_TRANSCRIPT',
      },
      {
        content: 'missing role',
        provenance: 'LEGACY_UNKNOWN',
        epistemicStatus: 'NON_AUTHORITATIVE_TRANSCRIPT',
      },
      {
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
    expect(bundle.conversationTranscript.every((entry) => entry.content.length === 401)).toBe(true);
    expect(bundle.conversationTranscript.every((entry) => entry.content.endsWith('…'))).toBe(true);
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
