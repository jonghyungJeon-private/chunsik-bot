import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { AgentProfileRegistry, agentProfileId, ApprovalManager, ApprovalPolicy, Capability,
  CONTINUATION_BINDING_REPOSITORY, ContinuationExecutionEntryError, ContinuationExecutionEntryService,
  ContinuationExecutionService, createWorkHandoff, ExecutionStatus, IntentType, RiskLevel, RiskPolicy,
  STORAGE_PROVIDER, TaskManager, TaskRunStatus, TaskStatus, WorkHandoffContinuationService, WorkItemStatus } from '@quoky/core';
import type { ContinuationExecutionRequestContext, ExecutionPlan } from '@quoky/core';
import { SqliteStorageProvider } from '@quoky/storage-sqlite';
import { continuationLifecycleProvider } from './continuation-lifecycle-provider';
import { continuationExecutionEntryProvider, continuationExecutionProvider } from './continuation-execution-provider';

const ts = '2026-09-22T00:00:00.000Z';
describe('M3E-6J production composition (offline application context)', () => {
  it.each(['valid', 'cross-actor', 'human-wait'] as const)('resolves production factories with real owners and test-only SQLite: %s', async scenario => {
    // Deliberately do not import AppModule (runtime config and unrelated concrete infrastructure).
    const moduleSource = readFileSync(new URL('./app.module.ts', import.meta.url), 'utf8');
    expect(moduleSource).toContain('  continuationExecutionEntryProvider,');
    expect(moduleSource).toContain('  continuationExecutionProvider,');
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
        approvalRequired: false, overallRisk: scenario === 'human-wait' ? RiskLevel.HIGH : RiskLevel.LOW,
        expectedArtifacts: [], status: ExecutionStatus.PENDING, createdAt: ts };
      task = await storage.tasks.save({ ...task, planId: plan.id });
      @Module({ providers: [continuationLifecycleProvider, continuationExecutionEntryProvider, continuationExecutionProvider,
        { provide: STORAGE_PROVIDER, useValue: storage },
        { provide: CONTINUATION_BINDING_REPOSITORY, useValue: storage.continuationBindings },
        { provide: AgentProfileRegistry, useValue: profiles },
        { provide: TaskManager, useValue: tasks },
        { provide: ApprovalManager, useValue: approvals },
      ] })
      class OfflineContinuationComposition {}
      const application = await NestFactory.createApplicationContext(OfflineContinuationComposition, { logger: false });
      try {
        const preparation = application.get(WorkHandoffContinuationService);
        // Pre-existing provenance is established by its owner, outside the operation under test.
        await preparation.admit('handoff', task.id);
        const service = application.get(ContinuationExecutionService);
        const entry = application.get(ContinuationExecutionEntryService);
        const transition = vi.spyOn(tasks, 'transition');
        const acquireApproval = vi.spyOn(approvals, 'requestFor');
        const prepare = vi.spyOn(preparation, 'prepare');
        const start = vi.spyOn(entry, 'start');
        const guarded = vi.spyOn(storage.taskRuns, 'guardedStart');
        const ordinaryStart = vi.spyOn(storage.taskRuns, 'start');
        const runSave = vi.spyOn(storage.taskRuns, 'save');
        const complete = vi.spyOn(tasks, 'completeRun');
        const fail = vi.spyOn(tasks, 'failRun');
        const input: ContinuationExecutionRequestContext = { trigger: 'EXPLICIT_CONTINUATION_EXECUTION_REQUEST',
          handoffId: 'handoff', taskId: task.id, actorId: scenario === 'cross-actor' ? 'other' : 'actor', projectId: 'project', plan };
        const result = await service.startExplicitContinuation(input);
        if (scenario === 'valid') {
          if (result.disposition !== 'ATTEMPT_STARTED') throw new Error('expected started');
          expect(result.taskRun).toBe(await guarded.mock.results[0]!.value);
          expect(result.taskRun).toMatchObject({ taskId: task.id, attempt: 1, status: TaskRunStatus.STARTED });
          expect(await storage.taskRuns.get(result.taskRun.id)).toEqual(result.taskRun);
          expect((await storage.tasks.get(task.id))!.status).toBe(TaskStatus.RUNNING);
          expect(transition.mock.calls.map(call => call[1])).toEqual([TaskStatus.PLANNING, TaskStatus.RUNNING]);
          expect(start).toHaveBeenCalledTimes(1);
          expect(guarded).toHaveBeenCalledTimes(1);
          // ALREADY_RUNNING is not authority to replace an unresolved concrete attempt.
          await expect(service.startExplicitContinuation(input)).rejects.toEqual(new ContinuationExecutionEntryError('UNRESOLVED_STARTED_RUN'));
          expect(start).toHaveBeenCalledTimes(2); // exactly once for each explicit invocation
          expect(guarded).toHaveBeenCalledTimes(1); // second fresh admission rejects before effect-time start
          expect(await storage.taskRuns.listByTask(task.id)).toHaveLength(1);
        } else {
          expect(result).toMatchObject({ disposition: 'DENY', stage: 'PRODUCT_POLICY' });
          expect(prepare).not.toHaveBeenCalled();
          expect(transition).not.toHaveBeenCalled();
          expect(start).not.toHaveBeenCalled();
          expect(guarded).not.toHaveBeenCalled();
          expect(await storage.taskRuns.listByTask(task.id)).toHaveLength(0);
          expect((await storage.tasks.get(task.id))!.status).toBe(TaskStatus.PENDING);
        }
        expect(acquireApproval).not.toHaveBeenCalled();
        expect(ordinaryStart).not.toHaveBeenCalled();
        expect(runSave).not.toHaveBeenCalled();
        expect(complete).not.toHaveBeenCalled();
        expect(fail).not.toHaveBeenCalled();
      } finally { await application.close(); }
    } finally { await storage.close(); }
  });
});
