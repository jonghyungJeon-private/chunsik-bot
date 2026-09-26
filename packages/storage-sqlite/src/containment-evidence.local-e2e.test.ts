import { describe, expect, it } from 'vitest';
import {
  AgentProfileRegistry, ApprovalManager, ApprovalPolicy, Capability, ContinuationExecutionEntryService,
  ContinuationExecutionService, CONTINUATION_CONTAINMENT_AUDIT_SCHEMA, createWorkHandoff, ExecutionStatus,
  IntentType, RiskPolicy, RiskLevel, TaskManager, TaskRunStatus, WorkHandoffContinuationService, WorkItemStatus, agentProfileId,
} from '@quoky/core';
import type { ContinuationContainmentAudit, ExecutionPlan, TaskRun } from '@quoky/core';
import { SqliteStorageProvider } from './index';

const ts = '2026-09-26T00:00:00.000Z';
const HEX = (c: string) => c.repeat(64);

/** Build a real bound STARTED TaskRun using the canonical admission + guarded-start path (in-memory). */
async function boundStartedRun(storage: SqliteStorageProvider): Promise<{ tasks: TaskManager; run: TaskRun }> {
  await storage.workItems.save({ id: 'work', actorId: 'actor', projectId: 'project', status: WorkItemStatus.ACTIVE,
    origin: 'conversation', resourceRefs: [], createdAt: ts, updatedAt: ts });
  await storage.workHandoffs.insert(createWorkHandoff({ id: 'handoff', workItemId: 'work',
    fromAgentProfileId: agentProfileId('source'), toAgentProfileId: agentProfileId('receiver'), objective: 'continue',
    resourceRefs: [], artifactIds: [], executionReceiptIds: [], createdAt: ts }));
  const profiles = new AgentProfileRegistry(['source', 'receiver'].map(id => ({ id: agentProfileId(id), displayName: id, role: id, purpose: id, instructions: id })));
  const tasks = new TaskManager(storage);
  const approvals = new ApprovalManager(storage, new ApprovalPolicy(new RiskPolicy()));
  let task = await tasks.createTask({ type: IntentType.CHAT, capability: Capability.GENERAL_CHAT, confidence: 1,
    requiresWork: true, summary: 'continue' }, { platform: 'test', channelId: 'channel', userId: 'user' },
    { actorId: 'actor', projectId: 'project', requestText: 'continue' });
  const plan: ExecutionPlan = { id: 'plan', goal: 'continue', summary: 'continue', projectId: 'project', steps: [],
    requiredCapabilities: [Capability.GENERAL_CHAT], requiredResources: [], estimatedChanges: { fileCount: 0, scope: 'none' },
    approvalRequired: false, overallRisk: RiskLevel.LOW, expectedArtifacts: [], status: ExecutionStatus.PENDING, createdAt: ts };
  task = await storage.tasks.save({ ...task, planId: plan.id });
  const preparation = new WorkHandoffContinuationService(storage, profiles, storage.continuationBindings, { tasks, approvals });
  await preparation.admit('handoff', task.id);
  const entry = new ContinuationExecutionEntryService(storage, profiles, storage.continuationBindings, tasks);
  const continuation = new ContinuationExecutionService(storage, profiles, storage.continuationBindings, preparation, entry);
  const started = await continuation.startExplicitContinuation({ trigger: 'EXPLICIT_CONTINUATION_EXECUTION_REQUEST',
    handoffId: 'handoff', taskId: task.id, actorId: 'actor', projectId: 'project', plan });
  if (started.disposition !== 'ATTEMPT_STARTED') throw new Error(`expected ATTEMPT_STARTED, got ${started.disposition}`);
  return { tasks, run: started.taskRun };
}

function containmentAudit(runId: string, overrides: Partial<ContinuationContainmentAudit> = {}): ContinuationContainmentAudit {
  return {
    schemaVersion: CONTINUATION_CONTAINMENT_AUDIT_SCHEMA,
    binding: {
      executionId: runId, taskRunId: runId, containmentPolicyId: 'policy-1', containmentPolicyVersion: 'v1',
      containmentPolicyDigest: HEX('a'), containmentBindingDigest: HEX('b'), providerId: 'ollama-local',
      modelId: 'llama3:8b', modelDigest: HEX('c'), imageDigest: HEX('d'), runtimeFamily: 'NONE', runtimeVersion: 'v0',
      securityProfileDigest: HEX('e'), modelMountIdentityDigest: HEX('f'), verifierVersion: 'verifier-1',
      channelAResultDigest: HEX('0'), channelBResultDigest: HEX('1'), preflightDisposition: 'VERIFIED',
      modelIntegrityStatus: 'VERIFIED_AT_BIND',
    },
    ...overrides,
  } as ContinuationContainmentAudit;
}

async function withStorage<T>(fn: (s: SqliteStorageProvider) => Promise<T>): Promise<T> {
  const storage = new SqliteStorageProvider({ dbPath: ':memory:' });
  await storage.init();
  try { return await fn(storage); } finally { await storage.close(); }
}

