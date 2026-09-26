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
  ContinuationProviderRouting,
  ContinuationProviderRoutingResult,
  ContinuationReceiverInput,
  ContinuationRoutingAudit,
  ExecutionPlan,
  TaskRun,
} from '@quoky/core';
import { snapshotReceiverOutcome } from '../../../../packages/core/src/application/continuation-receiver-validation';
import {
  ProviderBackedContinuationReceiver,
  type ContinuationArtifactSink,
} from './provider-backed-continuation-receiver';

const ts = '2026-09-26T00:00:00.000Z';
const executionId = 'task-run-1';

function input(overrides: { capability?: Capability; intentType?: IntentType } = {}): ContinuationReceiverInput {
  const handoff = createWorkHandoff({
    id: 'handoff',
    workItemId: 'work',
    fromAgentProfileId: agentProfileId('source'),
    toAgentProfileId: agentProfileId('receiver'),
    objective: 'Summarize project status.',
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
    capability: overrides.capability ?? Capability.GENERAL_CHAT,
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
    boundTaskFacts: {
      capability: overrides.capability ?? Capability.GENERAL_CHAT,
      intentType: overrides.intentType ?? IntentType.CHAT,
    },
  } as ContinuationReceiverInput;
}

function acceptedAudit(): ContinuationRoutingAudit {
  return {
    schemaVersion: 'continuation-routing-audit-v1',
    executionId,
    matchedPolicyId: 'stage2b-continuation-general-chat-v1',
    policyVersion: '1',
    configurationVersion: 'stage2b-production-routing-config-v1',
    policyDigest: 'a'.repeat(64),
    configurationDigest: 'b'.repeat(64),
    terminalStatus: 'ACCEPTED',
    terminalCode: null,
    attemptCount: 1,
    attemptCountKnown: true,
    attempts: [
      {
        index: 1,
        path: 'PRIMARY',
        providerId: 'ollama-cli:llama3.1:8b',
        outcome: 'VALIDATION_ACCEPTED',
        failureCode: null,
        validationDisposition: 'ACCEPT',
        validationReasonCodes: [],
        responseSha256: 'c'.repeat(64),
        byteCount: 42,
        durationMs: 5,
        dispatchEvidence: 'RETURNED',
      },
    ],
    finalAcceptedProviderId: 'ollama-cli:llama3.1:8b',
    dispatchEvidence: 'RETURNED',
    transitions: [{ sequence: 1, evidence: 'DISPATCHED', code: null }],
  };
}

function fakeRouting(result: ContinuationProviderRoutingResult): ContinuationProviderRouting {
  return { execute: vi.fn(async () => result) };
}

function sink(overrides: Partial<ContinuationArtifactSink> = {}): {
  sink: ContinuationArtifactSink;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async (i: Parameters<ContinuationArtifactSink['create']>[0]): Promise<Artifact> => ({
    id: 'platform-artifact-1',
    kind: i.kind,
    title: i.title,
    createdAt: ts,
    ...(i.content !== undefined ? { content: i.content } : {}),
    ...(i.taskId ? { taskId: i.taskId } : {}),
    ...(i.taskRunId ? { taskRunId: i.taskRunId } : {}),
  }));
  return { sink: { create, ...overrides } as ContinuationArtifactSink, create };
}

function receiver(routing: ContinuationProviderRouting, artifactSink: ContinuationArtifactSink) {
  return new ProviderBackedContinuationReceiver({
    promptComposer: new PromptComposer(),
    promptRenderer: new PromptRenderer(),
    routing,
    artifactManager: artifactSink,
  });
}

