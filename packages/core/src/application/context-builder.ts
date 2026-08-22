import type {
  ContextBundle,
  ConversationTranscriptEntry,
  Id,
  MemoryRecord,
  MemoryScope,
  Task,
} from '../domain';
import { ESTIMATED_CHARACTERS_PER_TOKEN, estimateTokenCount } from '../util/token-estimator';
import type { MemoryManager } from './memory-manager';
import { scoreSemanticRelevance } from './semantic-relevance';

/** Default number of recent turns to include (ADR-0017). */
const RECENT_LIMIT = 10;
/** Ranking considers a wider bounded window, then still emits at most RECENT_LIMIT entries. */
const RANKING_CANDIDATE_LIMIT = RECENT_LIMIT * 2;
/** Bounded nudge for explicit User-provided identifiers within the normalized blend. */
const EXPLICIT_USER_VALUE_WEIGHT = 0.5;
/** Long memories are simply truncated (no summarization in v1). */
const MAX_MEMORY_CHARS = 400;
/** Project memory is longer-form; truncated a bit more generously. */
const MAX_PROJECT_CHARS = 1200;
/** Compression keeps enough text for an entry to remain useful and attributable. */
const DEFAULT_MINIMUM_COMPRESSION_CHARACTERS = 80;

type ConversationRole = NonNullable<ConversationTranscriptEntry['role']>;

export interface ContextCompressionConfig {
  /** Minimum content length retained per entry. Defaults to 80 characters. */
  minimumCharactersPerEntry?: number;
}

/** Optional M2 ranking/selection policy. Omitting it preserves ADR-0017 flat retrieval. */
export interface ContextRankingConfig {
  /** Maximum combined content characters across transcript and project background. */
  maxCharacters?: number;
  /** Approximate token budget across transcript and project background. */
  maxTokens?: number;
  /** Additive role relevance; higher values are selected first. */
  roleWeights?: Partial<Record<ConversationRole, number>>;
  /** Additive score per recency position (oldest = 0). Defaults to 1. */
  recencyWeight?: number;
  /**
   * Enables a normalized recency/relevance blend against Task.intent.summary.
   * When supplied, it and recencyWeight must be in [0, 1] and sum to 1.
   */
  relevanceWeight?: number;
  /** Optional deterministic tail compression for a configured maxTokens budget. */
  compressionConfig?: ContextCompressionConfig;
}

/**
 * Runtime-facing ContextBuilder configuration. The explicit feature switches let a
 * composition root select the M2 pipeline without making an empty configuration
 * change ADR-0017's flat, most-recent-ten behavior.
 */
export interface ContextBuilderConfig extends ContextRankingConfig {
  /** Enables budgeted ranking and relevance selection. Defaults to inferred legacy opt-in. */
  rankingEnabled?: boolean;
  /** Enables deterministic tail compression. Defaults to inferred legacy opt-in. */
  compressionEnabled?: boolean;
}

interface RankedTranscriptEntry {
  entry: ConversationTranscriptEntry;
  chronologicalIndex: number;
  score: number;
  continuityPriority: number;
}

const EXPLICIT_VALUE_PATTERN = /(?:[\p{L}\p{N}]+[-_]\d+|\d{2,})/u;

interface ContextBudget {
  limit: number;
  measure: (content: string) => number;
  truncate: (content: string, remaining: number) => string;
}

/**
 * Assembles the context for one execution (ADR-0002 / 0017 / 0018):
 *   - recent SHORT_TERM turns for the SAME session (excluding the current
 *     inbound message, which already appears in the task layer), simply truncated;
 *   - the active project's PROJECT memory summary, if a project is registered.
 * No vector search, no summarization, no long-term recall.
 */
export class ContextBuilder {
  private readonly ranking: ContextRankingConfig | undefined;

  constructor(
    private readonly memory: MemoryManager,
    config: ContextBuilderConfig = {},
  ) {
    this.ranking = ContextBuilder.validateConfig(config);
  }

