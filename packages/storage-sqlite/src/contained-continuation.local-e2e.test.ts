import { describe, expect, it, vi } from 'vitest';
import {
  ContinuationReceiverExecutionService, classifyProviderSpawnFailed, AgentProfileRegistry, ApprovalManager, ApprovalPolicy, Capability, ContinuationExecutionEntryService,
  ContinuationExecutionService, createWorkHandoff, ExecutionStatus,
  IntentType, RiskPolicy, RiskLevel, TaskManager, TaskRunStatus, WorkHandoffContinuationService, WorkItemStatus, agentProfileId,
} from '@quoky/core';
import type { ContinuationContainmentAudit, ExecutionPlan, TaskRun } from '@quoky/core';
import { SqliteStorageProvider } from './index';
import { createHash } from 'node:crypto';
import { assertExactSoleProviderSelection, createContainmentSecurityProfile, createContainmentInstanceIdentity,
  createContainmentCandidateBinding, prepareVerifiedContainmentBinding, PreparedContainmentExecution,
  createFakeContainedExecutionCapability } from '../../core/src/application/continuation-prepared-containment';
import type { ContainmentVerificationChannel } from '../../core/src/application/continuation-prepared-containment';
import type { ContinuationReceiverInput, ContinuationReceiverOutcome, ContainmentPostAttemptEvidence } from '@quoky/core';

const ts = '2026-09-26T00:00:00.000Z';
const HEX = (c: string) => c.repeat(64);

/** Build a real bound STARTED TaskRun using the canonical admission + guarded-start path (in-memory). */
async function fixture(storage: SqliteStorageProvider) {
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
  const request = { trigger: 'EXPLICIT_CONTINUATION_EXECUTION_REQUEST' as const,
    handoffId: 'handoff', taskId: task.id, actorId: 'actor', projectId: 'project', plan };
  return { tasks, profiles, continuation, request };
}

function prepared(runId: string) {
  const instance = createContainmentInstanceIdentity('fake-instance');
  const candidate = createContainmentCandidateBinding({
    selection: assertExactSoleProviderSelection({ eligibleProviderIds: ['fake-provider'], selectedProviderId: 'fake-provider', primaryOnly: true }),
    providerBindingDigest: HEX('a'), securityProfile: createContainmentSecurityProfile({ securityProfileId: 'deny-egress', securityProfileVersion: 'v1' }),
    expectedModelId: 'fake-model', expectedModelDigest: HEX('b'), imageDigest: HEX('c'), instance,
    executionContext: { executionId: runId, taskRunId: runId, containmentPolicyId: 'policy', containmentPolicyVersion: 'v1',
      containmentPolicyDigest: HEX('d'), runtimeFamily: 'NONE', runtimeVersion: 'fake-v1', modelMountIdentityDigest: HEX('e') },
  });
  const channel = (channel: 'A' | 'B'): ContainmentVerificationChannel => ({ channel, verify: subject => {
    const verifierVersion = `fake-${channel}-v1`;
    const shape = { verifierVersion, executionContext: subject.candidate.executionContext,
      providerId: subject.candidate.providerId, providerBindingDigest: subject.providerBindingDigest,
      securityProfileDigest: subject.securityProfileDigest, instanceIdentityDigest: subject.instanceIdentityDigest,
      expectedModelDigest: subject.expectedModelDigest, imageDigest: subject.candidate.imageDigest };
    return { status: 'VERIFIED', verifierVersion,
      resultDigest: createHash('sha256').update(JSON.stringify({ domain: `quoky.r3.containment.channel.${channel}.v1`, shape })).digest('hex') };
  } });
  return PreparedContainmentExecution.fromVerifiedBinding(prepareVerifiedContainmentBinding({ candidate,
    channelA: channel('A'), channelB: channel('B') }), createFakeContainedExecutionCapability(instance));
}

