import { describe, expect, it, vi } from 'vitest';
import {
  ArtifactKind,
  Capability,
  IntentType,
  PromptComposer,
  PromptRenderer,
  agentProfileId,
  createWorkHandoff,
} from '@quoky/core';
import type {
  Artifact,
  ContinuationReceiverInput,
  ExecutionPlan,
  TaskRun,
} from '@quoky/core';
import { OllamaCliProvider } from '@quoky/ai-cli';
import type { CliRunner, CliRunResult } from '@quoky/ai-cli';
import { snapshotReceiverOutcome } from '../../../../packages/core/src/application/continuation-receiver-validation';
import {
  ContinuationReceiverActivationError,
  ContinuationReceiverActivationErrorCode,
  createProductionContinuationReceiverActivation,
  parseContinuationReceiverMode,
} from './continuation-receiver-activation';
import type { ContinuationContainment } from './continuation-receiver-activation';
import {
  BALANCED_PROVIDER_ID,
  OLLAMA_ADAPTER_ID,
  ProviderCandidateRole,
  SEMANTIC_PROVIDER_ID,
  buildProductionProviderRoutingConfiguration,
} from '../provider-routing/production-provider-routing-config';
import type { ProductionProviderDefinition } from '../provider-routing/production-provider-routing-config';

const ts = '2026-09-26T00:00:00.000Z';
const executionId = 'task-run-1';

describe('parseContinuationReceiverMode (§31)', () => {
  it('missing and exact "disabled" both map to disabled', () => {
    expect(parseContinuationReceiverMode(undefined)).toBe('disabled');
    expect(parseContinuationReceiverMode('disabled')).toBe('disabled');
  });
  it('accepts only the exact "general-chat-v1" token', () => {
    expect(parseContinuationReceiverMode('general-chat-v1')).toBe('general-chat-v1');
  });
  it.each(['', ' ', ' disabled ', 'DISABLED', 'General-Chat-v1', 'true', '1', 'yes', 'enabled', 'on'])(
    'rejects malformed/boolean-ish value %j with the typed code',
    (raw) => {
      expect(() => parseContinuationReceiverMode(raw)).toThrow('CONTINUATION_RECEIVER_INVALID_MODE');
    },
  );
});

describe('createProductionContinuationReceiverActivation (§32/§33/§34)', () => {
  const ollama = { ollamaBin: '/approved/ollama' };
  const verifiedContainment: ContinuationContainment = { verify: () => ({ status: 'verified' }) };

  it('disabled → binding absent (undefined)', () => {
    expect(createProductionContinuationReceiverActivation({ mode: 'disabled', ollama })).toBeUndefined();
  });

  it('general-chat-v1 without containment → startup fail-closed (§33)', () => {
    expect(() =>
      createProductionContinuationReceiverActivation({ mode: 'general-chat-v1', ollama }),
    ).toThrow(ContinuationReceiverActivationError);
    try {
      createProductionContinuationReceiverActivation({ mode: 'general-chat-v1', ollama });
    } catch (error) {
      expect((error as ContinuationReceiverActivationError).code).toBe(
        ContinuationReceiverActivationErrorCode.CONTAINMENT_UNAVAILABLE,
      );
    }
  });

  it('general-chat-v1 with unverified containment → fail-closed', () => {
    expect(() =>
      createProductionContinuationReceiverActivation({
        mode: 'general-chat-v1',
        ollama,
        containment: { verify: () => ({ status: 'unverified' }) },
        artifactManager: { create: async () => ({} as Artifact) },
      }),
    ).toThrow('CONTINUATION_RECEIVER_CONTAINMENT_UNVERIFIED');
  });

  it('general-chat-v1 with verified containment but missing artifact dependency → fail-closed', () => {
    expect(() =>
      createProductionContinuationReceiverActivation({
        mode: 'general-chat-v1',
        ollama,
        containment: verifiedContainment,
      }),
    ).toThrow('CONTINUATION_RECEIVER_DEPENDENCY_MISSING');
  });

  it('general-chat-v1 with a verified fake containment + fakes → composes a receiver (§34)', () => {
    const receiver = createProductionContinuationReceiverActivation({
      mode: 'general-chat-v1',
      ollama,
      containment: verifiedContainment,
      artifactManager: { create: async (i) => ({ id: 'a1', kind: i.kind, title: i.title, createdAt: ts }) },
      createConfiguration: () => buildFakeConfiguration(),
    });
    expect(receiver).toBeDefined();
    expect(receiver?.supportedCapabilities).toEqual([Capability.GENERAL_CHAT]);
  });
});

