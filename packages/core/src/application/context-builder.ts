import type { ContextBundle, Id, MemoryScope, Task } from '../domain';
import type { MemoryManager } from './memory-manager';

/** Default number of recent turns to include (ADR-0017). */
const RECENT_LIMIT = 10;
/** Long memories are simply truncated (no summarization in v1). */
const MAX_MEMORY_CHARS = 400;
/** Project memory is longer-form; truncated a bit more generously. */
const MAX_PROJECT_CHARS = 1200;

/**
 * Assembles the context for one execution (ADR-0002 / 0017 / 0018):
 *   - recent SHORT_TERM turns for the SAME session (excluding the current
 *     inbound message, which already appears in the task layer), simply truncated;
 *   - the active project's PROJECT memory summary, if a project is registered.
 * No vector search, no summarization, no long-term recall.
 */
export class ContextBuilder {
  constructor(private readonly memory: MemoryManager) {}

  async build(task: Task, excludeMemoryIds: Id[] = []): Promise<ContextBundle> {
    const scope: MemoryScope = task.sessionId
      ? { sessionId: task.sessionId }
      : {
          channelId: task.context.channelId,
          ...(task.context.threadId ? { threadId: task.context.threadId } : {}),
        };

    const fetched = await this.memory.recentShortTerm(scope, RECENT_LIMIT + excludeMemoryIds.length);
    const recent = fetched.filter((r) => !excludeMemoryIds.includes(r.id)).slice(-RECENT_LIMIT);

    const bundle: ContextBundle = {
      taskId: task.id,
      summary: task.intent.summary,
      recentMessages: recent.map((r) => {
        const role = typeof r.metadata?.role === 'string' ? r.metadata.role : 'user';
        return `${role}: ${ContextBuilder.truncate(r.content, MAX_MEMORY_CHARS)}`;
      }),
    };

    if (task.projectId) {
      const project = await this.memory.projectMemory(task.projectId);
      if (project) bundle.projectSummary = ContextBuilder.truncate(project.content, MAX_PROJECT_CHARS);
    }

    return bundle;
  }

  private static truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }
}
