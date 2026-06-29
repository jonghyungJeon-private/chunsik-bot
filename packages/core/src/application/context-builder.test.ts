import { describe, expect, it } from 'vitest';
import { ContextBuilder } from './context-builder';
import { Capability, IntentType, MemoryType, RiskLevel, TaskStatus } from '../domain';
import type { MemoryRecord, MemoryScope, Task } from '../domain';
import type { MemoryManager } from './memory-manager';

const taskWith = (sessionId?: string): Task => ({
  id: 't1',
  title: 't',
  description: 'hello',
  status: TaskStatus.PENDING,
  intent: { type: IntentType.CHAT, capability: Capability.GENERAL_CHAT, confidence: 1, requiresWork: true, summary: 'hello' },
  riskLevel: RiskLevel.LOW,
  context: { platform: 'discord', channelId: 'c', userId: 'u' },
  ...(sessionId ? { sessionId } : {}),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const rec = (role: string, content: string): MemoryRecord => ({
  id: `m-${content.slice(0, 8)}`,
  type: MemoryType.SHORT_TERM,
  scope: {},
  content,
  metadata: { role },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('ContextBuilder (session memory)', () => {
  it('queries by session scope and formats recent turns with role', async () => {
    let captured: MemoryScope | undefined;
    const memory = {
      recentShortTerm: async (scope: MemoryScope) => {
        captured = scope;
        return [rec('user', '안녕'), rec('assistant', '저는 춘식이')];
      },
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(memory).build(taskWith('S1'));
    expect(captured).toEqual({ sessionId: 'S1' });
    expect(bundle.recentMessages).toEqual(['user: 안녕', 'assistant: 저는 춘식이']);
  });

  it('truncates long memory content', async () => {
    const long = 'x'.repeat(1000);
    const memory = {
      recentShortTerm: async () => [rec('assistant', long)],
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(memory).build(taskWith('S1'));
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

    await new ContextBuilder(memory).build(taskWith(undefined));
    expect(captured).toEqual({ channelId: 'c' });
  });
});
