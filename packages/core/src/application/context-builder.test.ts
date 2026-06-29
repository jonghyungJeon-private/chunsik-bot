import { describe, expect, it } from 'vitest';
import { ContextBuilder } from './context-builder';
import { Capability, IntentType, MemoryType, RiskLevel, TaskStatus } from '../domain';
import type { MemoryRecord, Task } from '../domain';
import type { MemoryManager } from './memory-manager';

const task: Task = {
  id: 't1',
  title: 't',
  description: 'hello',
  status: TaskStatus.PENDING,
  intent: { type: IntentType.CHAT, capability: Capability.GENERAL_CHAT, confidence: 1, requiresWork: true, summary: 'hello' },
  riskLevel: RiskLevel.LOW,
  context: { platform: 'discord', channelId: 'c', userId: 'u' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const record = (content: string): MemoryRecord => ({
  id: `m-${content}`,
  type: MemoryType.SHORT_TERM,
  scope: { channelId: 'c' },
  content,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('ContextBuilder (trivial)', () => {
  it('builds a bundle from recent short-term memory', async () => {
    const fakeMemory = {
      recentShortTerm: async () => [record('earlier')],
    } as unknown as MemoryManager;

    const bundle = await new ContextBuilder(fakeMemory).build(task);
    expect(bundle.taskId).toBe('t1');
    expect(bundle.summary).toBe('hello');
    expect(bundle.recentMessages).toEqual(['earlier']);
  });
});