describe('R3-A containment evidence persistence (in-memory adapter)', () => {
  it('records binding when absent, is idempotent for identical, rejects a different binding', async () => {
    await withStorage(async storage => {
      const { run } = await boundStartedRun(storage);
      const a = containmentAudit(run.id);
      const recorded = await storage.taskRuns.recordContainmentBindingIfAbsent(run.id, a);
      expect(recorded.status).toBe(TaskRunStatus.STARTED);
      expect((recorded.metadata as Record<string, unknown>).containmentAudit).toBeTruthy();
      // idempotent
      await expect(storage.taskRuns.recordContainmentBindingIfAbsent(run.id, a)).resolves.toBeTruthy();
      // different digest → reject
      const b = containmentAudit(run.id, { binding: { ...a.binding, containmentBindingDigest: HEX('9') } });
      await expect(storage.taskRuns.recordContainmentBindingIfAbsent(run.id, b))
        .rejects.toMatchObject({ code: 'CONTAINMENT_EVIDENCE_CONFLICT', reason: 'BINDING_DIGEST_CONFLICT' });
    });
  });

  it('appends post-attempt evidence once; idempotent identical; rejects different; rejects when binding missing', async () => {
    await withStorage(async storage => {
      const { run } = await boundStartedRun(storage);
      const post = containmentAudit(run.id, { postAttempt: { attemptBoundaryCrossed: true, postAttemptModelIntegrity: 'MATCHED', failureCode: null } });
      // binding missing → reject
      await expect(storage.taskRuns.recordContainmentPostEvidenceIfAbsent(run.id, post))
        .rejects.toMatchObject({ reason: 'BINDING_MISSING' });
      await storage.taskRuns.recordContainmentBindingIfAbsent(run.id, containmentAudit(run.id));
      await expect(storage.taskRuns.recordContainmentPostEvidenceIfAbsent(run.id, post)).resolves.toBeTruthy();
      await expect(storage.taskRuns.recordContainmentPostEvidenceIfAbsent(run.id, post)).resolves.toBeTruthy(); // idempotent
      const other = containmentAudit(run.id, { postAttempt: { attemptBoundaryCrossed: true, postAttemptModelIntegrity: 'MISMATCH', failureCode: 'MODEL_DIGEST_MISMATCH' } });
      await expect(storage.taskRuns.recordContainmentPostEvidenceIfAbsent(run.id, other))
        .rejects.toMatchObject({ reason: 'POST_ATTEMPT_CONFLICT' });
    });
  });

  it('rejects recording on a non-STARTED / missing run', async () => {
    await withStorage(async storage => {
      await expect(storage.taskRuns.recordContainmentBindingIfAbsent('missing', containmentAudit('missing')))
        .rejects.toMatchObject({ reason: 'RUN_NOT_FOUND' });
    });
  });

  it('A-1: generic save cannot remove or mutate containment evidence on a bound run', async () => {
    await withStorage(async storage => {
      const { run } = await boundStartedRun(storage);
      const withBinding = await storage.taskRuns.recordContainmentBindingIfAbsent(run.id, containmentAudit(run.id));
      // remove evidence via generic save
      const stripped: TaskRun = { ...withBinding, metadata: {} };
      await expect(storage.taskRuns.save(stripped)).rejects.toMatchObject({ code: 'CONTAINMENT_EVIDENCE_CONFLICT' });
      // mutate binding digest via generic save
      const mutatedAudit = containmentAudit(run.id, { binding: { ...containmentAudit(run.id).binding, containmentBindingDigest: HEX('9') } });
      const mutated: TaskRun = { ...withBinding, metadata: { containmentAudit: mutatedAudit } };
      await expect(storage.taskRuns.save(mutated)).rejects.toMatchObject({ code: 'CONTAINMENT_EVIDENCE_CONFLICT' });
      // identical preservation via generic save is allowed
      await expect(storage.taskRuns.save(withBinding)).resolves.toBeTruthy();
    });
  });

  it('terminal merge preserves evidence for SUCCEEDED and FAILED; UNRESOLVED stays STARTED', async () => {
    await withStorage(async storage => {
      const { run } = await boundStartedRun(storage);
      await storage.taskRuns.recordContainmentBindingIfAbsent(run.id, containmentAudit(run.id));
      // UNRESOLVED path: no terminalization → still STARTED with durable evidence
      const stillStarted = await storage.taskRuns.get(run.id);
      expect(stillStarted!.status).toBe(TaskRunStatus.STARTED);
      expect((stillStarted!.metadata as Record<string, unknown>).containmentAudit).toBeTruthy();
      // SUCCEEDED terminal merge from CURRENT row preserves containment + adds routingAudit metadata
      const succeeded = await storage.taskRuns.terminalizePreservingSecurityEvidence(run.id, {
        terminalStatus: 'SUCCEEDED', finishedAt: ts, artifactIds: ['artifact-1'], metadata: { routingAudit: { note: 'x' } },
      });
      expect(succeeded.status).toBe(TaskRunStatus.SUCCEEDED);
      expect((succeeded.metadata as Record<string, unknown>).containmentAudit).toBeTruthy();
      expect((succeeded.metadata as Record<string, unknown>).routingAudit).toEqual({ note: 'x' });
      expect(succeeded.artifactIds).toEqual(['artifact-1']);
    });
  });

  it('FAILED terminal merge preserves containment evidence', async () => {
    await withStorage(async storage => {
      const { run } = await boundStartedRun(storage);
      await storage.taskRuns.recordContainmentBindingIfAbsent(run.id, containmentAudit(run.id));
      const failed = await storage.taskRuns.terminalizePreservingSecurityEvidence(run.id, {
        terminalStatus: 'FAILED', finishedAt: ts, error: 'CONTINUATION_RECEIVER_FAILED', metadata: { routingAudit: { note: 'y' } },
      });
      expect(failed.status).toBe(TaskRunStatus.FAILED);
      expect((failed.metadata as Record<string, unknown>).containmentAudit).toBeTruthy();
      expect(failed.error).toBe('CONTINUATION_RECEIVER_FAILED');
    });
  });
});
