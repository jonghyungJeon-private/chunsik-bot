import type { Id } from './common';

/**
 * Assembled, budgeted context for a single execution (ADR-0002 / ADR-0014).
 * v1 is trivial: the task summary plus recent conversation lines. Ranking,
 * compression, and resource inclusion come later behind the same shape.
 */
export interface ContextBundle {
  taskId: Id;
  /** One-line statement of what the user wants. */
  summary: string;
  /** Recent short-term conversation lines (oldest → newest). */
  recentMessages: string[];
}

/**
 * Provider-agnostic, layered prompt (ADR-0003 / ADR-0014). The PromptComposer
 * (core) builds it; an AiProvider adapter RENDERS it to a CLI-ready form. The
 * core never renders provider-specific text.
 */
export interface PromptSpec {
  /** Stable identity/rules for the assistant. */
  system: string;
  /** Per-capability instruction (what kind of task this is). */
  developer: string;
  /** Rendered context from the ContextBundle (may be empty). */
  context: string;
  /** The user's actual request. */
  task: string;
}
