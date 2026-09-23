import { describe, expect, it, vi } from 'vitest';
import { AgentProfileRegistry, agentProfileId, ApprovalManager, ApprovalPolicy, Capability,
  ContinuationExecutionEntryService, ContinuationExecutionService, ContinuationReceiverExecutionService,
  createWorkHandoff, ExecutionStatus, IntentType, RiskLevel, RiskPolicy, TaskManager, TaskRunStatus,
  TaskStatus, WorkHandoffContinuationService, WorkItemStatus } from '@quoky/core';
import type { ContinuationExecutionRequestContext, ContinuationReceiverInput, ContinuationReceiverOutcome, ExecutionPlan } from '@quoky/core';
import { SqliteStorageProvider } from './index';

const ts = '2026-09-22T00:00:00.000Z';
describe('M3E-6K offline exact-run persistence with real 6J and fake receiver', () => {
  it.each(['SUCCEEDED', 'FAILED', 'THROW'] as const)('persists exact %s outcome without Task terminalization', async mode => {
    const storage = new SqliteStorageProvider({ dbPath: ':memory:' });
    await storage.init();
    try {
      await storage.workItems.save({ id: 'work', actorId: 'actor', projectId: 'project', status: WorkItemStatus.ACTIVE,
        origin: 'conversation', resourceRefs: [], createdAt: ts, updatedAt: ts });
      await storage.workHandoffs.insert(createWorkHandoff({ id: 'handoff', workItemId: 'work',
        fromAgentProfileId: agentProfileId('source'), toAgentProfileId: agentProfileId('receiver'), objective: 'continue',
        resourceRefs: [], artifactIds: [], executionReceiptIds: [], createdAt: ts }));
      const profiles = new AgentProfileRegistry(['source', 'receiver'].map(id => ({ id: agentProfileId(id), displayName: id,
        role: id, purpose: id, instructions: id })));
      const tasks = new TaskManager(storage);
      const approvals = new ApprovalManager(storage, new ApprovalPolicy(new RiskPolicy()));
      let task = await tasks.createTask({ type: IntentType.CHAT, capability: Capability.GENERAL_CHAT, confidence: 1,
        requiresWork: true, summary: 'continue' }, { platform: 'test', channelId: 'channel', userId: 'user' },
      { actorId: 'actor', projectId: 'project', requestText: 'continue' });
      const plan: ExecutionPlan = { id: 'plan', goal: 'continue', summary: 'continue', projectId: 'project', steps: [],
        requiredCapabilities: [Capability.GENERAL_CHAT], requiredResources: [], estimatedChanges: { fileCount: 0, scope: 'none' },
        approvalRequired: false, overallRisk: RiskLevel.LOW,
        expectedArtifacts: [], status: ExecutionStatus.PENDING, createdAt: ts };
      task = await storage.tasks.save({ ...task, planId: plan.id });

      const preparation = new WorkHandoffContinuationService(storage, profiles, storage.continuationBindings, { tasks, approvals });
      await preparation.admit('handoff', task.id);
      const entry = new ContinuationExecutionEntryService(storage, profiles, storage.continuationBindings, tasks);
      const continuation = new ContinuationExecutionService(storage, profiles, storage.continuationBindings, preparation, entry);
      const receiver = { receive: vi.fn(async (_input: ContinuationReceiverInput): Promise<ContinuationReceiverOutcome> => {
        if (mode === 'THROW') throw new Error('SENSITIVE_SENTINEL');
        return mode === 'SUCCEEDED' ? { disposition: 'SUCCEEDED', artifactIds: ['artifact-1'] }
          : { disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED' };
      }) };
      const execution = new ContinuationReceiverExecutionService(storage, profiles, continuation, tasks, receiver);
      const start = vi.spyOn(continuation, 'startExplicitContinuation');
      const guarded = vi.spyOn(storage.taskRuns, 'guardedStart');
      const complete = vi.spyOn(tasks, 'completeRun');
      const fail = vi.spyOn(tasks, 'failRun');
      const lookup = vi.spyOn(storage.taskRuns, 'get');
      const request: ContinuationExecutionRequestContext = { trigger: 'EXPLICIT_CONTINUATION_EXECUTION_REQUEST',
        handoffId: 'handoff', taskId: task.id, actorId: 'actor', projectId: 'project', plan };
      const result = await execution.executeExplicitContinuation(request);
      expect(start).toHaveBeenCalledTimes(1);
      expect(guarded).toHaveBeenCalledTimes(1);
      expect(receiver.receive).toHaveBeenCalledTimes(1);
      expect(lookup).not.toHaveBeenCalled();
      const started = await guarded.mock.results[0]!.value;
      expect(receiver.receive.mock.calls[0]![0].taskRun).toBe(started);
      expect(complete).toHaveBeenCalledTimes(mode === 'SUCCEEDED' ? 1 : 0);
      expect(fail).toHaveBeenCalledTimes(mode === 'SUCCEEDED' ? 0 : 1);
      expect((mode === 'SUCCEEDED' ? complete.mock.calls[0]![0] : fail.mock.calls[0]![0])).toBe(started);
      if (result.disposition === 'DENY') throw new Error('expected terminal outcome');
      expect(result.taskRun).toMatchObject({ id: started.id, taskId: task.id, attempt: started.attempt,
        capability: started.capability, status: mode === 'SUCCEEDED' ? TaskRunStatus.SUCCEEDED : TaskRunStatus.FAILED });
      expect(await storage.taskRuns.get(started.id)).toEqual(result.taskRun); // test-only persistence verification
      expect((await storage.tasks.get(task.id))!.status).toBe(TaskStatus.RUNNING);
      expect(JSON.stringify(result)).not.toContain('SENSITIVE_SENTINEL');
      if (mode === 'SUCCEEDED') expect(result.taskRun.artifactIds).toEqual(['artifact-1']);
      else expect(result.taskRun.error).toBe('CONTINUATION_RECEIVER_FAILED');
    } finally { await storage.close(); }
  });
});
