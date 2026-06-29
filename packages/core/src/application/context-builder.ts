import type { ContextBundle, MemoryScope, Task } from '../domain';
import type { MemoryManager } from './memory-manager';

/**
 * Assembles the context for one execution (ADR-0002). v1 (Sprint 1b-1) is
 * TRIVIAL: the task summary plus recent short-term conversation for the
 * channel. Ranking / compression / token budgeting / resource inclusion are
 * deferred behind this same seam.
 */
export class ContextBuilder {
  constructor(private readonly memory: MemoryManager) {}

  async build(task: Task): Promise<ContextBundle> {
    const scope: MemoryScope = {
      channelId: task.context.channelId,
      ...(task.context.threadId ? { threadId: task.context.threadId } : {}),
    };
    const recent = await this.memory.recentShortTerm(scope, 10);
    return {
      taskId: task.id,
      summary: task.intent.summary,
      recentMessages: recent.map((r) => r.content),
    };
  }
}
