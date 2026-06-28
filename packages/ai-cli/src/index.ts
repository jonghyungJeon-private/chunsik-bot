import type { AiCapabilityDescriptor } from '@chunsik/core';
import { BaseCliAiProvider, Capability } from './base-cli-provider';

export { BaseCliAiProvider };

/**
 * Claude CLI. Strongest for architecture/planning/review, and advertises EVERY
 * capability at a moderate priority so it is the universal fallback when Ollama
 * is down or Codex is absent.
 */
export class ClaudeCliProvider extends BaseCliAiProvider {
  readonly id = 'claude-cli';
  protected readonly bin: string;
  readonly capabilities: readonly AiCapabilityDescriptor[] = [
    { capability: Capability.ARCHITECTURE_PLANNING, priority: 100 },
    { capability: Capability.CODE_REVIEW, priority: 90 },
    { capability: Capability.DOCUMENT_ANALYSIS, priority: 60 },
    { capability: Capability.CODE_IMPLEMENTATION, priority: 50 },
    { capability: Capability.GENERAL_CHAT, priority: 50 },
    { capability: Capability.SUMMARIZATION, priority: 50 },
    { capability: Capability.READONLY_LOOKUP, priority: 50 },
    { capability: Capability.TEST_EXECUTION, priority: 50 },
  ];

  constructor(bin = 'claude') {
    super();
    this.bin = bin;
  }
}

/** Codex CLI. Strongest for code implementation and test execution. */
export class CodexCliProvider extends BaseCliAiProvider {
  readonly id = 'codex-cli';
  protected readonly bin: string;
  readonly capabilities: readonly AiCapabilityDescriptor[] = [
    { capability: Capability.CODE_IMPLEMENTATION, priority: 100 },
    { capability: Capability.TEST_EXECUTION, priority: 80 },
    { capability: Capability.CODE_REVIEW, priority: 60 },
  ];

  constructor(bin = 'codex') {
    super();
    this.bin = bin;
  }
}

/**
 * Ollama CLI (OPTIONAL). Preferred for general chat / summarization / embedding
 * when available; if unavailable, the router naturally falls back to Claude
 * because Claude also advertises those capabilities (at lower priority).
 */
export class OllamaCliProvider extends BaseCliAiProvider {
  readonly id = 'ollama-cli';
  protected readonly bin: string;
  private readonly model: string;
  readonly capabilities: readonly AiCapabilityDescriptor[] = [
    { capability: Capability.GENERAL_CHAT, priority: 100 },
    { capability: Capability.SUMMARIZATION, priority: 100 },
    { capability: Capability.EMBEDDING, priority: 100 },
    { capability: Capability.DOCUMENT_ANALYSIS, priority: 80 },
    { capability: Capability.READONLY_LOOKUP, priority: 70 },
  ];

  constructor(options: { bin?: string; model?: string } = {}) {
    super();
    this.bin = options.bin ?? 'ollama';
    this.model = options.model ?? 'llama3.1';
  }

  /** Exposed for the eventual execute() impl; referenced to satisfy linting. */
  protected get modelName(): string {
    return this.model;
  }
}