describe('ProviderBackedContinuationReceiver (R2)', () => {
  it('supports exactly GENERAL_CHAT', () => {
    const r = receiver(fakeRouting({ disposition: 'FAILED', audit: acceptedAudit() }), sink().sink);
    expect(r.supportedCapabilities).toEqual([Capability.GENERAL_CHAT]);
  });

  it('ACCEPTED → persists exactly one platform-owned MARKDOWN_REPORT bound to the exact run (§27)', async () => {
    const routing = fakeRouting({
      disposition: 'ACCEPTED',
      output: { text: 'answer', artifacts: [], responseSha256: 'c'.repeat(64), byteCount: 42 },
      acceptedProviderId: 'ollama-cli:llama3.1:8b',
      audit: acceptedAudit(),
    });
    const s = sink();
    const outcome = await receiver(routing, s.sink).receive(input());
    expect(outcome.disposition).toBe('SUCCEEDED');
    expect(s.create).toHaveBeenCalledTimes(1);
    const created = s.create.mock.calls[0]![0];
    expect(created.kind).toBe(ArtifactKind.MARKDOWN_REPORT);
    expect(created.mimeType).toBe('text/markdown');
    expect(created.content).toBe('answer');
    expect(created.taskId).toBe('task-1');
    expect(created.taskRunId).toBe(executionId);
    if (outcome.disposition !== 'SUCCEEDED') throw new Error('unreachable');
    expect(outcome.artifactIds).toEqual(['platform-artifact-1']);
  });

  it('produces an R1-valid SUCCEEDED outcome (snapshotReceiverOutcome accepts it, §26)', async () => {
    const routing = fakeRouting({
      disposition: 'ACCEPTED',
      output: { text: 'answer', artifacts: [], responseSha256: 'c'.repeat(64), byteCount: 42 },
      acceptedProviderId: 'ollama-cli:llama3.1:8b',
      audit: acceptedAudit(),
    });
    const outcome = await receiver(routing, sink().sink).receive(input());
    const snapshot = snapshotReceiverOutcome(outcome, executionId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.disposition).toBe('SUCCEEDED');
  });

  it('ignores Provider-supplied artifact ownership; only validated text is persisted (§28)', async () => {
    const routing = fakeRouting({
      disposition: 'ACCEPTED',
      output: {
        text: 'answer',
        // A Provider-fabricated artifact with foreign ids/uri — must be ignored.
        artifacts: [
          { id: 'provider-forged', kind: ArtifactKind.MARKDOWN_REPORT, title: 't', createdAt: ts, taskId: 'evil' } as never,
        ],
        responseSha256: 'c'.repeat(64),
        byteCount: 42,
      },
      acceptedProviderId: 'ollama-cli:llama3.1:8b',
      audit: acceptedAudit(),
    });
    const s = sink();
    const outcome = await receiver(routing, s.sink).receive(input());
    if (outcome.disposition !== 'SUCCEEDED') throw new Error('expected success');
    expect(outcome.artifactIds).toEqual(['platform-artifact-1']);
    expect(s.create.mock.calls[0]![0].taskId).toBe('task-1'); // platform-owned, not 'evil'
  });

  it('Artifact save failure → FAILED, no fabricated success (§29)', async () => {
    const routing = fakeRouting({
      disposition: 'ACCEPTED',
      output: { text: 'answer', artifacts: [], responseSha256: 'c'.repeat(64), byteCount: 42 },
      acceptedProviderId: 'ollama-cli:llama3.1:8b',
      audit: acceptedAudit(),
    });
    const failingSink: ContinuationArtifactSink = { create: vi.fn(async () => { throw new Error('disk full'); }) };
    const outcome = await receiver(routing, failingSink).receive(input());
    expect(outcome.disposition).toBe('FAILED');
    if (outcome.disposition !== 'FAILED') throw new Error('unreachable');
    expect(outcome.error).toBe('CONTINUATION_RECEIVER_FAILED');
  });

  it('routing FAILED → receiver FAILED with audit', async () => {
    const audit = { ...acceptedAudit(), terminalStatus: 'PRE_DISPATCH_FAILED' as const, terminalCode: 'NO_ELIGIBLE_PROVIDER' as const,
      attemptCount: 0 as const, attempts: [], finalAcceptedProviderId: null, dispatchEvidence: 'NOT_DISPATCHED' as const };
    const outcome = await receiver(fakeRouting({ disposition: 'FAILED', audit }), sink().sink).receive(input());
    expect(outcome.disposition).toBe('FAILED');
    expect(snapshotReceiverOutcome(outcome, executionId)).not.toBeNull();
  });

  it('routing UNRESOLVED → receiver UNRESOLVED with audit', async () => {
    const audit = { ...acceptedAudit(), terminalStatus: 'EXECUTION_FAILED' as const, terminalCode: 'PROVIDER_TIMEOUT' as const,
      attempts: [{ ...acceptedAudit().attempts[0]!, outcome: 'PROVIDER_FAILED' as const, failureCode: 'PROVIDER_TIMEOUT' as const,
        validationDisposition: null, responseSha256: null, byteCount: null, dispatchEvidence: 'DISPATCHED' as const }],
      finalAcceptedProviderId: null, dispatchEvidence: 'DISPATCHED' as const };
    const outcome = await receiver(fakeRouting({ disposition: 'UNRESOLVED', audit }), sink().sink).receive(input());
    expect(outcome.disposition).toBe('UNRESOLVED');
    expect(snapshotReceiverOutcome(outcome, executionId)).not.toBeNull();
  });

  it('unsupported capability preflight → bounded FAILED without calling routing (§22)', async () => {
    const routing = fakeRouting({ disposition: 'ACCEPTED', audit: acceptedAudit() });
    const outcome = await receiver(routing, sink().sink).receive(input({ capability: Capability.CODE_IMPLEMENTATION }));
    expect(outcome.disposition).toBe('FAILED');
    expect(routing.execute).not.toHaveBeenCalled();
  });

  it('non-CHAT intent preflight → bounded FAILED (§22)', async () => {
    const routing = fakeRouting({ disposition: 'ACCEPTED', audit: acceptedAudit() });
    const outcome = await receiver(routing, sink().sink).receive(input({ intentType: IntentType.SUMMARIZE }));
    expect(outcome.disposition).toBe('FAILED');
    expect(routing.execute).not.toHaveBeenCalled();
  });

  it('never terminalizes: no TaskManager/StorageProvider dependency and returns an outcome only (§30)', async () => {
    const routing = fakeRouting({
      disposition: 'ACCEPTED',
      output: { text: 'answer', artifacts: [], responseSha256: 'c'.repeat(64), byteCount: 42 },
      acceptedProviderId: 'ollama-cli:llama3.1:8b',
      audit: acceptedAudit(),
    });
    const s = sink();
    const r = receiver(routing, s.sink);
    const outcome = await r.receive(input());
    // The receiver's only mutation is the single Artifact create; it produces an outcome and nothing else.
    expect(outcome.disposition).toBe('SUCCEEDED');
    expect(s.create).toHaveBeenCalledTimes(1);
  });

  it('forwards the validation corpus as contextFiles to routing', async () => {
    const routing = fakeRouting({
      disposition: 'ACCEPTED',
      output: { text: 'answer', artifacts: [], responseSha256: 'c'.repeat(64), byteCount: 42 },
      acceptedProviderId: 'ollama-cli:llama3.1:8b',
      audit: acceptedAudit(),
    });
    await receiver(routing, sink().sink).receive(input());
    const call = (routing.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.request.contextFiles?.length).toBeGreaterThan(0);
    expect(call.executionId).toBe(executionId);
    expect(call.facts).toEqual({ capability: Capability.GENERAL_CHAT, intentType: IntentType.CHAT });
  });
});