/** Fake offline provider: never spawns; controllable output. */
class FakeProvider {
  readonly id: string;
  readonly capabilities = [];
  constructor(id: string, private readonly response = 'A concise continuation answer.') {
    this.id = id;
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async execute(): Promise<{ text: string }> {
    return { text: this.response };
  }
}

function buildFakeConfiguration() {
  const definitions: readonly [ProductionProviderDefinition, ProductionProviderDefinition] = [
    {
      providerId: BALANCED_PROVIDER_ID,
      adapterId: OLLAMA_ADAPTER_ID,
      modelId: 'llama3.1:8b',
      candidateRole: ProviderCandidateRole.BALANCED_PRIMARY,
      provider: new FakeProvider(BALANCED_PROVIDER_ID) as never,
    },
    {
      providerId: SEMANTIC_PROVIDER_ID,
      adapterId: OLLAMA_ADAPTER_ID,
      modelId: 'granite3.3:8b',
      candidateRole: ProviderCandidateRole.SEMANTIC_CANDIDATE,
      provider: new FakeProvider(SEMANTIC_PROVIDER_ID) as never,
    },
  ];
  return buildProductionProviderRoutingConfiguration(definitions);
}

function receiverInput(): ContinuationReceiverInput {
  const handoff = createWorkHandoff({
    id: 'handoff',
    workItemId: 'work',
    fromAgentProfileId: agentProfileId('source'),
    toAgentProfileId: agentProfileId('receiver'),
    objective: 'Summarize project status for the team.',
    resourceRefs: [],
    artifactIds: [],
    executionReceiptIds: [],
    createdAt: ts,
  });
  const plan: ExecutionPlan = {
    id: 'plan',
    goal: 'Status summary',
    summary: 'summary',
    steps: [],
    requiredCapabilities: [Capability.GENERAL_CHAT],
    requiredResources: [],
    estimatedChanges: { fileCount: 0, scope: 'none' },
    approvalRequired: false,
    overallRisk: 'LOW' as ExecutionPlan['overallRisk'],
    expectedArtifacts: [],
    status: 'PENDING' as ExecutionPlan['status'],
    createdAt: ts,
  };
  const taskRun: TaskRun = {
    id: executionId,
    taskId: 'task-1',
    attempt: 1,
    status: 'STARTED' as TaskRun['status'],
    capability: Capability.GENERAL_CHAT,
    artifactIds: [],
    startedAt: ts,
  };
  return {
    handoff,
    destinationAgentProfile: {
      id: agentProfileId('receiver'),
      displayName: 'Receiver',
      role: 'Assistant',
      purpose: 'Continue work',
      instructions: 'Persona only.',
    },
    plan,
    taskRun,
    boundTaskFacts: { capability: Capability.GENERAL_CHAT, intentType: IntentType.CHAT },
  } as ContinuationReceiverInput;
}

describe('end-to-end enabled composition (offline, fake runner) — no conversation reframe (§16/§36)', () => {
  it('drives the real Ollama adapter with a fake CliRunner and is NOT reframed', async () => {
    const captured: { input: string }[] = [];
    const runner: CliRunner = async (_bin, _args, options): Promise<CliRunResult> => {
      captured.push({ input: options.input });
      return { code: 0, stdout: 'A concise continuation answer.', stderr: '', timedOut: false };
    };
    // Build a production config whose BALANCED provider is a real OllamaCliProvider with a FAKE runner.
    const definitions: readonly [ProductionProviderDefinition, ProductionProviderDefinition] = [
      {
        providerId: BALANCED_PROVIDER_ID,
        adapterId: OLLAMA_ADAPTER_ID,
        modelId: 'llama3.1:8b',
        candidateRole: ProviderCandidateRole.BALANCED_PRIMARY,
        provider: new OllamaCliProvider({ model: 'llama3.1:8b', providerId: BALANCED_PROVIDER_ID, runner }),
      },
      {
        providerId: SEMANTIC_PROVIDER_ID,
        adapterId: OLLAMA_ADAPTER_ID,
        modelId: 'granite3.3:8b',
        candidateRole: ProviderCandidateRole.SEMANTIC_CANDIDATE,
        provider: new OllamaCliProvider({ model: 'granite3.3:8b', providerId: SEMANTIC_PROVIDER_ID, runner }),
      },
    ];
    const configuration = buildProductionProviderRoutingConfiguration(definitions);
    const create = vi.fn(async (i: { kind: ArtifactKind; title: string; content?: string; taskId?: string; taskRunId?: string }): Promise<Artifact> => ({
      id: 'platform-artifact-1',
      kind: i.kind,
      title: i.title,
      createdAt: ts,
      ...(i.content !== undefined ? { content: i.content } : {}),
    }));
    const receiver = createProductionContinuationReceiverActivation({
      mode: 'general-chat-v1',
      ollama: { ollamaBin: '/approved/ollama' },
      containment: { verify: () => ({ status: 'verified' }) },
      promptComposer: new PromptComposer(),
      promptRenderer: new PromptRenderer(),
      artifactManager: { create } as never,
      createConfiguration: () => configuration,
    });
    expect(receiver).toBeDefined();

    const outcome = await receiver!.receive(receiverInput());
    expect(outcome.disposition).toBe('SUCCEEDED');
    // R1 accepts the produced outcome and audit.
    expect(snapshotReceiverOutcome(outcome, executionId)).not.toBeNull();
    // Exactly one prompt was dispatched to execute() (the rest are `ollama --version` availability
    // probes with empty stdin). That single prompt was NOT reframed as a conversation turn.
    const dispatched = captured.filter((entry) => entry.input.length > 0);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.input).not.toContain('User (current active turn):');
    expect(dispatched[0]!.input).not.toContain('Previous conversation (history only');
    expect(dispatched[0]!.input).not.toContain('## 3. Conversation transcript');
    expect(dispatched[0]!.input).toContain('Continuation request');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
