import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { AiFailureKind, AiProviderError, ArtifactKind, newId, now } from '@chunsik/core';
import type {
  AiCapabilityDescriptor,
  AiExecutionResult,
  AiRequest,
  Artifact,
} from '@chunsik/core';
import { BaseCliAiProvider, Capability } from './base-cli-provider';
import { defaultCliRunner, maskSecrets } from './cli-runner';
import type { CliRunner } from './cli-runner';
import { sanitizeTerminalOutput } from './output-sanitizer';

export { BaseCliAiProvider };
export { defaultCliRunner, maskSecrets } from './cli-runner';
export type { CliRunner, CliRunOptions, CliRunResult } from './cli-runner';

const OLLAMA_COLOR_ENV = {
  NO_COLOR: '1',
  CLICOLOR: '0',
  CLICOLOR_FORCE: '0',
} as const;

function sanitizedModelName(model: string): string {
  return /^[A-Za-z0-9._:/-]{1,200}$/.test(model) ? model : '[redacted]';
}

export interface CliProviderOptions {
  runner?: CliRunner;
  timeoutMs?: number;
}

/**
 * Claude CLI provider (Sprint 1b-2). Executes via `claude -p` with the prompt on
 * **stdin**, in a **neutral cwd**, with a **timeout**, capturing stdout/stderr.
 * Uses the CLI's existing OAuth auth — no `--bare`, no ANTHROPIC_API_KEY path,
 * no HTTP API (ADR-0014).
 */
export class ClaudeCliProvider extends BaseCliAiProvider {
  readonly id = 'claude-cli';
  protected readonly bin: string;
  private readonly runner: CliRunner;
  private readonly defaultTimeoutMs: number;

  readonly capabilities: readonly AiCapabilityDescriptor[] = [
    { capability: Capability.ARCHITECTURE_PLANNING, priority: 100 },
    { capability: Capability.PROJECT_ANALYSIS, priority: 90 },
    { capability: Capability.CODE_REVIEW, priority: 90 },
    { capability: Capability.DOCUMENT_ANALYSIS, priority: 60 },
    { capability: Capability.CODE_IMPLEMENTATION, priority: 50 },
    { capability: Capability.GENERAL_CHAT, priority: 50 },
    { capability: Capability.SUMMARIZATION, priority: 50 },
    { capability: Capability.READONLY_LOOKUP, priority: 50 },
    { capability: Capability.TEST_EXECUTION, priority: 50 },
  ];

  constructor(bin = 'claude', options: CliProviderOptions = {}) {
    super();
    this.bin = bin;
    this.runner = options.runner ?? defaultCliRunner;
    this.defaultTimeoutMs = options.timeoutMs ?? 120_000;
  }

  /** Non-interactive print mode. Prompt is supplied via stdin, never as an argv. */
  buildArgs(): string[] {
    return ['-p'];
  }

  override async isAvailable(): Promise<boolean> {
    try {
      const r = await this.runner(this.bin, ['--version'], {
        cwd: tmpdir(),
        input: '',
        timeoutMs: 10_000,
      });
      return r.code === 0;
    } catch {
      return false;
    }
  }

  override async execute(request: AiRequest): Promise<AiExecutionResult> {
    const input = request.prompt; // already rendered by the core PromptRenderer (ADR-0029)
    // Neutral cwd avoids ingesting the repo's CLAUDE.md; a workspace task may set its own.
    const cwd = request.workspace?.rootPath ?? tmpdir();
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;

    const result = await this.runner(this.bin, this.buildArgs(), { cwd, input, timeoutMs });

    // Classified failure taxonomy (ADR-0015). stderr is masked before it leaves.
    if (result.timedOut) {
      throw new AiProviderError(AiFailureKind.TIMEOUT, `claude CLI timed out after ${timeoutMs}ms`);
    }
    if (result.code === null) {
      throw new AiProviderError(
        AiFailureKind.UNAVAILABLE,
        `claude CLI could not run: ${maskSecrets(result.stderr).slice(0, 300)}`,
      );
    }
    if (result.code !== 0) {
      const kind = ClaudeCliProvider.classifyStderr(result.stderr);
      throw new AiProviderError(
        kind,
        `claude CLI exited ${result.code}: ${maskSecrets(result.stderr).slice(0, 300)}`,
      );
    }

    const text = result.stdout.trim();
    if (!text) {
      throw new AiProviderError(AiFailureKind.EMPTY_OUTPUT, 'claude CLI returned empty output');
    }

    const artifact: Artifact = {
      id: newId(),
      kind: ArtifactKind.MARKDOWN_REPORT,
      title: 'claude-response',
      content: text,
      createdAt: now(),
    };
    return {
      text,
      artifacts: [artifact],
      raw: { exitCode: result.code, stderr: maskSecrets(result.stderr).slice(0, 1000) },
    };
  }

  /** Map CLI stderr to an auth vs. generic execution failure. */
  private static classifyStderr(stderr: string): AiFailureKind {
    const s = stderr.toLowerCase();
    if (
      /(not logged in|please run.*login|authenticat|unauthor|invalid api key|\bapi key\b|oauth|credential|forbidden|\b401\b|\b403\b)/.test(
        s,
      )
    ) {
      return AiFailureKind.AUTH_REQUIRED;
    }
    return AiFailureKind.EXECUTION_FAILED;
  }
}

