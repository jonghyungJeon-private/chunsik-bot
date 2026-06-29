import { describe, expect, it } from 'vitest';
import { ContextBuilder } from './context-builder';
import { Capability, IntentType, MemoryType, RiskLevel, TaskStatus } from '../domain';
import type { MemoryRecord, MemoryScope, Task } from '../domain';
import type { MemoryManager } from './memory-manager';

const taskWith = (opts: { sessionId?: string; projectId?: string } = {}): Task => ({
  id: 't1',
  title: 't',
  description: 'hello',
  status: TaskStatus.PENDING,
  intent: { type: IntentType.CHAT, capability: Capability.GENERAL_CHAT, confidence: 1, requiresWork: true, summary: 'hello' },
  riskLevel: RiskLevel.LOW,
  context: { platform: 'discord', channelId: 'c', userId: 'u' },
  ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
  ...(opts.projectId ? { projectId: opts.projectId } : {}),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const rec = (id: string, role: string, content: string): MemoryRecord => ({
  id,
  type: MemoryType.SHORT_TERM,
  scope: {},
  content,
  metadata: { role },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('ContextBuilder (session + project memory)', () => {
  it('queries by session scope and formats recent turns with role', async () => {
    let captured: MemoryScope | undefined;
    const memory = {
      recentShortTerm: async (scope: MemoryScope) => {
        captured = scope;
        return [rec('a', 'user', '안녕'), rec('b', 'assistant', '저는 춘식이')];
      },
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(memory).build(taskWith({ sessionId: 'S1' }));
    expect(captured).toEqual({ sessionId: 'S1' });
    expect(bundle.recentMessages).toEqual(['user: 안녕', 'assistant: 저는 춘식이']);
    expect(bundle.projectSummary).toBeUndefined();
  });

  it('excludes the current inbound message id from recent context', async () => {
    const memory = {
      recentShortTerm: async () => [rec('a', 'user', 'prev'), rec('cur', 'user', '지금 메시지')],
    } as unknown as MemoryManager;
    const bundle = await new ContextBuilder(memory).build(taskWith({ sessionId: 'S1' }), ['cur']);
    expect(bundle.recentMessages).toEqual(['user: prev']);
  });

  it('includes active project memory when the task has a projectId', async () => {
    const memory = {
      recentShortTerm: async () => [],
      projectMemory: async (projectId: string) =>
        projectId === 'P1' ? rec('p', 'project', '# Project: demo\n- path: /x') : undefined,
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(memory).build(taskWith({ sessionId: 'S1', projectId: 'P1' }));
    expect(bundle.projectSummary).toContain('# Project: demo');
  });

  it('truncates long memory content', async () => {
    const long = 'x'.repeat(1000);
    const memory = { recentShortTerm: async () => [rec('a', 'assistant', long)] } as unknown as MemoryManager;
    const bundle = await new ContextBuilder(memory).build(taskWith({ sessionId: 'S1' }));
    expect(bundle.recentMessages[0]!.length).toBeLessThan(long.length);
    expect(bundle.recentMessages[0]).toMatch(/^assistant: x+…$/);
  });

  it('falls back to channel scope when the task has no session', async () => {
    let captured: MemoryScope | undefined;
    const memory = {
      recentShortTerm: async (scope: MemoryScope) => {
        captured = scope;
        return [];
      },
    } as unknown as MemoryManager;
    await new ContextBuilder(memory).build(taskWith({}));
    expect(captured).toEqual({ channelId: 'c' });
  });
});
