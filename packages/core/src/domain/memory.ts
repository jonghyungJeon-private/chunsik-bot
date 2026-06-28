import type { Id, IsoTimestamp, Metadata } from './common';
import type { MemoryType } from './enums';

/**
 * Scope narrows which memories apply to a given moment. A retrieval typically
 * filters by some subset (e.g. all PROJECT memory for projectId X, plus
 * SHORT_TERM memory for threadId Y).
 */
export interface MemoryScope {
  userId?: string;
  channelId?: string;
  threadId?: string;
  /** Conversation session this memory belongs to (ADR-0001). */
  sessionId?: Id;
  taskId?: Id;
  projectId?: Id;
}

/**
 * A single durable memory. Chunsik Memory is the source of truth; the AI CLIs
 * are stateless executors that receive memory ONLY via generated context files.
 */
export interface MemoryRecord {
  id: Id;
  type: MemoryType;
  scope: MemoryScope;
  content: string;
  /** Optional vector id in the VectorProvider, for semantic recall. */
  vectorId?: Id;
  metadata?: Metadata;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/**
 * A file that the MemoryManager materializes into the workspace so a stateless
 * CLI can "see" the relevant memory. Path is workspace-relative, e.g.
 * "CLAUDE.md", "AGENTS.md", ".chunsik/context.md", ".chunsik/task.md".
 *
 * NOTE: This is the ONLY mechanism by which memory reaches a CLI. The core
 * builds these; the AiProvider just passes them through to the workspace.
 */
export interface ContextFile {
  path: string;
  content: string;
}
