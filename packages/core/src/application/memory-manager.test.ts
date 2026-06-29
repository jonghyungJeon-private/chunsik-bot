import { describe, expect, it } from 'vitest';
import { MAX_SESSION_SHORT_TERM, MemoryManager } from './memory-manager';
import { MemoryType } from '../domain';
import type { MemoryRecord, MemoryScope } from '../domain';
import type { StorageProvider, VectorProvider } from '../ports';

function fakeStorage() {
  const mem: MemoryRecord[] = [];
  const memories = {
    async save(r: MemoryRecord) {
      const i = mem.findIndex((m) => m.id === r.id);
      if (i >= 0) mem[i] = r;
      else mem.push(r);
      return r;
    },
    async findByScope(scope: MemoryScope, type?: MemoryType) {
      return mem.filter(
        (r) =>
          (type === undefined || r.type === type) &&
          (scope.sessionId === undefined || r.scope.sessionId === scope.sessionId) &&
          (scope.projectId === undefined || r.scope.projectId === scope.projectId) &&
          (scope.channelId === undefined || r.scope.channelId === scope.channelId),
      );
    },
    async get() {
      return null;
    },
    async delete(id: string) {
      const i = mem.findIndex((m) => m.id === id);
      if (i >= 0) mem.splice(i, 1);
    },
    async list() {
      return mem;
    },
  };
  return { storage: { memories } as unknown as StorageProvider, mem };
}

const ctx = { platform: 'discord', channelId: 'c', userId: 'u' };
const msg = (id: string, text: string) => ({ id, context: ctx, text, receivedAt: '' });

describe('MemoryManager short-term memory (ADR-0017)', () => {
  it('records user + assistant turns scoped by session, with role metadata', async () => {
    const { storage, mem } = fakeStorage();
    const mm = new MemoryManager(storage, {} as VectorProvider);
    await mm.recordShortTerm(msg('m1', '안녕'), 'S1');
    await mm.recordAssistant('저는 춘식이', ctx, 'S1');
    expect(mem).toHaveLength(2);
    expect(mem[0]).toMatchObject({ content: '안녕', scope: { sessionId: 'S1' }, metadata: { role: 'user' } });
    expect(mem[1]).toMatchObject({ content: '저는 춘식이', metadata: { role: 'assistant' } });
  });

  it('recentShortTerm isolates sessions and orders oldest→newest', async () => {
    const { storage } = fakeStorage();
    const mm = new MemoryManager(storage, {} as VectorProvider);
    await mm.recordShortTerm(msg('a', 'first'), 'S1');
    await mm.recordAssistant('reply', ctx, 'S1');
    await mm.recordShortTerm(msg('b', 'other'), 'S2');
    expect((await mm.recentShortTerm({ sessionId: 'S1' }, 10)).map((r) => r.content)).toEqual(['first', 'reply']);
    expect((await mm.recentShortTerm({ sessionId: 'S2' }, 10)).map((r) => r.content)).toEqual(['other']);
  });

  it(`prunes a session to the newest ${MAX_SESSION_SHORT_TERM} SHORT_TERM memories`, async () => {
    const { storage, mem } = fakeStorage();
    const mm = new MemoryManager(storage, {} as VectorProvider);
    for (let i = 0; i < MAX_SESSION_SHORT_TERM + 5; i += 1) {
      await mm.recordShortTerm(msg(`m${i}`, `msg-${i}`), 'S1');
    }
    expect(mem).toHaveLength(MAX_SESSION_SHORT_TERM);
    // Oldest 5 pruned; newest retained.
    expect(mem.some((r) => r.content === 'msg-0')).toBe(false);
    expect(mem.some((r) => r.content === `msg-${MAX_SESSION_SHORT_TERM + 4}`)).toBe(true);
  });

  it('never stores a provider id in memory', async () => {
    const { storage, mem } = fakeStorage();
    const mm = new MemoryManager(storage, {} as VectorProvider);
    await mm.recordAssistant('x', ctx, 'S1');
    expect(JSON.stringify(mem[0])).not.toContain('providerId');
  });
});

describe('MemoryManager project memory (ADR-0018)', () => {
  it('records and reads back PROJECT memory scoped by projectId', async () => {
    const { storage, mem } = fakeStorage();
    const mm = new MemoryManager(storage, {} as VectorProvider);
    await mm.recordProjectMemory('# Project: demo', { projectId: 'P1', sessionId: 'S1' });
    expect(mem[0]).toMatchObject({ type: MemoryType.PROJECT, scope: { projectId: 'P1', sessionId: 'S1' } });
    const latest = await mm.projectMemory('P1');
    expect(latest?.content).toBe('# Project: demo');
    expect(await mm.projectMemory('P2')).toBeUndefined();
  });
});