  async build(task: Task, excludeMemoryIds: Id[] = []): Promise<ContextBundle> {
    const scope: MemoryScope = task.sessionId
      ? { sessionId: task.sessionId }
      : {
          channelId: task.context.channelId,
          ...(task.context.threadId ? { threadId: task.context.threadId } : {}),
        };

    const budget = this.ranking ? ContextBuilder.resolveBudget(this.ranking) : undefined;
    const retrievalLimit =
      budget && this.ranking?.relevanceWeight !== undefined
        ? RANKING_CANDIDATE_LIMIT
        : RECENT_LIMIT;
    const fetched = await this.memory.recentShortTerm(
      scope,
      retrievalLimit + excludeMemoryIds.length,
    );
    const recent = fetched
      .filter((r) => !excludeMemoryIds.includes(r.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-retrievalLimit);

    const transcript = ContextBuilder.toTranscriptEntries(recent);
    const project = task.projectId ? await this.memory.projectMemory(task.projectId) : undefined;

    const minimumCompressionCharacters = this.ranking
      ? ContextBuilder.resolveMinimumCompressionCharacters(this.ranking)
      : undefined;
    if (!this.ranking || !budget) {
      return ContextBuilder.bundle(task.id, transcript, project);
    }

    let remainingBudget = budget.limit;
    const backgroundResources: ContextBundle['backgroundResources'] = [];

    // projectMemory(projectId) is an exact active-project lookup. Reserve its matching
    // background first, before any future lower-relevance project candidates.
    if (project && remainingBudget > 0) {
      const content = budget.truncate(
        ContextBuilder.truncate(project.content, MAX_PROJECT_CHARS),
        remainingBudget,
      );
      if (content.length > 0) {
        backgroundResources.push(ContextBuilder.toProjectBackground(content));
        remainingBudget -= budget.measure(content);
      }
    }

    const conversationTranscript = ContextBuilder.selectRankedTranscript(
      transcript,
      remainingBudget,
      this.ranking,
      budget,
      task.intent.summary,
      minimumCompressionCharacters,
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
    contextBudget: ContextBudget,
    currentSummary: string,
    minimumCompressionCharacters: number | undefined,
  ): ConversationTranscriptEntry[] {
    const roleWeights: Record<ConversationRole, number> = {
      user: config.roleWeights?.user ?? 2,
      assistant: config.roleWeights?.assistant ?? 1,
      unknown: config.roleWeights?.unknown ?? 0,
    };
    const scoring = ContextBuilder.resolveScoringWeights(config);
    for (const [role, weight] of Object.entries(roleWeights)) {
      if (!Number.isFinite(weight)) {
        throw new RangeError(`roleWeights.${role} must be finite`);
      }
    }

    const newestIndex = Math.max(transcript.length - 1, 0);
    const newestUserIndex = ContextBuilder.newestRoleIndex(transcript, 'user');
    const newestAssistantIndex = ContextBuilder.newestRoleIndex(transcript, 'assistant');
    const ranked: RankedTranscriptEntry[] = transcript
      .map((entry, chronologicalIndex) => {
        const roleScore = roleWeights[entry.role ?? 'unknown'];
        const explicitValueScore =
          scoring.blended &&
          entry.role === 'user' &&
          EXPLICIT_VALUE_PATTERN.test(entry.content)
            ? EXPLICIT_USER_VALUE_WEIGHT
            : 0;
        const score =
          explicitValueScore +
          (scoring.blended
            ? roleScore +
              (newestIndex === 0 ? 1 : chronologicalIndex / newestIndex) *
                scoring.recencyWeight +
              scoreSemanticRelevance(currentSummary, entry.content) * scoring.relevanceWeight
            : roleScore + chronologicalIndex * scoring.recencyWeight);
        const continuityPriority =
          chronologicalIndex === newestUserIndex
            ? 2
            : chronologicalIndex === newestAssistantIndex
              ? 1
              : 0;
        return { entry, chronologicalIndex, score, continuityPriority };
      })
      // The PromptComposer contract requires the newest User turn. Keep it, plus the
      // newest Assistant reply for conversational continuity, before ranking fills the
      // bounded remainder. The explicit-value boost remains only a bounded nudge.
      .sort(
        (a, b) =>
          b.continuityPriority - a.continuityPriority ||
          b.score - a.score ||
          b.chronologicalIndex - a.chronologicalIndex,
      )
      .slice(0, RECENT_LIMIT)
      // Continuity priority controls admission to the fixed-size output window.
      // Within that window, the configured score still controls budget allocation.
      .sort((a, b) => b.score - a.score || b.chronologicalIndex - a.chronologicalIndex);

    if (minimumCompressionCharacters !== undefined) {
      return ContextBuilder.compressRankedTranscript(
        ranked,
        budget,
        minimumCompressionCharacters,
      );
    }

    let remaining = budget;
    const selected: RankedTranscriptEntry[] = [];
    for (const candidate of ranked) {
      if (remaining <= 0) break;
      const estimatedSize = contextBudget.measure(candidate.entry.content);
      if (estimatedSize <= remaining) {
        selected.push(candidate);
        remaining -= estimatedSize;
        continue;
      }
      const content = contextBudget.truncate(candidate.entry.content, remaining);
      if (content.length > 0) {
        selected.push({ ...candidate, entry: { ...candidate.entry, content } });
        remaining -= contextBudget.measure(content);
      }
    }

    // PromptComposer's transcript contract remains chronological. Ranking determines
    // relevance-aware selection only; original turn/provenance fields stay untouched.
    return selected
      .sort((a, b) => a.chronologicalIndex - b.chronologicalIndex)
      .map(({ entry }) => entry);
  }

  private static newestRoleIndex(
    transcript: ConversationTranscriptEntry[],
    role: ConversationRole,
  ): number {
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      if (transcript[index]?.role === role) return index;
    }
    return -1;
  }

  private static compressRankedTranscript(
    ranked: RankedTranscriptEntry[],
    tokenBudget: number,
    minimumCharactersPerEntry: number,
  ): ConversationTranscriptEntry[] {
    const selected = ranked.map((candidate) => ({
      ...candidate,
      entry: { ...candidate.entry },
    }));
    let excessTokens =
      selected.reduce((total, candidate) => total + estimateTokenCount(candidate.entry.content), 0) -
      tokenBudget;

    // Ranking is highest-first, so walk backwards to preserve the highest-value content.
    for (let index = selected.length - 1; index >= 0 && excessTokens > 0; index -= 1) {
      const candidate = selected[index];
      if (!candidate) continue;

      const currentTokens = estimateTokenCount(candidate.entry.content);
      const floorCharacters = Math.min(
        candidate.entry.content.length,
        minimumCharactersPerEntry,
      );
      const floorTokens = estimateTokenCount(candidate.entry.content.slice(0, floorCharacters));
      const tokensToRemove = Math.min(excessTokens, currentTokens - floorTokens);
      if (tokensToRemove <= 0) continue;

      const targetCharacters = Math.max(
        floorCharacters,
        (currentTokens - tokensToRemove) * ESTIMATED_CHARACTERS_PER_TOKEN,
      );
      const content = ContextBuilder.truncateToBudget(
        candidate.entry.content,
        targetCharacters,
      );
      candidate.entry = { ...candidate.entry, content };
      excessTokens -= currentTokens - estimateTokenCount(content);
    }

    return selected
      .sort((a, b) => a.chronologicalIndex - b.chronologicalIndex)
      .map(({ entry }) => entry);
  }

  private static resolveScoringWeights(config: ContextRankingConfig):
    | { blended: false; recencyWeight: number }
    | { blended: true; recencyWeight: number; relevanceWeight: number } {
    if (config.relevanceWeight === undefined) {
      const recencyWeight = config.recencyWeight ?? 1;
      if (!Number.isFinite(recencyWeight) || recencyWeight < 0) {
        throw new RangeError('recencyWeight must be a finite non-negative number');
      }
      return { blended: false, recencyWeight };
    }

    const relevanceWeight = config.relevanceWeight;
    const recencyWeight = config.recencyWeight ?? 1 - relevanceWeight;
    if (
      !Number.isFinite(recencyWeight) ||
      !Number.isFinite(relevanceWeight) ||
      recencyWeight < 0 ||
      recencyWeight > 1 ||
      relevanceWeight < 0 ||
      relevanceWeight > 1
    ) {
      throw new RangeError('recencyWeight and relevanceWeight must be finite numbers in [0, 1]');
    }
    if (Math.abs(recencyWeight + relevanceWeight - 1) > Number.EPSILON * 4) {
      throw new RangeError('recencyWeight and relevanceWeight must sum to 1');
    }
    return { blended: true, recencyWeight, relevanceWeight };
  }

  private static validateConfig(config: ContextBuilderConfig): ContextRankingConfig | undefined {
    if (config.rankingEnabled !== undefined && typeof config.rankingEnabled !== 'boolean') {
      throw new TypeError('rankingEnabled must be a boolean');
    }
    if (config.compressionEnabled !== undefined && typeof config.compressionEnabled !== 'boolean') {
      throw new TypeError('compressionEnabled must be a boolean');
    }

    const {
      rankingEnabled,
      compressionEnabled,
      compressionConfig,
      ...rankingOptions
    } = config;
    const hasRankingOptions = Object.values(rankingOptions).some((value) => value !== undefined);
    const hasCompressionConfig = compressionConfig !== undefined;
    const rankingActive = rankingEnabled ?? (hasRankingOptions || hasCompressionConfig);

    if (!rankingActive) {
      if (hasRankingOptions || hasCompressionConfig || compressionEnabled === true) {
        throw new RangeError('ranking options require rankingEnabled');
      }
      return undefined;
    }
    if (compressionEnabled === false && hasCompressionConfig) {
      throw new RangeError('compressionConfig requires compressionEnabled');
    }

    const ranking: ContextRankingConfig = {
      ...rankingOptions,
      ...((compressionEnabled ?? hasCompressionConfig)
        ? { compressionConfig: compressionConfig ?? {} }
        : {}),
    };

    // Validate once at construction so bad runtime configuration fails before a turn.
    ContextBuilder.resolveBudget(ranking);
    ContextBuilder.resolveScoringWeights(ranking);
    ContextBuilder.resolveMinimumCompressionCharacters(ranking);
    if (ranking.roleWeights) {
      for (const [role, weight] of Object.entries(ranking.roleWeights)) {
        if (!Number.isFinite(weight)) {
          throw new RangeError(`roleWeights.${role} must be finite`);
        }
      }
    }
    return ranking;
  }

  private static resolveBudget(config: ContextRankingConfig): ContextBudget | undefined {
    if (config.maxCharacters !== undefined && config.maxTokens !== undefined) {
      throw new RangeError('configure either maxCharacters or maxTokens, not both');
    }
    if (config.maxCharacters !== undefined) {
      const limit = ContextBuilder.nonNegativeInteger(config.maxCharacters, 'maxCharacters');
      return {
        limit,
        measure: (content) => content.length,
        truncate: ContextBuilder.truncateToBudget,
      };
    }
    if (config.maxTokens !== undefined) {
      const limit = ContextBuilder.nonNegativeInteger(config.maxTokens, 'maxTokens');
      return {
        limit,
        measure: estimateTokenCount,
        truncate: (content, remaining) =>
          ContextBuilder.truncateToBudget(
            content,
            remaining * ESTIMATED_CHARACTERS_PER_TOKEN,
          ),
      };
    }
    return undefined;
  }

  private static resolveMinimumCompressionCharacters(
    config: ContextRankingConfig,
  ): number | undefined {
    if (!config.compressionConfig) return undefined;
    if (config.maxTokens === undefined) {
      throw new RangeError('compressionConfig requires maxTokens');
    }
    return ContextBuilder.nonNegativeInteger(
      config.compressionConfig.minimumCharactersPerEntry ??
        DEFAULT_MINIMUM_COMPRESSION_CHARACTERS,
      'compressionConfig.minimumCharactersPerEntry',
    );
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
