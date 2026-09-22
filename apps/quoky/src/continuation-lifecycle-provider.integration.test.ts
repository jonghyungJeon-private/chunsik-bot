import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { AgentProfileRegistry, agentProfileId, ApprovalManager, ApprovalPolicy, Capability, IntentType,
  RiskPolicy, CONTINUATION_BINDING_REPOSITORY, STORAGE_PROVIDER, TaskManager, TaskStatus, WorkHandoffContinuationService, WorkItemStatus } from '@quoky/core';
import type { StorageProvider, Task } from '@quoky/core';
import { continuationLifecycleProvider } from './continuation-lifecycle-provider';

describe('production continuation lifecycle composition', () => {
  it('registers the production factory and reaches RUNNING through the resolved application entry', async () => {
    // Do not import AppModule: its unrelated infrastructure reads runtime config and constructs providers.
    expect(readFileSync(new URL('./app.module.ts', import.meta.url), 'utf8'))
      .toContain('  continuationLifecycleProvider,');
    const ts = '2026-09-22T00:00:00.000Z';
    let task: Task = { id: 'task', actorId: 'actor', status: TaskStatus.PENDING, title: 'continue', description: 'continue',
      intent: { type: IntentType.CHAT, capability: Capability.GENERAL_CHAT, confidence: 1, requiresWork: true, summary: 'continue' },
      riskLevel: new RiskPolicy().assessCapability(Capability.GENERAL_CHAT),
      context: { platform: 'test', channelId: 'c', userId: 'u' }, createdAt: ts, updatedAt: ts };
    let binding: { handoffId: string; taskId: string; recordedAt: string } | null = null;
    const store = {
      tasks: { get: async () => task, save: async (value: Task) => { task = value; return value; } },
      taskRuns: { start: vi.fn(), save: vi.fn() },
      workItems: { get: async () => ({ id: 'work', actorId: 'actor', status: WorkItemStatus.ACTIVE,
        origin: 'conversation', resourceRefs: [], createdAt: ts, updatedAt: ts }) },
      workHandoffs: { get: async () => ({ id: 'handoff', workItemId: 'work', fromAgentProfileId: agentProfileId('source'),
        toAgentProfileId: agentProfileId('receiver'), objective: 'continue', resourceRefs: [], artifactIds: [], executionReceiptIds: [], createdAt: ts }) },
      continuationBindings: { get: async () => binding,
        admit: async () => { binding = { handoffId: 'handoff', taskId: 'task', recordedAt: ts }; return binding; } },
    };
    const storage = store as unknown as StorageProvider;
    const tasks = new TaskManager(storage);
    const start = vi.spyOn(tasks, 'startRun');
    const profiles = new AgentProfileRegistry(['source', 'receiver'].map(id => ({ id: agentProfileId(id), displayName: id, role: id, purpose: id, instructions: id })));
    @Module({ providers: [
      continuationLifecycleProvider,
      { provide: STORAGE_PROVIDER, useValue: storage },
      { provide: CONTINUATION_BINDING_REPOSITORY, useValue: store.continuationBindings },
      { provide: AgentProfileRegistry, useValue: profiles },
      { provide: TaskManager, useValue: tasks },
      { provide: ApprovalManager, useValue: new ApprovalManager(storage, new ApprovalPolicy(new RiskPolicy())) },
    ] })
    class ContinuationComposition {}
    const application = await NestFactory.createApplicationContext(ContinuationComposition, { logger: false });
    try {
      const entry = application.get(WorkHandoffContinuationService);
      expect((await entry.admit('handoff', 'task')).disposition).toBe('BOUND');
      expect(await entry.prepare({ handoffId: 'handoff', taskId: 'task' }))
        .toEqual({ disposition: 'RUNNING_READY', handoffId: 'handoff', taskId: 'task' });
      expect(task.status).toBe(TaskStatus.RUNNING);
      expect(start).not.toHaveBeenCalled();
      expect(store.taskRuns.start).not.toHaveBeenCalled();
      expect(store.taskRuns.save).not.toHaveBeenCalled();
    } finally { await application.close(); }
  });
});
