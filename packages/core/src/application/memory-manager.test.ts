import { describe, expect, it } from 'vitest';
import { MemoryManager } from './memory-manager';
import { MemoryType } from '../domain';
import type { MemoryRecord, MemoryScope } from '../domain';
import type { StorageProvider, VectorProvider } from '../ports';

function fakeStorage() {
  const mem: MemoryRecord[] = [];
  const memories = {
    async save(r: MemoryRecord) {
      mem.push(r);
      return r;
    },
    async findByScope(scope: MemoryScope, type?: MemoryType) {
      return mem.filter(
        (r) =>
          (type === undefined || r.type === type) &&
          (scope.sessionId === undefined || r.scope.sessionId === scope.sessionId) &&
          (scope.channelId === undefined || r.scope.channelId === scope.channelId),
      );
    },
    async get() {
      return null;
    },
    async delete() {},
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
    expect(mem[0]).toMatchObject({
      type: MemoryType.SHORT_TERM,
      content: '안녕',
      scope: { sessionId: 'S1' },
      metadata: { role: 'user' },
    });
    expect(mem[1]).toMatchObject({ content: '저는 춘식이', metadata: { role: 'assistant' } });
  });

  it('recentShortTerm returns same-session turns oldest→newest and isolates other sessions', async () => {
    const { storage } = fakeStorage();
    const mm = new MemoryManager(storage, {} as VectorProvider);

    await mm.recordShortTerm(msg('a', 'first'), 'S1');
    await mm.recordAssistant('reply', ctx, 'S1');
    await mm.recordShortTerm(msg('b', 'other'), 'S2');

    expect((await mm.recentShortTerm({ sessionId: 'S1' }, 10)).map((r) => r.content)).toEqual([
      'first',
      'reply',
    ]);
    expect((await mm.recentShortTerm({ sessionId: 'S2' }, 10)).map((r) => r.content)).toEqual(['other']);
  });

  it('never stores a provider id in memory', async () => {
    const { storage, mem } = fakeStorage();
    const mm = new MemoryManager(storage, {} as VectorProvider);
    await mm.recordAssistant('x', ctx, 'S1');
    expect(JSON.stringify(mem[0])).not.toContain('providerId');
  });
});
