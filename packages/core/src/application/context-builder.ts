import type {
  ContextBundle,
  ConversationTranscriptEntry,
  Id,
  MemoryRecord,
  MemoryScope,
  Task,
} from '../domain';
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
      conversationTranscript: recent.map((record) => ContextBuilder.toTranscriptEntry(record)),
      backgroundResources: [],
    };

    if (task.projectId) {
      const project = await this.memory.projectMemory(task.projectId);
      if (project) {
        bundle.backgroundResources.push({
          content: ContextBuilder.truncate(project.content, MAX_PROJECT_CHARS),
          provenance: 'PROJECT_MEMORY',
          epistemicStatus: 'NON_AUTHORITATIVE_BACKGROUND',
        });
      }
    }

    return bundle;
  }

  private static toTranscriptEntry(record: MemoryRecord): ConversationTranscriptEntry {
    const content = ContextBuilder.truncate(record.content, MAX_MEMORY_CHARS);
    if (record.metadata?.role === 'user') {
      return {
        content,
        provenance: 'USER',
        epistemicStatus: 'USER_CLAIM_OR_INTENT',
      };
    }
    if (record.metadata?.role === 'assistant') {
      return {
        content,
        provenance: 'ASSISTANT',
        epistemicStatus: 'ASSISTANT_NON_AUTHORITATIVE',
      };
    }
    return {
      content,
      provenance: 'LEGACY_UNKNOWN',
      epistemicStatus: 'NON_AUTHORITATIVE_TRANSCRIPT',
    };
  }

  private static truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }
}
