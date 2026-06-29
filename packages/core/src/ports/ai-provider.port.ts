import type {
  Artifact,
  Capability,
  ContextFile,
  Metadata,
  PromptSpec,
  WorkspaceRef,
} from '../domain';

/**
 * What a provider can do, and how strongly it should be preferred for it.
 * This is the data that makes provider selection POLICY-DRIVEN rather than
 * hardcoded. The core sorts available providers by `priority` for a capability
 * and picks the top — it never names a concrete CLI.
 *
 * Example v1 priorities (advertised by each concrete provider, NOT by core):
 *   OllamaCliProvider  GENERAL_CHAT=100  SUMMARIZATION=100
 *   CodexCliProvider   CODE_IMPLEMENTATION=100  TEST_EXECUTION=80
 *   ClaudeCliProvider  ARCHITECTURE_PLANNING=100  CODE_REVIEW=90  + every
 *                      capability at a low priority so it is the universal fallback.
 */
export interface AiCapabilityDescriptor {
  capability: Capability;
  /** Higher wins. Ties broken by provider order. */
  priority: number;
}

export interface AiExecutionRequest {
  capability: Capability;
  /**
   * Layered, provider-agnostic prompt built by the PromptComposer. Preferred
   * input; the provider RENDERS it to a CLI-ready form. (ADR-0003 / ADR-0014)
   */
  promptSpec?: PromptSpec;
  /** Pre-rendered instruction string. Fallback when no promptSpec is supplied. */
  prompt?: string;
  /**
   * Memory injected as files. The core generates these from Chunsik Memory;
   * the provider's only job is to ensure the CLI can see them (typically by
   * having them written into the workspace before invocation).
   */
  contextFiles?: ContextFile[];
  /** The directory the CLI runs in, if the capability touches a workspace. */
  workspace?: WorkspaceRef;
  timeoutMs?: number;
  metadata?: Metadata;
}

export interface AiExecutionResult {
  /** Primary text output, already provider-agnostic. */
  text: string;
  /** Structured outputs (diffs, patches, logs) the run produced. */
  artifacts?: Artifact[];
  /** Raw CLI output for debugging; never surfaced to the user by default. */
  raw?: Metadata;
}

/**
 * PORT: an AI execution backend. v1 implementations wrap CLIs
 * (ClaudeCliProvider, CodexCliProvider, OllamaCliProvider). NO HTTP API in v1.
 *
 * Boundary rule: the core depends ONLY on this interface. It must never import
 * a concrete provider, branch on `id`, or assume a specific CLI exists.
 */
export interface AiProvider {
  /** Stable id for audit/logging only, e.g. "claude-cli". */
  readonly id: string;
  /** Capabilities this provider serves, with selection priorities. */
  readonly capabilities: readonly AiCapabilityDescriptor[];

  /** Health/auth probe. Ollama may be down; Claude/Codex may be unauthed. */
  isAvailable(): Promise<boolean>;

  execute(request: AiExecutionRequest): Promise<AiExecutionResult>;

  /** Optional streaming for long runs; core falls back to execute() if absent. */
  stream?(request: AiExecutionRequest): AsyncIterable<string>;
}
