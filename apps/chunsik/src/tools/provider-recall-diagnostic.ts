import { performance } from 'node:perf_hooks';
import {
  ClaudeCliProvider,
  OllamaCliProvider,
  defaultCliRunner,
} from '@chunsik/ai-cli';
import type { CliRunner } from '@chunsik/ai-cli';
import {
  Capability,
  IntentType,
  PromptComposer,
  PromptRenderer,
  RiskLevel,
  TaskStatus,
} from '@chunsik/core';
import type { AiProvider, AiRequest, ContextBundle, Task } from '@chunsik/core';

export const CANONICAL_RECALL_SCENARIO = Object.freeze({
  previousUserMessage: '안녕?',
  previousAssistantMessage: '네, 안녕하세요!',
  currentUserMessage: '내가 방금 뭐라 질문했어?',
  contextTruncationOccurred: false,
} as const);

export const RECALL_COMPARISON_TARGETS = Object.freeze([
  Object.freeze({ providerId: 'ollama-cli:llama3.1:8b', modelIdentity: 'llama3.1:8b' }),
  Object.freeze({ providerId: 'ollama-cli:granite3.3:8b', modelIdentity: 'granite3.3:8b' }),
  Object.freeze({
    providerId: 'claude-cli',
    // ClaudeCliProvider intentionally does not pin --model. This is the exact configured identity.
    modelIdentity: 'claude-cli configured default (not pinned)',
  }),
] as const);

export type RecallDiagnosticStatus = 'PASS' | 'FAIL';

export interface ProviderRecallComparisonResult {
  readonly providerId: string;
  readonly modelIdentity: string;
  readonly previousTurnPresentAtProviderBoundary: boolean;
  readonly serializedInputCharacterCount: number;
  readonly contextTruncationOccurred: boolean;
  readonly generationLatencyMs: number;
  readonly recallResult: RecallDiagnosticStatus;
  readonly responseText: string;
  readonly error: string | null;
}

export interface ProviderRecallDiagnosticOptions {
  readonly runner?: CliRunner;
  readonly ollamaBin?: string;
  readonly claudeBin?: string;
  readonly timeoutMs?: number;
  /** Monotonic millisecond clock; injectable for deterministic tests. */
  readonly now?: () => number;
}

interface ComparisonTarget {
  readonly providerId: string;
  readonly modelIdentity: string;
  readonly provider: AiProvider;
  readonly getSerializedInput: () => string;
  readonly includeWhenAvailable: boolean;
}

const CANONICAL_TIMESTAMP = '2026-08-20T00:00:00.000Z';
const CANONICAL_TASK_ID = 'provider-recall-diagnostic-task';

/** Build the one finalized GENERAL_CHAT request shared by every comparison target. */
export function createCanonicalRecallRequest(): AiRequest {
  const task: Task = {
    id: CANONICAL_TASK_ID,
    title: 'Canonical conversational recall diagnostic',
    description: CANONICAL_RECALL_SCENARIO.currentUserMessage,
    status: TaskStatus.PENDING,
    intent: {
      type: IntentType.CHAT,
      capability: Capability.GENERAL_CHAT,
      confidence: 1,
      requiresWork: true,
      summary: CANONICAL_RECALL_SCENARIO.currentUserMessage,
    },
    riskLevel: RiskLevel.LOW,
    context: {
      platform: 'diagnostic',
      channelId: 'provider-recall-diagnostic-channel',
      userId: 'provider-recall-diagnostic-user',
    },
    createdAt: CANONICAL_TIMESTAMP,
    updatedAt: CANONICAL_TIMESTAMP,
  };
  const context: ContextBundle = {
    taskId: task.id,
    backgroundResources: [],
    conversationTranscript: [
      {
        turnNumber: 1,
        role: 'user',
        provenance: 'USER',
        epistemicStatus: 'USER_CLAIM_OR_INTENT',
        content: CANONICAL_RECALL_SCENARIO.previousUserMessage,
      },
      {
        turnNumber: 1,
        role: 'assistant',
        provenance: 'ASSISTANT',
        epistemicStatus: 'ASSISTANT_NON_AUTHORITATIVE',
        content: CANONICAL_RECALL_SCENARIO.previousAssistantMessage,
      },
    ],
  };

  const spec = new PromptComposer().compose(task, context);
  return new PromptRenderer().render(spec, { capability: Capability.GENERAL_CHAT });
}

