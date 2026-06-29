import type { ContextBundle, MemoryScope, Task } from '../domain';
import type { MemoryManager } from './memory-manager';

/** Default number of recent turns to include (ADR-0017). */
const RECENT_LIMIT = 10;
/** Long memories are simply truncated (no summarization in v1). */
const MAX_MEMORY_CHARS = 400;

/**
 * Assembles the context for one execution (ADR-0002 / ADR-0017). v1 includes the
 * most recent SHORT_TERM turns for the SAME session (user + assistant), each
 * simply truncated. No vector search, no summarization, no long-term recall.
 */
export class ContextBuilder {
  constructor(private readonly memory: MemoryManager) {}

  async build(task: Task): Promise<ContextBundle> {
    // Prefer session scope; fall back to channel/thread if a task has no session.
    const scope: MemoryScope = task.sessionId
      ? { sessionId: task.sessionId }
      : {
          channelId: task.context.channelId,
          ...(task.context.threadId ? { threadId: task.context.threadId } : {}),
        };

    const recent = await this.memory.recentShortTerm(scope, RECENT_LIMIT);
    return {
      taskId: task.id,
      summary: task.intent.summary,
      recentMessages: recent.map((r) => {
        const role = typeof r.metadata?.role === 'string' ? r.metadata.role : 'user';
        const text =
          r.content.length > MAX_MEMORY_CHARS ? `${r.content.slice(0, MAX_MEMORY_CHARS)}…` : r.content;
        return `${role}: ${text}`;
      }),
    };
  }
}