describe('R3-B2 fake-only prepared containment → persisted evidence → receiver terminalization', () => {
  it.each([
    { name: 'success', outcome: 'SUCCEEDED', expected: 'ATTEMPT_SUCCEEDED' },
    { name: 'failure', outcome: 'FAILED', expected: 'ATTEMPT_FAILED' },
    { name: 'integrity mismatch overrides success', outcome: 'SUCCEEDED', expected: 'ATTEMPT_UNRESOLVED', integrity: 'MISMATCH' },
    { name: 'integrity mismatch overrides failure', outcome: 'FAILED', expected: 'ATTEMPT_UNRESOLVED', integrity: 'MISMATCH' },
    { name: 'containment failure overrides success', outcome: 'SUCCEEDED', expected: 'ATTEMPT_UNRESOLVED', failure: 'CONTAINMENT_FAILURE' },
    { name: 'containment failure overrides failure', outcome: 'FAILED', expected: 'ATTEMPT_UNRESOLVED', failure: 'CONTAINMENT_FAILURE' },
    { name: 'download overrides success', outcome: 'SUCCEEDED', expected: 'ATTEMPT_UNRESOLVED', failure: 'MODEL_DOWNLOAD_DETECTED' },
    { name: 'download overrides failure', outcome: 'FAILED', expected: 'ATTEMPT_UNRESOLVED', failure: 'MODEL_DOWNLOAD_DETECTED' },
    { name: 'spawn before attempt', phase: 'PRE_ATTEMPT', positive: false, expected: 'ATTEMPT_FAILED' },
    { name: 'spawn positive pre-attempt evidence', phase: 'ATTEMPT_STARTED', positive: true, expected: 'ATTEMPT_FAILED' },
    { name: 'spawn uncertain', phase: 'ATTEMPT_STARTED', positive: false, expected: 'ATTEMPT_UNRESOLVED' },
    { name: 'spawn post attempt', phase: 'POST_ATTEMPT', positive: true, expected: 'ATTEMPT_UNRESOLVED' },
  ] as const)('$name', async scenario => {
    const storage = new SqliteStorageProvider({ dbPath: ':memory:' });
    await storage.init();
    try {
      const f = await fixture(storage);
      let audit!: ContinuationContainmentAudit;
      let stale!: TaskRun;
      const receiver = { supportedCapabilities: [Capability.GENERAL_CHAT],
        receive: async ({ taskRun }: ContinuationReceiverInput): Promise<ContinuationReceiverOutcome> => {
          stale = taskRun;
          const execution = prepared(taskRun.id);
          audit = execution.containmentAudit(taskRun.id);
          expect(() => execution.containmentAudit('another-attempt')).toThrow('EXACT_RUN_BINDING_MISMATCH');
          await expect(f.tasks.recordContainmentBindingIfAbsent(taskRun.id, prepared('another-attempt').containmentAudit('another-attempt')))
            .rejects.toMatchObject({ code: 'CONTAINMENT_EVIDENCE_CONFLICT' });
          await f.tasks.recordContainmentBindingIfAbsent(taskRun.id, audit);
          if ('phase' in scenario) {
            const disposition = classifyProviderSpawnFailed(scenario.phase, scenario.positive);
            return disposition === 'FAILED' ? { disposition, error: 'CONTINUATION_RECEIVER_FAILED' } : { disposition };
          }
          expect((await execution.execute({ prompt: 'offline' })).text).toContain('contained-fake:');
          const postAttempt: ContainmentPostAttemptEvidence = { attemptBoundaryCrossed: true,
            postAttemptModelIntegrity: 'integrity' in scenario ? scenario.integrity : 'MATCHED',
            failureCode: 'failure' in scenario ? scenario.failure : null };
          audit = { ...audit, postAttempt };
          await f.tasks.recordContainmentPostEvidenceIfAbsent(taskRun.id, audit);
          return scenario.outcome === 'SUCCEEDED' ? { disposition: 'SUCCEEDED', artifactIds: ['fake-artifact'] }
            : { disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED' };
        } };
      const terminal = vi.spyOn(f.tasks, 'terminalizePreservingSecurityEvidence');
      const complete = vi.spyOn(f.tasks, 'completeRun');
      const fail = vi.spyOn(f.tasks, 'failRun');
      const service = new ContinuationReceiverExecutionService(storage, f.profiles, f.continuation, f.tasks, receiver);
      const result = await service.executeExplicitContinuation(f.request);
      expect(result.disposition).toBe(scenario.expected);
      expect(stale.metadata?.containmentAudit).toBeUndefined(); // newer persisted evidence did not exist on caller snapshot
      expect(complete).not.toHaveBeenCalled(); expect(fail).not.toHaveBeenCalled();
      const persisted = await storage.taskRuns.get(stale.id);
      expect(persisted!.metadata?.containmentAudit).toEqual(audit);
      expect(persisted!.status).toBe(scenario.expected === 'ATTEMPT_UNRESOLVED' ? TaskRunStatus.STARTED
        : scenario.expected === 'ATTEMPT_SUCCEEDED' ? TaskRunStatus.SUCCEEDED : TaskRunStatus.FAILED);
      expect(terminal).toHaveBeenCalledTimes('phase' in scenario && scenario.expected === 'ATTEMPT_UNRESOLVED' ? 0 : 1);
      if (terminal.mock.calls.length) {
        expect(terminal.mock.calls[0]![0]).toBe(stale.id);
        if (result.disposition !== 'DENY') expect(result.taskRun).toEqual(persisted);
      }
      expect(audit.binding.providerBindingDigest).not.toBe(audit.binding.containmentBindingDigest);
      expect(audit.binding).toMatchObject({ executionId: stale.id, taskRunId: stale.id, runtimeFamily: 'NONE',
        securityProfileId: 'deny-egress', channelAVerifierVersion: 'fake-A-v1', channelBVerifierVersion: 'fake-B-v1' });
    } finally { await storage.close(); }
  });
});
