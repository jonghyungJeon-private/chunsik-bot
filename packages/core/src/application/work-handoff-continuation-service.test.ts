import { describe, expect, it, vi } from 'vitest';
import { agentProfileId, Capability, createWorkHandoff, IntentType, RiskLevel, TaskRunStatus, TaskStatus, WorkItemStatus } from '../domain';
import type { Task, WorkItem } from '../domain';
import { AgentProfileRegistry } from './agent-profile-registry';
import { WorkHandoffContinuationService } from './work-handoff-continuation-service';

const ts = '2026-09-21T00:00:00.000Z';
function fixture() {
  const handoff = createWorkHandoff({ id: 'h', workItemId: 'w', fromAgentProfileId: agentProfileId('source'),
    toAgentProfileId: agentProfileId('destination'), objective: 'Continue', resourceRefs: [], artifactIds: [], executionReceiptIds: [], createdAt: ts });
  const workItem: WorkItem = { id: 'w', actorId: 'a', status: WorkItemStatus.ACTIVE,
    origin: 'conversation', resourceRefs: [], createdAt: ts, updatedAt: ts };
  const task: Task = { id: 't', actorId: 'a', status: TaskStatus.PENDING, title: 'continue', description: 'continue',
    intent: { type: IntentType.CHAT, capability: Capability.GENERAL_CHAT, confidence: 1, requiresWork: true, summary: 'continue' },
    riskLevel: RiskLevel.LOW, context: { platform: 'test', channelId: 'c', userId: 'u' }, createdAt: ts, updatedAt: ts };
  const storage = { workHandoffs: { get: vi.fn(async () => handoff) }, workItems: { get: vi.fn(async () => workItem) },
    tasks: { get: vi.fn(async () => task) }, taskRuns: { get: vi.fn(async () => ({ id: 'run', taskId: 't', attempt: 1,
      status: TaskRunStatus.STARTED, capability: Capability.GENERAL_CHAT, artifactIds: [], startedAt: ts })) } };
  const binding = Object.freeze({ handoffId: 'h', taskId: 't', recordedAt: ts });
  const bindings = { get: vi.fn(async () => binding), admit: vi.fn(async () => binding) };
  const registry = new AgentProfileRegistry(['source', 'destination'].map(id => ({ id: agentProfileId(id), displayName: id, role: id, purpose: id, instructions: id })));
  return { handoff, workItem, task, storage, bindings, registry,
    service: new WorkHandoffContinuationService(storage, registry, bindings) };
}

describe('WorkHandoffContinuationService admission', () => {
  it('revalidates canonical state and returns immutable binding, with no execution seams', async () => {
    const f = fixture();
    const result = await f.service.admit('h', 't');
    expect(result.disposition).toBe('BOUND');
    expect(Object.isFrozen(result)).toBe(true);
    expect(f.bindings.admit).toHaveBeenCalledWith({ handoff: f.handoff, workItem: f.workItem, task: f.task });
    expect(f.storage.taskRuns.get).not.toHaveBeenCalled();
  });
  it.each([WorkItemStatus.COMPLETED, WorkItemStatus.CANCELED])('does not admit %s work', async status => {
    const f = fixture();
    f.storage.workItems.get.mockResolvedValue({ ...f.workItem, status });
    expect(await f.service.admit('h', 't')).toEqual({ disposition: 'NO_ACTION' });
    expect(f.bindings.admit).not.toHaveBeenCalled();
  });
  it('detects lifecycle changes between eligibility and effect preparation', async () => {
    const f = fixture();
    f.storage.workItems.get.mockResolvedValueOnce(f.workItem).mockResolvedValue({ ...f.workItem, status: WorkItemStatus.COMPLETED });
    await expect(f.service.admit('h', 't')).rejects.toMatchObject({ code: 'STALE_STATE' });
    expect(f.bindings.admit).not.toHaveBeenCalled();
  });
  it.each(['actor', 'project', 'task-id', 'task-status', 'context'])('rejects inconsistent %s', async kind => {
    const f = fixture();
    if (kind === 'actor') f.task.actorId = 'other';
    if (kind === 'project') f.task.projectId = 'other';
    if (kind === 'task-id') f.task.id = 'other';
    if (kind === 'task-status') f.task.status = 'UNKNOWN' as TaskStatus;
    if (kind === 'context') f.task.context.channelId = '';
    await expect(f.service.admit('h', 't')).rejects.toMatchObject({ code: 'INCONSISTENT_STATE' });
    expect(f.bindings.admit).not.toHaveBeenCalled();
  });
  it('rejects a task already executing', async () => {
    const f = fixture(); f.task.status = TaskStatus.RUNNING;
    await expect(f.service.admit('h', 't')).rejects.toMatchObject({ code: 'STALE_STATE' });
  });
  it('rejects unknown destination configuration', async () => {
    const f = fixture();
    const service = new WorkHandoffContinuationService(f.storage, new AgentProfileRegistry(), f.bindings);
    await expect(service.admit('h', 't')).rejects.toThrow();
    expect(f.bindings.admit).not.toHaveBeenCalled();
  });
  it.each(['', ' t', null, { disposition: 'CONTINUE' }])('rejects malformed ids/old decision objects %s', async id => {
    const f = fixture();
    await expect(f.service.admit(id as string, 't')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(f.bindings.admit).not.toHaveBeenCalled();
  });
  it('propagates atomic storage rejection without producing a decision', async () => {
    const f = fixture(); f.bindings.admit.mockRejectedValue(new Error('atomic rejection'));
    await expect(f.service.admit('h', 't')).rejects.toThrow('atomic rejection');
  });
  it('resolves an exact existing run without writing or selecting a newer run', async () => {
    const f = fixture();
    expect(await f.service.resolveRun('h', 'run')).toEqual({ handoffId: 'h', workItemId: 'w',
      destinationAgentProfileId: 'destination', taskId: 't', taskRunId: 'run' });
    expect(f.storage.taskRuns.get).toHaveBeenCalledWith('run');
    expect(f.bindings.admit).not.toHaveBeenCalled();
    await expect(f.service.resolveRun('h', 'newer')).rejects.toMatchObject({ code: 'INCONSISTENT_STATE' });
  });
});
