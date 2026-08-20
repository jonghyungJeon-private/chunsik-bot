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
import { sanitizeTerminalOutput, stripInternalMetadataEnvelope } from './output-sanitizer';

export { BaseCliAiProvider };
export { defaultCliRunner, maskSecrets } from './cli-runner';
export type { CliRunner, CliRunOptions, CliRunResult } from './cli-runner';

const OLLAMA_COLOR_ENV = {
  NO_COLOR: '1',
  CLICOLOR: '0',
  CLICOLOR_FORCE: '0',
} as const;

type ProviderConversationRole = 'system' | 'user' | 'assistant' | 'unknown';

interface ProviderConversationMessage {
  role: ProviderConversationRole;
  provenance: string;
  epistemicStatus: string;
  content: string;
}

interface RenderedPromptSections {
  systemContext: string;
  transcript: ProviderConversationMessage[];
  currentUserMessage: Omit<ProviderConversationMessage, 'role'>;
}

function parseEnvelope(value: string): Omit<ProviderConversationMessage, 'role'> | null {
  try {
    const parsed = JSON.parse(value) as {
      provenance?: unknown;
      epistemicStatus?: unknown;
      content?: unknown;
    };
    return typeof parsed.provenance === 'string' &&
      typeof parsed.epistemicStatus === 'string' &&
      typeof parsed.content === 'string'
      ? {
          provenance: parsed.provenance,
          epistemicStatus: parsed.epistemicStatus,
          content: parsed.content,
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * Recover the provider-neutral GENERAL_CHAT sections emitted by PromptRenderer.
 * The Ollama CLI accepts one stdin string, so llama3.1 otherwise receives the
 * whole rendered request as one current-user message and loses chat-role
 * boundaries. This adapter-local parser recovers the deterministic Core
 * representation so the provider input can retain explicit role attribution.
 */
function parseRenderedGeneralChatPrompt(prompt: string): RenderedPromptSections | null {
  const taskMarker = '\n\n# Task\n';
  const taskIndex = prompt.lastIndexOf(taskMarker);
  if (taskIndex < 0 || !prompt.startsWith('# System\n')) return null;

  const contextMarker = '\n\n# Context\n';
  const contextIndex = prompt.indexOf(contextMarker);
  if (contextIndex < 0 || contextIndex > taskIndex) return null;

  const contextStart = contextIndex + contextMarker.length;
  const context = prompt.slice(contextStart, taskIndex);
  const transcriptHeading = '## 3. Conversation transcript';
  const transcriptIndex = context.indexOf(transcriptHeading);
  if (transcriptIndex < 0) return null;
  const transcriptBodyStart = context.indexOf('\n', transcriptIndex);
  if (transcriptBodyStart < 0) return null;
  const transcriptBodyEnd = context.indexOf('\n\n## 4.', transcriptBodyStart + 1);
  if (transcriptBodyEnd < 0) return null;

  const transcriptBody = context.slice(transcriptBodyStart + 1, transcriptBodyEnd);
  const transcript: ProviderConversationMessage[] = [];
  if (transcriptBody !== '[]') {
    for (const line of transcriptBody.split('\n')) {
      const match = /^\[Turn \d+\] (User|Assistant|Unknown): (\{.*\})$/.exec(line);
      if (!match) return null;
      const envelope = parseEnvelope(match[2] ?? '');
      if (envelope === null) return null;
      const role = match[1] === 'User'
        ? 'user'
        : match[1] === 'Assistant'
          ? 'assistant'
          : 'unknown';
      transcript.push({ role, ...envelope });
    }
  }

  const taskBody = prompt.slice(taskIndex + taskMarker.length);
  const currentMessageMarker = '--- Current user message ---\n';
  if (!taskBody.startsWith(currentMessageMarker)) return null;
  const currentUserMessage = parseEnvelope(taskBody.slice(currentMessageMarker.length));
  if (currentUserMessage === null) return null;

  // History is rendered later as prior exchanges. Remove the document-style
  // transcript section here so the same content is not also presented as an
  // analysis target inside the instruction/context block.
  const systemContext = [
    prompt.slice(0, contextStart + transcriptIndex),
    context.slice(transcriptBodyEnd),
  ].join('');
  return { systemContext, transcript, currentUserMessage };
}

function renderPreviousConversationMessage(message: ProviderConversationMessage): string {
  if (message.role === 'assistant') {
    return `Assistant (earlier turn; continuity only, may be inaccurate): ${JSON.stringify(message.content)}`;
  }
  if (message.role === 'user') {
    return `User (earlier turn; claim or intent): ${JSON.stringify(message.content)}`;
  }
  return `Unattributed earlier context (non-authoritative): ${JSON.stringify(message.content)}`;
}

function renderContextEnvelopeWithoutInternalLabels(value: string): string {
  return value.split('\n').map((line) => {
    const envelope = parseEnvelope(line);
    if (envelope === null) return line;
    if (
      envelope.provenance === 'CORE_RUNTIME' &&
      envelope.epistemicStatus === 'AUTHORITATIVE_CURRENT_FACT'
    ) {
      return `Core Runtime states as an authoritative current fact: ${JSON.stringify(envelope.content)}`;
    }
    if (
      envelope.provenance === 'PROJECT_MEMORY' &&
      envelope.epistemicStatus === 'NON_AUTHORITATIVE_BACKGROUND'
    ) {
      return `Project Memory supplies as non-authoritative background: ${JSON.stringify(envelope.content)}`;
    }
    return `${envelope.provenance} supplies ${envelope.epistemicStatus} context: ${JSON.stringify(envelope.content)}`;
  }).join('\n');
}

function serializeGeneralChat(prompt: string): string | null {
  const sections = parseRenderedGeneralChatPrompt(prompt);
  if (!sections) return null;

  // Ollama's CLI exposes one stdin prompt rather than a messages API. Render
  // the recovered turns as a chat-completion continuation: prior exchanges
  // come first, then the current User turn, and the final Assistant cue makes
  // the requested response boundary unambiguous. Provenance and epistemic
  // policy remain authoritative in systemContext, but their internal labels
  // are intentionally not repeated beside conversational content: those
  // document-like labels caused llama3.1 to analyze or reproduce the envelope.
  return [
    renderContextEnvelopeWithoutInternalLabels(sections.systemContext),
    sections.transcript.length === 0
      ? ''
      : [
          'Previous conversation (continue it naturally; do not analyze or reproduce it):',
          ...sections.transcript.map(renderPreviousConversationMessage),
          'End previous conversation.',
        ].join('\n'),
    'Continue the conversation by answering the final User message directly.',
    `User (current active turn): ${JSON.stringify(sections.currentUserMessage.content)}`,
    'Assistant response:',
  ].filter(Boolean).join('\n\n');
}

function approvedLoopbackHost(value: string): string {
  let endpoint: URL;
  try { endpoint = new URL(value); } catch { throw new TypeError('Invalid Ollama validation host'); }
  if (
    endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
    endpoint.port.length === 0 || endpoint.username || endpoint.password ||
    endpoint.pathname !== '/' || endpoint.search || endpoint.hash
  ) throw new TypeError('Invalid Ollama validation host');
  return endpoint.origin;
}

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

    const sanitizedOutput = sanitizeTerminalOutput(result.stdout);
    const text = (request.capability === Capability.GENERAL_CHAT
      ? stripInternalMetadataEnvelope(sanitizedOutput)
      : sanitizedOutput
    ).trim();
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
  readonly id: string;
  protected readonly bin: string;
  private readonly model: string;
  private readonly runner: CliRunner;
  private readonly defaultTimeoutMs: number;
  private readonly validationHost: string | null;

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

  constructor(options: {
    bin?: string;
    model?: string;
    providerId?: string;
    runner?: CliRunner;
    timeoutMs?: number;
    validationHost?: string;
  } = {}) {
    super();
    this.id = options.providerId ?? 'ollama-cli';
    this.bin = options.bin ?? 'ollama';
    this.model = options.model ?? 'llama3.1';
    this.runner = options.runner ?? defaultCliRunner;
    this.defaultTimeoutMs = options.timeoutMs ?? 120_000;
    this.validationHost = options.validationHost === undefined
      ? null : approvedLoopbackHost(options.validationHost);
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
    const serializedConversation = request.capability === Capability.GENERAL_CHAT
      ? serializeGeneralChat(request.prompt)
      : null;
    const input = serializedConversation ?? request.prompt;
    // Suggest-only: a local model never needs the repo. Always a neutral cwd so it cannot
    // ingest workspace files (defense in depth on top of CAP-008's no-workspace AiRequest).
    const cwd = tmpdir();
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    // Preserve the existing audit contract: this hashes the canonical PromptRenderer
    // output. The contained-runner regression separately proves the exact serialized
    // provider input without persisting either prompt representation.
    const promptSha256 = createHash('sha256').update(Buffer.from(request.prompt, 'utf8')).digest('hex');

    const result = await this.runner(this.bin, this.buildArgs(), {
      cwd,
      input,
      timeoutMs,
      env: this.validationHost === null ? OLLAMA_COLOR_ENV : {
        ...OLLAMA_COLOR_ENV,
        OLLAMA_HOST: this.validationHost,
        OLLAMA_NO_CLOUD: '1',
      },
      ...(this.validationHost === null ? {} : {
        environmentProfile: 'ISOLATED_OLLAMA_VALIDATION' as const,
        downloadMarkerPolicy: 'OLLAMA_PULL' as const,
      }),
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

    const sanitizedOutput = sanitizeTerminalOutput(result.stdout);
    const text = (request.capability === Capability.GENERAL_CHAT
      ? stripInternalMetadataEnvelope(sanitizedOutput)
      : sanitizedOutput
    ).trim();
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