export function evaluateRecall(output: string): RecallDiagnosticStatus {
  return output.includes('안녕') ? 'PASS' : 'FAIL';
}

function targetWithCapturedInput(
  definition: (runner: CliRunner) => Omit<ComparisonTarget, 'getSerializedInput'>,
  delegatedRunner: CliRunner,
): ComparisonTarget {
  let serializedInput = '';
  const capturingRunner: CliRunner = async (bin, args, options) => {
    if (options.input.length > 0) serializedInput = options.input;
    return delegatedRunner(bin, args, options);
  };
  return {
    ...definition(capturingRunner),
    getSerializedInput: () => serializedInput,
  };
}

function comparisonTargets(options: ProviderRecallDiagnosticOptions): readonly ComparisonTarget[] {
  const delegatedRunner = options.runner ?? defaultCliRunner;
  const ollamaBin = options.ollamaBin ?? 'ollama';
  const claudeBin = options.claudeBin ?? 'claude';
  const timeoutMs = options.timeoutMs ?? 120_000;

  return RECALL_COMPARISON_TARGETS.map((target) =>
    targetWithCapturedInput(
      (runner) => ({
        providerId: target.providerId,
        modelIdentity: target.modelIdentity,
        includeWhenAvailable: target.providerId === 'claude-cli',
        provider: target.providerId === 'claude-cli'
          ? new ClaudeCliProvider(claudeBin, { runner, timeoutMs })
          : new OllamaCliProvider({
              bin: ollamaBin,
              model: target.modelIdentity,
              providerId: target.providerId,
              runner,
              timeoutMs,
            }),
      }),
      delegatedRunner,
    ),
  );
}

function providerBoundaryContainsPreviousTurn(serializedInput: string): boolean {
  return serializedInput.includes(CANONICAL_RECALL_SCENARIO.previousUserMessage) &&
    serializedInput.includes(CANONICAL_RECALL_SCENARIO.previousAssistantMessage);
}

/**
 * Execute the controlled comparison when an authorized caller explicitly invokes it.
 * Importing this module never probes or executes a provider.
 */
export async function runComparison(
  options: ProviderRecallDiagnosticOptions = {},
): Promise<readonly ProviderRecallComparisonResult[]> {
  const request = createCanonicalRecallRequest();
  const now = options.now ?? (() => performance.now());
  const results: ProviderRecallComparisonResult[] = [];

  for (const target of comparisonTargets(options)) {
    if (target.includeWhenAvailable && !(await target.provider.isAvailable())) continue;

    const startedAt = now();
    let responseText = '';
    let error: string | null = null;
    try {
      responseText = (await target.provider.execute(request)).text;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const generationLatencyMs = Math.max(0, Math.round(now() - startedAt));
    const serializedInput = target.getSerializedInput();

    results.push(Object.freeze({
      providerId: target.providerId,
      modelIdentity: target.modelIdentity,
      previousTurnPresentAtProviderBoundary:
        providerBoundaryContainsPreviousTurn(serializedInput),
      serializedInputCharacterCount: serializedInput.length,
      contextTruncationOccurred: CANONICAL_RECALL_SCENARIO.contextTruncationOccurred,
      generationLatencyMs,
      recallResult: error === null ? evaluateRecall(responseText) : 'FAIL',
      responseText,
      error,
    }));
  }

  return Object.freeze(results);
}
