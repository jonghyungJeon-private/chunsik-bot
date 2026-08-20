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
export type RecallComparisonCategory = 'PRODUCTION_PATH' | 'NORMALIZED_INPUT_CONTROL';
export type RecallDiagnosticConclusion =
  | 'MODEL_EFFECT'
  | 'OLLAMA_SERIALIZATION_EFFECT'
  | 'QUIRKYBOT_CONTEXT_EFFECT';

export interface ProviderRecallComparisonResult {
  readonly category: RecallComparisonCategory;
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

export interface RecallConclusionAssessment {
  readonly conclusion: RecallDiagnosticConclusion;
  readonly status: 'SUPPORTED' | 'INCONCLUSIVE';
  readonly rationale: string;
}

export interface ProviderRecallDiagnosticReport {
  readonly productionPath: readonly ProviderRecallComparisonResult[];
  readonly normalizedInputControl: readonly ProviderRecallComparisonResult[];
  readonly conclusions: readonly RecallConclusionAssessment[];
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
  const normalized = output.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  const identifiesCanonicalMessage = /안녕\s*\?/.test(normalized);
  const attributesMessageToUser =
    /(?:사용자|user|당신|너가|네가).{0,40}안녕\s*\?/.test(normalized) ||
    /안녕\s*\?.{0,40}(?:질문|물었|물어|말했|보냈)/.test(normalized);
  const attributesMessageToAssistant =
    /(?:assistant|어시스턴트|도우미).{0,40}안녕\s*\?/.test(normalized) ||
    /안녕\s*\?.{0,40}(?:assistant|어시스턴트|도우미).{0,20}(?:답|말|메시지)/.test(normalized);
  const deniesRecall =
    /(?:기억하지\s*못|기억할\s*수\s*없|알\s*수\s*없|모르겠|확인할\s*수\s*없)/.test(normalized);
  const isMetaClarification =
    /(?:말씀하시는|질문하신|물어보신)\s*(?:게|건|것은|내용이)\s*(?:맞나요|맞습니까|건가요|인가요)|(?:무엇|어떤)\s*질문|(?:구체적으로|다시)\s*말씀/.test(normalized);

  return identifiesCanonicalMessage && attributesMessageToUser &&
    !attributesMessageToAssistant && !deniesRecall && !isMetaClarification
    ? 'PASS'
    : 'FAIL';
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

function resultFor(
  category: RecallComparisonCategory,
  target: ComparisonTarget,
  serializedInput: string,
  generationLatencyMs: number,
  responseText: string,
  error: string | null,
): ProviderRecallComparisonResult {
  return Object.freeze({
    category,
    providerId: target.providerId,
    modelIdentity: target.modelIdentity,
    previousTurnPresentAtProviderBoundary: providerBoundaryContainsPreviousTurn(serializedInput),
    serializedInputCharacterCount: serializedInput.length,
    contextTruncationOccurred: CANONICAL_RECALL_SCENARIO.contextTruncationOccurred,
    generationLatencyMs,
    recallResult: error === null ? evaluateRecall(responseText) : 'FAIL',
    responseText,
    error,
  });
}

function assessConclusions(
  productionPath: readonly ProviderRecallComparisonResult[],
  normalizedInputControl: readonly ProviderRecallComparisonResult[],
): readonly RecallConclusionAssessment[] {
  const normalizedLlama = normalizedInputControl.find(({ modelIdentity }) => modelIdentity === 'llama3.1:8b');
  const normalizedGranite = normalizedInputControl.find(({ modelIdentity }) => modelIdentity === 'granite3.3:8b');
  const productionLlama = productionPath.find(({ modelIdentity }) => modelIdentity === 'llama3.1:8b');
  const modelEffect = normalizedLlama?.error === null && normalizedGranite?.error === null &&
    normalizedLlama.recallResult !== normalizedGranite.recallResult;
  const serializationEffect = productionLlama?.error === null && normalizedLlama?.error === null &&
    productionLlama.recallResult !== normalizedLlama.recallResult;

  return Object.freeze([
    Object.freeze({
      conclusion: 'MODEL_EFFECT' as const,
      status: modelEffect ? 'SUPPORTED' as const : 'INCONCLUSIVE' as const,
      rationale: modelEffect
        ? 'llama3.1 and granite3.3 differ when given the same finalized plain prompt serialization.'
        : 'The normalized controls did not produce a successful difference in recall outcome.',
    }),
    Object.freeze({
      conclusion: 'OLLAMA_SERIALIZATION_EFFECT' as const,
      status: serializationEffect ? 'SUPPORTED' as const : 'INCONCLUSIVE' as const,
      rationale: serializationEffect
        ? 'llama3.1 differs between its production serialization and the normalized plain prompt.'
        : 'llama3.1 did not produce a successful recall-outcome difference between serializations.',
    }),
    Object.freeze({
      conclusion: 'QUIRKYBOT_CONTEXT_EFFECT' as const,
      status: 'INCONCLUSIVE' as const,
      rationale: 'Both categories contain the same QuirkyBot-built context; no context-free control is run.',
    }),
  ]);
}

/**
 * Execute the controlled comparison when an authorized caller explicitly invokes it.
 * Importing this module never probes or executes a provider.
 */
export async function runComparison(
  options: ProviderRecallDiagnosticOptions = {},
): Promise<ProviderRecallDiagnosticReport> {
  const request = createCanonicalRecallRequest();
  const now = options.now ?? (() => performance.now());
  const targets = comparisonTargets(options);
  const productionPath: ProviderRecallComparisonResult[] = [];
  const normalizedInputControl: ProviderRecallComparisonResult[] = [];

  for (const target of targets) {
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

    productionPath.push(resultFor(
      'PRODUCTION_PATH', target, serializedInput, generationLatencyMs, responseText, error,
    ));
  }

  for (const target of targets.filter(({ providerId }) => providerId.startsWith('ollama-cli:'))) {
    const startedAt = now();
    let responseText = '';
    let error: string | null = null;
    try {
      responseText = (await target.provider.execute({
        ...request,
        // Non-chat capability bypasses only llama3.1's adapter-local role serialization.
        // Both Ollama models therefore receive request.prompt byte-for-byte.
        capability: Capability.SUMMARIZATION,
      })).text;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const generationLatencyMs = Math.max(0, Math.round(now() - startedAt));
    const serializedInput = target.getSerializedInput();
    normalizedInputControl.push(resultFor(
      'NORMALIZED_INPUT_CONTROL', target, serializedInput, generationLatencyMs, responseText, error,
    ));
  }

  return Object.freeze({
    productionPath: Object.freeze(productionPath),
    normalizedInputControl: Object.freeze(normalizedInputControl),
    conclusions: assessConclusions(productionPath, normalizedInputControl),
  });
}
