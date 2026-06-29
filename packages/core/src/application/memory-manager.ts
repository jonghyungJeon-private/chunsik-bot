import { newId } from '../util/id';
import { now } from '../util/clock';
import { MemoryType } from '../domain';
import type {
  ContextFile,
  InboundMessage,
  MemoryRecord,
  MemoryScope,
  Task,
} from '../domain';
import type { StorageProvider, VectorProvider } from '../ports';

/**
 * Owns Chunsik Memory — the source of truth. The AI CLIs are stateless; the
 * ONLY way memory reaches them is the context files this manager materializes.
 *
 * v1: storage + a deterministic renderer are implemented (plumbing). Semantic
 * retrieval ranking via the VectorProvider is left as a TODO so we don't bake
 * in a recall strategy prematurely.
 */
export class MemoryManager {
  constructor(
    private readonly storage: StorageProvider,
    private readonly vector: VectorProvider,
  ) {}

  /** Persist the latest user message as short-term thread memory. */
  async recordShortTerm(message: InboundMessage): Promise<MemoryRecord> {
    const ts = now();
    const record: MemoryRecord = {
      id: newId(),
      type: MemoryType.SHORT_TERM,
      scope: {
        userId: message.context.userId,
        channelId: message.context.channelId,
        ...(message.context.threadId ? { threadId: message.context.threadId } : {}),
      },
      content: message.text,
      createdAt: ts,
      updatedAt: ts,
    };
    return this.storage.memories.save(record);
  }

  /** Most recent short-term memories for a scope, oldest → newest. */
  async recentShortTerm(scope: MemoryScope, limit = 10): Promise<MemoryRecord[]> {
    const records = await this.storage.memories.findByScope(scope, MemoryType.SHORT_TERM);
    return records
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-limit);
  }

  /**
   * Build the context files injected into a CLI run for a task. Renders the
   * relevant memory into the file layout the spec calls for:
   *   - .chunsik/context.md  (project + long-term + connector memory)
   *   - .chunsik/task.md      (working memory: the current task & plan state)
   * CLAUDE.md / AGENTS.md are added by provider-specific shaping later.
   */
  async buildContextFiles(task: Task): Promise<ContextFile[]> {
    const scope: MemoryScope = {
      userId: task.context.userId,
      channelId: task.context.channelId,
      ...(task.context.threadId ? { threadId: task.context.threadId } : {}),
      taskId: task.id,
      ...(task.projectId ? { projectId: task.projectId } : {}),
    };
    const records = await this.storage.memories.findByScope(scope);
    return [
      { path: '.chunsik/context.md', content: this.renderContext(records) },
      { path: '.chunsik/task.md', content: this.renderTask(task) },
    ];
  }

  private renderContext(records: MemoryRecord[]): string {
    const byType = (t: MemoryType) =>
      records
        .filter((r) => r.type === t)
        .map((r) => `- ${r.content}`)
        .join('\n');
    return [
      '# Chunsik Context',
      '',
      '## Project memory',
      byType(MemoryType.PROJECT) || '_none_',
      '',
      '## Long-term memory',
      byType(MemoryType.LONG_TERM) || '_none_',
      '',
      '## Recent conversation',
      byType(MemoryType.SHORT_TERM) || '_none_',
      '',
    ].join('\n');
  }

  private renderTask(task: Task): string {
    return [
      '# Current Task',
      '',
      `- **Title:** ${task.title}`,
      `- **Status:** ${task.status}`,
      `- **Risk:** ${task.riskLevel}`,
      `- **Intent:** ${task.intent.summary}`,
      '',
    ].join('\n');
  }
}