/**
 * Codex CLI provider (CAP-008, ADR-0029). Advertised for code implementation, but
 * `execute()` is intentionally **NOT implemented** in CAP-008 (inherits the base
 * `NotImplementedError`). The Codex CLI has no deterministic suggest-only / no-tool /
 * no-exec mode: `codex exec --sandbox read-only` is read-only **agent** execution (a
 * tool/plan-act-observe loop), NOT proposal-only — which would cross the CAP-008
 * boundary (no tool calling, no autonomous action; the AI only proposes). Real Codex
 * execution is deferred to a future PR once a verified suggest-only contract exists
 * (or to the Agent Runtime / Orchestrator). Because `isAvailable()` also throws,
 * `AiProviderManager` treats it as unavailable and never selects it. The AI Code
 * Generation capability is provider-agnostic and runs on any suggest-only AiProvider.
 */
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
 * Ollama CLI provider (CAP-009, ADR-0030). The **second** `AiProvider` adapter for the
 * AI Code Generation capability (CAP-008, ADR-0029) — proof the contract is provider-
 * agnostic: no Core change, no new aggregate/manager/port/migration. Unlike Codex (whose
 * CLI has no deterministic suggest-only mode, so it stays NotImplemented), `ollama run
 * <model>` is **single-shot text generation** — no tools, no exec, no file access, no
 * plan-act loop — so it satisfies the suggest-only contract honestly: the model only
 * proposes. Prompt is fed on **stdin** (never an argv); the CLI runs in a **neutral cwd**
 * (it never needs the repo and must not ingest it). Failure classification per ADR-0015;
 * output masked. Advertised for code at a LOW priority (below Claude) so a local model is
 * a fallback, not the default, for code — plus its existing chat/summarization roles.
 */
export class OllamaCliProvider extends BaseCliAiProvider {
  readonly id = 'ollama-cli';
  protected readonly bin: string;
  private readonly model: string;
  private readonly runner: CliRunner;
  private readonly defaultTimeoutMs: number;

  readonly capabilities: readonly AiCapabilityDescriptor[] = [
    { capability: Capability.GENERAL_CHAT, priority: 100 },
    { capability: Capability.SUMMARIZATION, priority: 100 },
    { capability: Capability.EMBEDDING, priority: 100 },
    { capability: Capability.DOCUMENT_ANALYSIS, priority: 80 },
    { capability: Capability.READONLY_LOOKUP, priority: 70 },
    // CAP-009 (ADR-0030): code generation on a LOCAL model, suggest-only. Priority 40 is
    // BELOW Claude's 50 so Claude is preferred for code when available; Ollama serves when
    // it is the best available (e.g. offline / local-only). Codex advertises 100 but is
    // unavailable, so it never competes.
    { capability: Capability.CODE_IMPLEMENTATION, priority: 40 },
  ];

  constructor(options: { bin?: string; model?: string; runner?: CliRunner; timeoutMs?: number } = {}) {
    super();
    this.bin = options.bin ?? 'ollama';
    this.model = options.model ?? 'llama3.1';
    this.runner = options.runner ?? defaultCliRunner;
    this.defaultTimeoutMs = options.timeoutMs ?? 120_000;
  }

  /** `ollama run <model>`. The prompt is supplied via stdin, never as an argv. */
  buildArgs(): string[] {
    return ['run', this.model];
  }

  override async isAvailable(): Promise<boolean> {
    try {
      const r = await this.runner(this.bin, ['--version'], {
        cwd: tmpdir(),
        input: '',
        timeoutMs: 10_000,
        env: OLLAMA_COLOR_ENV,
      });
      return r.code === 0;
    } catch {
      return false;
    }
  }

  override async execute(request: AiRequest): Promise<AiExecutionResult> {
    const input = request.prompt; // already rendered by the core PromptRenderer (ADR-0029)
    // Suggest-only: a local model never needs the repo. Always a neutral cwd so it cannot
    // ingest workspace files (defense in depth on top of CAP-008's no-workspace AiRequest).
    const cwd = tmpdir();
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const promptSha256 = createHash('sha256').update(Buffer.from(input, 'utf8')).digest('hex');

    const result = await this.runner(this.bin, this.buildArgs(), {
      cwd,
      input,
      timeoutMs,
      env: OLLAMA_COLOR_ENV,
    });

    // Classified failure taxonomy (ADR-0015). stderr is masked before it leaves. Ollama is
    // local + auth-free, so there is no AUTH_REQUIRED path.
    if (result.timedOut) {
      throw new AiProviderError(AiFailureKind.TIMEOUT, `ollama CLI timed out after ${timeoutMs}ms`);
    }
    if (result.code === null) {
      throw new AiProviderError(
        AiFailureKind.UNAVAILABLE,
        `ollama CLI could not run: ${maskSecrets(result.stderr).slice(0, 300)}`,
      );
    }
    if (result.code !== 0) {
      throw new AiProviderError(
        AiFailureKind.EXECUTION_FAILED,
        `ollama CLI exited ${result.code}: ${maskSecrets(result.stderr).slice(0, 300)}`,
      );
    }

    const text = sanitizeTerminalOutput(result.stdout).trim();
    if (!text) {
      throw new AiProviderError(AiFailureKind.EMPTY_OUTPUT, 'ollama CLI returned empty output');
    }

    const model = sanitizedModelName(this.model);
    const artifact: Artifact = {
      id: newId(),
      kind: ArtifactKind.MARKDOWN_REPORT,
      title: 'ollama-response',
      content: text,
      createdAt: now(),
    };
    return {
      text,
      artifacts: [artifact],
      raw: { exitCode: result.code, stderr: maskSecrets(result.stderr).slice(0, 1000) },
      audit: {
        model,
        sanitizedCommand: ['ollama', 'run', model],
        promptSha256,
        captureMode: 'pipe',
        colorDisabled: true,
        outputSanitized: true,
      },
    };
  }
}
