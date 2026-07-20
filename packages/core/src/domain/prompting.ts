import type { Id } from './common';

/** Where prompt context originated (ADR-0063). */
export type ContextProvenance =
  | 'CORE_RUNTIME'
  | 'USER'
  | 'ASSISTANT'
  | 'PROJECT_MEMORY'
  | 'LEGACY_UNKNOWN';

/** How strongly a provider may rely on prompt context (ADR-0063). */
export type EpistemicStatus =
  | 'AUTHORITATIVE_CURRENT_FACT'
  | 'USER_CLAIM_OR_INTENT'
  | 'ASSISTANT_NON_AUTHORITATIVE'
  | 'NON_AUTHORITATIVE_TRANSCRIPT'
  | 'NON_AUTHORITATIVE_BACKGROUND';

/** A persisted conversation turn, kept structured until prompt composition. */
export interface ConversationTranscriptEntry {
  content: string;
  provenance: 'USER' | 'ASSISTANT' | 'LEGACY_UNKNOWN';
  epistemicStatus:
    | 'USER_CLAIM_OR_INTENT'
    | 'ASSISTANT_NON_AUTHORITATIVE'
    | 'NON_AUTHORITATIVE_TRANSCRIPT';
}

/** Stored project context is useful background, not current-state evidence. */
export interface BackgroundResource {
  content: string;
  provenance: 'PROJECT_MEMORY';
  epistemicStatus: 'NON_AUTHORITATIVE_BACKGROUND';
}

/**
 * Assembled, budgeted context for a single execution (ADR-0002 / ADR-0063).
 * Current-turn facts stay on Task; this bundle owns only bounded conversation
 * history and non-authoritative background resources.
 */
export interface ContextBundle {
  taskId: Id;
  /** Recent short-term conversation turns (oldest → newest). */
  conversationTranscript: ConversationTranscriptEntry[];
  /** Active-project memory, when present, as non-authoritative background. */
  backgroundResources: BackgroundResource[];
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
