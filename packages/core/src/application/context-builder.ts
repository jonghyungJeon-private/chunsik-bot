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

type ConversationRole = NonNullable<ConversationTranscriptEntry['role']>;

/** Optional M2 ranking/selection policy. Omitting it preserves ADR-0017 flat retrieval. */
export interface ContextRankingConfig {
  /** Maximum combined content characters across transcript and project background. */
  maxCharacters: number;
  /** Additive role relevance; higher values are selected first. */
  roleWeights?: Partial<Record<ConversationRole, number>>;
  /** Additive score per recency position (oldest = 0). Defaults to 1. */
  recencyWeight?: number;
}

interface RankedTranscriptEntry {
  entry: ConversationTranscriptEntry;
  chronologicalIndex: number;
  score: number;
}

/**
 * Assembles the context for one execution (ADR-0002 / 0017 / 0018):
 *   - recent SHORT_TERM turns for the SAME session (excluding the current
 *     inbound message, which already appears in the task layer), simply truncated;
 *   - the active project's PROJECT memory summary, if a project is registered.
 * No vector search, no summarization, no long-term recall.
 */
export class ContextBuilder {
  constructor(
    private readonly memory: MemoryManager,
    private readonly ranking?: ContextRankingConfig,
  ) {}

  async build(task: Task, excludeMemoryIds: Id[] = []): Promise<ContextBundle> {
    const scope: MemoryScope = task.sessionId
      ? { sessionId: task.sessionId }
      : {
          channelId: task.context.channelId,
          ...(task.context.threadId ? { threadId: task.context.threadId } : {}),
        };

    const fetched = await this.memory.recentShortTerm(scope, RECENT_LIMIT + excludeMemoryIds.length);
    const recent = fetched
      .filter((r) => !excludeMemoryIds.includes(r.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-RECENT_LIMIT);

    const transcript = ContextBuilder.toTranscriptEntries(recent);
    const project = task.projectId ? await this.memory.projectMemory(task.projectId) : undefined;

    if (!this.ranking) {
      return ContextBuilder.bundle(task.id, transcript, project);
    }

    const maxCharacters = ContextBuilder.nonNegativeInteger(
      this.ranking.maxCharacters,
      'maxCharacters',
    );
    let remainingCharacters = maxCharacters;
    const backgroundResources: ContextBundle['backgroundResources'] = [];

    // projectMemory(projectId) is an exact active-project lookup. Reserve its matching
    // background first, before any future lower-relevance project candidates.
    if (project && remainingCharacters > 0) {
      const content = ContextBuilder.truncateToBudget(
        ContextBuilder.truncate(project.content, MAX_PROJECT_CHARS),
        remainingCharacters,
      );
      if (content.length > 0) {
        backgroundResources.push(ContextBuilder.toProjectBackground(content));
        remainingCharacters -= content.length;
      }
    }

    const conversationTranscript = ContextBuilder.selectRankedTranscript(
      transcript,
      remainingCharacters,
      this.ranking,
    );

    return {
      taskId: task.id,
      conversationTranscript,
      backgroundResources,
    };
  }

  private static bundle(
    taskId: Id,
    transcript: ConversationTranscriptEntry[],
    project: MemoryRecord | undefined,
  ): ContextBundle {
    return {
      taskId,
      conversationTranscript: transcript,
      backgroundResources: project
        ? [ContextBuilder.toProjectBackground(ContextBuilder.truncate(project.content, MAX_PROJECT_CHARS))]
        : [],
    };
  }

  private static toProjectBackground(
    content: string,
  ): ContextBundle['backgroundResources'][number] {
    return {
      content,
      provenance: 'PROJECT_MEMORY',
      epistemicStatus: 'NON_AUTHORITATIVE_BACKGROUND',
    };
  }

  private static selectRankedTranscript(
    transcript: ConversationTranscriptEntry[],
    budget: number,
    config: ContextRankingConfig,
  ): ConversationTranscriptEntry[] {
    const roleWeights: Record<ConversationRole, number> = {
      user: config.roleWeights?.user ?? 2,
      assistant: config.roleWeights?.assistant ?? 1,
      unknown: config.roleWeights?.unknown ?? 0,
    };
    const recencyWeight = config.recencyWeight ?? 1;
    if (!Number.isFinite(recencyWeight) || recencyWeight < 0) {
      throw new RangeError('recencyWeight must be a finite non-negative number');
    }
    for (const [role, weight] of Object.entries(roleWeights)) {
      if (!Number.isFinite(weight)) {
        throw new RangeError(`roleWeights.${role} must be finite`);
      }
    }

    const ranked: RankedTranscriptEntry[] = transcript
      .map((entry, chronologicalIndex) => ({
        entry,
        chronologicalIndex,
        score: roleWeights[entry.role ?? 'unknown'] + chronologicalIndex * recencyWeight,
      }))
      .sort((a, b) => b.score - a.score || b.chronologicalIndex - a.chronologicalIndex);

    let remaining = budget;
    const selected: RankedTranscriptEntry[] = [];
    for (const candidate of ranked) {
      if (remaining <= 0) break;
      if (candidate.entry.content.length <= remaining) {
        selected.push(candidate);
        remaining -= candidate.entry.content.length;
        continue;
      }
      const content = ContextBuilder.truncateToBudget(candidate.entry.content, remaining);
      if (content.length > 0) {
        selected.push({ ...candidate, entry: { ...candidate.entry, content } });
        remaining -= content.length;
      }
    }

    // PromptComposer's transcript contract remains chronological. Ranking determines
    // relevance-aware selection only; original turn/provenance fields stay untouched.
    return selected
      .sort((a, b) => a.chronologicalIndex - b.chronologicalIndex)
      .map(({ entry }) => entry);
  }

  private static nonNegativeInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer`);
    }
    return value;
  }

  private static toTranscriptEntries(records: MemoryRecord[]): ConversationTranscriptEntry[] {
    let currentTurnNumber = 0;

    return records.map((record) => {
      const role = ContextBuilder.roleOf(record);
      if (role === 'user' || role === 'unknown' || currentTurnNumber === 0) {
        currentTurnNumber += 1;
      }
      return ContextBuilder.toTranscriptEntry(record, currentTurnNumber, role);
    });
  }

  private static roleOf(
    record: MemoryRecord,
  ): NonNullable<ConversationTranscriptEntry['role']> {
    if (record.metadata?.role === 'user') return 'user';
    if (record.metadata?.role === 'assistant') return 'assistant';
    return 'unknown';
  }

  private static toTranscriptEntry(
    record: MemoryRecord,
    turnNumber: number,
    role: NonNullable<ConversationTranscriptEntry['role']>,
  ): ConversationTranscriptEntry {
    const content = ContextBuilder.truncate(record.content, MAX_MEMORY_CHARS);
    if (role === 'user') {
      return {
        turnNumber,
        role,
        content,
        provenance: 'USER',
        epistemicStatus: 'USER_CLAIM_OR_INTENT',
      };
    }
    if (role === 'assistant') {
      return {
        turnNumber,
        role,
        content,
        provenance: 'ASSISTANT',
        epistemicStatus: 'ASSISTANT_NON_AUTHORITATIVE',
      };
    }
    return {
      turnNumber,
      role,
      content,
      provenance: 'LEGACY_UNKNOWN',
      epistemicStatus: 'NON_AUTHORITATIVE_TRANSCRIPT',
    };
  }

  private static truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  private static truncateToBudget(text: string, max: number): string {
    if (text.length <= max) return text;
    if (max <= 0) return '';
    if (max === 1) return '…';
    return `${text.slice(0, max - 1)}…`;
  }
}
