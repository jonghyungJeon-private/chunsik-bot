import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentProfileId, Capability, ExecutionStatus, IntentType, RiskLevel, TaskRunStatus, TaskStatus, WorkItemStatus } from '../domain';
import type { ContinuationBinding, ExecutionPlan, Task, TaskRun, WorkHandoff, WorkItem } from '../domain';
import { GuardedTaskRunStartError } from '../errors';
import { AgentProfileRegistry } from './agent-profile-registry';
import { ContinuationExecutionEntryError } from './continuation-execution-entry-service';
import { ContinuationExecutionProductPolicy } from './continuation-execution-product-policy';
import type { ContinuationExecutionRequestContext } from './continuation-execution-product-policy';
import { ContinuationExecutionService } from './continuation-execution-service';
import { WorkHandoffConsumptionError } from './work-handoff-consumption-service';
import type { ContinuationLifecycleInput, ContinuationLifecycleResult } from './work-handoff-continuation-service';

const ts = '2026-09-22T00:00:00.000Z';
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const work: WorkItem = { id: 'work', actorId: 'actor', projectId: 'project', resourceRefs: [],
    status: WorkItemStatus.ACTIVE, origin: 'conversation', createdAt: ts, updatedAt: ts };
  const handoff: WorkHandoff = { id: 'handoff', workItemId: work.id, fromAgentProfileId: agentProfileId('source'),
    toAgentProfileId: agentProfileId('receiver'), objective: 'continue', resourceRefs: [], artifactIds: [],
    executionReceiptIds: [], createdAt: ts };
  const task: Task = { id: 'task', actorId: work.actorId, projectId: work.projectId, title: 'continue', description: 'continue',
    status: TaskStatus.PENDING, planId: 'plan', riskLevel: RiskLevel.LOW,
    intent: { type: IntentType.CHAT, capability: Capability.GENERAL_CHAT, confidence: 1, requiresWork: true, summary: 'continue' },
    context: { platform: 'test', channelId: 'channel', userId: 'user' }, createdAt: ts, updatedAt: ts };
  const plan: ExecutionPlan = { id: 'plan', goal: 'continue', summary: 'continue', projectId: work.projectId,
    steps: [{ id: 'step', title: 'original', description: 'original', capability: Capability.GENERAL_CHAT, status: ExecutionStatus.PENDING }],
    requiredCapabilities: [Capability.GENERAL_CHAT], requiredResources: ['original'],
    estimatedChanges: { fileCount: 0, scope: 'none' }, expectedArtifacts: [],
    integrity: { kind: 'test', contractVersion: '1', digest: 'original' },
    overallRisk: RiskLevel.LOW, approvalRequired: false, status: ExecutionStatus.PENDING, createdAt: ts };
  const request: ContinuationExecutionRequestContext = { trigger: 'EXPLICIT_CONTINUATION_EXECUTION_REQUEST',
    handoffId: handoff.id, taskId: task.id, actorId: work.actorId, projectId: work.projectId, plan };
  const binding: ContinuationBinding = { handoffId: handoff.id, taskId: task.id, recordedAt: ts };
  const storage = {
    workHandoffs: { get: vi.fn(async (_id: string): Promise<WorkHandoff | null> => handoff) },
    workItems: { get: vi.fn(async (_id: string): Promise<WorkItem | null> => work) },
    tasks: { get: vi.fn(async (_id: string): Promise<Task | null> => task) },
  };
  const bindings = { get: vi.fn(async (_id: string): Promise<ContinuationBinding | null> => binding) };
  const preparation = { prepare: vi.fn(async (_input: ContinuationLifecycleInput): Promise<ContinuationLifecycleResult> =>
    ({ disposition: 'RUNNING_READY', handoffId: handoff.id, taskId: task.id })) };
  const run: TaskRun = { id: 'exact-run-id', taskId: task.id, attempt: 37, status: TaskRunStatus.STARTED,
    capability: Capability.GENERAL_CHAT, artifactIds: [], startedAt: ts };
  const entry = { start: vi.fn(async (_input: ContinuationLifecycleInput) => run) };
  const profiles = new AgentProfileRegistry(['source', 'receiver'].map(id => ({ id: agentProfileId(id), displayName: id,
    role: id, purpose: id, instructions: id })));
  const service = new ContinuationExecutionService(storage, profiles, bindings, preparation, entry);
  return { work, handoff, task, plan, request, binding, storage, bindings, preparation, run, entry, profiles, service };
}

describe('M3E-6J explicit continuation caller', () => {
  it.each(['RUNNING_READY', 'ALREADY_RUNNING'] as const)('composes canonical reads → policy → %s → one entry, returning exact run', async disposition => {
    const f = fixture();
    f.preparation.prepare.mockResolvedValue({ disposition, handoffId: 'handoff', taskId: 'task' });
    const policy = vi.spyOn(ContinuationExecutionProductPolicy.prototype, 'evaluate');
    const result = await f.service.startExplicitContinuation(f.request);
    expect(result).toEqual({ disposition: 'ATTEMPT_STARTED', taskRun: f.run });
    if (result.disposition !== 'ATTEMPT_STARTED') throw new Error('expected started');
    expect(result.taskRun).toBe(f.run);
    expect(Object.keys(result)).toEqual(['disposition', 'taskRun']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(f.storage.workHandoffs.get.mock.calls).toEqual([['handoff']]);
    expect(f.storage.workItems.get.mock.calls).toEqual([['work'], ['work']]);
    expect(f.bindings.get.mock.calls).toEqual([['handoff']]);
    expect(f.storage.tasks.get.mock.calls).toEqual([['task']]);
    expect(policy).toHaveBeenCalledWith(expect.anything(), f.work, f.task);
    expect(f.storage.tasks.get.mock.invocationCallOrder[0]!).toBeLessThan(policy.mock.invocationCallOrder[0]!);
    expect(policy.mock.invocationCallOrder[0]!).toBeLessThan(f.preparation.prepare.mock.invocationCallOrder[0]!);
    expect(f.preparation.prepare.mock.invocationCallOrder[0]!).toBeLessThan(f.entry.start.mock.invocationCallOrder[0]!);
    expect(f.entry.start).toHaveBeenCalledTimes(1);
    const exact = f.preparation.prepare.mock.calls[0]![0];
    expect(exact).toEqual({ handoffId: 'handoff', taskId: 'task', plan: f.plan });
    expect(f.entry.start.mock.calls[0]![0]).toBe(exact);
    expect(Object.keys(exact)).toEqual(['handoffId', 'taskId', 'plan']);
    // The injected read surface has no TaskRun lookup; no post-start rediscovery is possible.
  });

  it.each(['workItem', 'task', 'binding', 'handoff', 'agentProfile', 'approvalId', 'taskRun', 'providerId', 'receiver'])
  ('rejects requester-supplied %s rather than trusting injected facts/authority', async key => {
    const f = fixture();
    const request = { ...f.request, [key]: key === 'approvalId' ? 'approved' : f.work };
    expect(await f.service.startExplicitContinuation(request)).toMatchObject({ disposition: 'DENY', stage: 'CONTEXT' });
    expect(f.storage.workHandoffs.get).not.toHaveBeenCalled();
    expect(f.preparation.prepare).not.toHaveBeenCalled();
    expect(f.entry.start).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}])('fails closed on missing/malformed live plan %s', async plan => {
    const f = fixture();
    expect(await f.service.startExplicitContinuation({ ...f.request, plan } as ContinuationExecutionRequestContext))
      .toMatchObject({ disposition: 'DENY', stage: 'CONTEXT' });
    expect(f.storage.workHandoffs.get).not.toHaveBeenCalled();
    expect(f.entry.start).not.toHaveBeenCalled();
  });

  it.each(['missing handoff', 'wrong handoff id', 'missing work', 'wrong work id', 'missing source', 'missing destination'])
  ('reuses consumption rejection: %s', async scenario => {
    const f = fixture();
    if (scenario === 'missing handoff') f.storage.workHandoffs.get.mockResolvedValue(null);
    if (scenario === 'wrong handoff id') f.storage.workHandoffs.get.mockResolvedValue({ ...f.handoff, id: 'other' });
    if (scenario === 'missing work') f.storage.workItems.get.mockResolvedValue(null);
    if (scenario === 'wrong work id') f.storage.workItems.get.mockResolvedValue({ ...f.work, id: 'other' });
    if (scenario === 'missing source') f.storage.workHandoffs.get.mockResolvedValue({ ...f.handoff, fromAgentProfileId: agentProfileId('unknown') });
    if (scenario === 'missing destination') f.storage.workHandoffs.get.mockResolvedValue({ ...f.handoff, toAgentProfileId: agentProfileId('unknown') });
    await expect(f.service.startExplicitContinuation(f.request)).rejects.toBeInstanceOf(WorkHandoffConsumptionError);
    expect(f.preparation.prepare).not.toHaveBeenCalled();
    expect(f.entry.start).not.toHaveBeenCalled();
  });

  it.each([WorkItemStatus.COMPLETED, WorkItemStatus.CANCELED])('NO_ACTION for %s never starts', async status => {
    const f = fixture();
    f.storage.workItems.get.mockResolvedValue({ ...f.work, status });
    expect(await f.service.startExplicitContinuation(f.request)).toMatchObject({ disposition: 'DENY', reason: 'WORK_ITEM_NOT_CONTINUABLE' });
    expect(f.preparation.prepare).not.toHaveBeenCalled();
    expect(f.entry.start).not.toHaveBeenCalled();
  });

  it.each(['missing binding', 'wrong handoff', 'wrong task', 'invalid timestamp', 'missing task', 'task id mismatch', 'work changed'])
  ('rejects canonical inconsistency before policy: %s', async scenario => {
    const f = fixture();
    const policy = vi.spyOn(ContinuationExecutionProductPolicy.prototype, 'evaluate');
    if (scenario === 'missing binding') f.bindings.get.mockResolvedValue(null);
    if (scenario === 'wrong handoff') f.bindings.get.mockResolvedValue({ ...f.binding, handoffId: 'other' });
    if (scenario === 'wrong task') f.bindings.get.mockResolvedValue({ ...f.binding, taskId: 'other' });
    if (scenario === 'invalid timestamp') f.bindings.get.mockResolvedValue({ ...f.binding, recordedAt: 'invalid' });
    if (scenario === 'missing task') f.storage.tasks.get.mockResolvedValue(null);
    if (scenario === 'task id mismatch') f.storage.tasks.get.mockResolvedValue({ ...f.task, id: 'other' });
    if (scenario === 'work changed') f.storage.workItems.get.mockResolvedValueOnce(f.work).mockResolvedValue({ ...f.work, status: WorkItemStatus.CANCELED });
    expect(await f.service.startExplicitContinuation(f.request)).toMatchObject({ disposition: 'DENY', stage: 'CANONICAL' });
    expect(policy).not.toHaveBeenCalled();
    expect(f.preparation.prepare).not.toHaveBeenCalled();
    expect(f.entry.start).not.toHaveBeenCalled();
  });

  it('selects only handoff-derived work and exact-bound task despite identical unrelated actor/project facts', async () => {
    const f = fixture();
    const otherWork = { ...f.work, id: 'unrelated-work' };
    const otherTask = { ...f.task, id: 'unrelated-task' };
    f.storage.workItems.get.mockImplementation(async id => id === f.work.id ? f.work : otherWork);
    f.storage.tasks.get.mockImplementation(async id => id === f.binding.taskId ? f.task : otherTask);
    const policy = vi.spyOn(ContinuationExecutionProductPolicy.prototype, 'evaluate');
    await f.service.startExplicitContinuation(f.request);
    expect(policy.mock.calls[0]![1]).toBe(f.work);
    expect(policy.mock.calls[0]![2]).toBe(f.task);
    expect(f.storage.tasks.get.mock.calls).toEqual([['task']]);
    expect(f.storage.workItems.get.mock.calls).toEqual([['work'], ['work']]);
  });

  it('snapshots deeply before the first async read and uses only that snapshot throughout', async () => {
    const f = fixture();
    let release!: (value: WorkHandoff) => void;
    f.storage.workHandoffs.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const original = JSON.parse(JSON.stringify(f.plan)) as ExecutionPlan;
    const policy = vi.spyOn(ContinuationExecutionProductPolicy.prototype, 'evaluate');
    const pending = f.service.startExplicitContinuation(f.request);
    f.plan.requiredCapabilities.push(Capability.CODE_IMPLEMENTATION);
    f.plan.steps[0]!.capability = Capability.CODE_IMPLEMENTATION;
    f.plan.requiredResources[0] = 'changed';
    f.plan.estimatedChanges.scope = 'broad';
    f.plan.integrity!.digest = 'changed';
    f.plan.overallRisk = RiskLevel.HIGH;
    Object.assign(f.request, { handoffId: 'other', taskId: 'other', actorId: 'other', projectId: 'other' });
    release(f.handoff);
    expect((await pending).disposition).toBe('ATTEMPT_STARTED');
    const snapshot = policy.mock.calls[0]![0];
    expect(snapshot.plan).toEqual(original);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.plan.steps[0])).toBe(true);
    expect(f.preparation.prepare.mock.calls[0]![0].plan).toBe(snapshot.plan);
    expect(f.entry.start.mock.calls[0]![0].plan).toBe(snapshot.plan);
    expect(f.entry.start.mock.calls[0]![0]).toMatchObject({ handoffId: 'handoff', taskId: 'task' });
  });

  it.each(['actor', 'project', 'capability', 'task risk', 'plan risk', 'approval', 'trigger', 'plan escalation'])
  ('Product policy denial precedes all mutation: %s', async scenario => {
    const f = fixture();
    let request = f.request;
    if (scenario === 'actor') request = { ...request, actorId: 'other' };
    if (scenario === 'project') request = { ...request, projectId: 'other' };
    if (scenario === 'capability') f.task.intent.capability = Capability.EMBEDDING;
    if (scenario === 'task risk') f.task.riskLevel = RiskLevel.HIGH;
    if (scenario === 'plan risk') f.plan.overallRisk = RiskLevel.HIGH;
    if (scenario === 'approval') f.plan.approvalRequired = true;
    if (scenario === 'trigger') request = { ...request, trigger: 'IMPLICIT' as ContinuationExecutionRequestContext['trigger'] };
    if (scenario === 'plan escalation') f.plan.requiredCapabilities.push(Capability.CODE_IMPLEMENTATION);
    const before = JSON.stringify([f.work, f.task]);
    expect(await f.service.startExplicitContinuation(request)).toMatchObject({ disposition: 'DENY', stage: 'PRODUCT_POLICY' });
    expect(f.preparation.prepare).not.toHaveBeenCalled();
    expect(f.entry.start).not.toHaveBeenCalled();
    expect(JSON.stringify([f.work, f.task])).toBe(before);
  });

  it('stops on prepare denial without hiding its reason', async () => {
    const f = fixture();
    f.preparation.prepare.mockResolvedValue({ disposition: 'DENY', reason: 'APPROVAL_UNPROVABLE' });
    expect(await f.service.startExplicitContinuation(f.request))
      .toEqual({ disposition: 'DENY', stage: 'PREPARE', reason: 'APPROVAL_UNPROVABLE' });
    expect(f.entry.start).not.toHaveBeenCalled();
  });
  it('fails closed on unexpected approval wait and exposes no resumable approval token', async () => {
    const f = fixture();
    f.preparation.prepare.mockResolvedValue({ disposition: 'WAITING_FOR_APPROVAL', handoffId: 'handoff', taskId: 'task', approvalId: 'pending' });
    expect(await f.service.startExplicitContinuation(f.request))
      .toEqual({ disposition: 'DENY', stage: 'PREPARE', reason: 'HUMAN_WAIT_REQUIRED' });
    expect(f.entry.start).not.toHaveBeenCalled();
  });
  it.each([
    new ContinuationExecutionEntryError('UNRESOLVED_STARTED_RUN'),
    new GuardedTaskRunStartError('TASK_NOT_EXECUTABLE'),
    new GuardedTaskRunStartError('TASK_RUN_STORAGE_BUSY'),
  ])('preserves typed entry failure without retry: %s', async error => {
    const f = fixture();
    f.entry.start.mockRejectedValue(error);
    await expect(f.service.startExplicitContinuation(f.request)).rejects.toBe(error);
    expect(f.preparation.prepare).toHaveBeenCalledTimes(1);
    expect(f.entry.start).toHaveBeenCalledTimes(1);
  });
  it('propagates storage failure instead of retrying or fabricating a run', async () => {
    const f = fixture();
    const error = new Error('storage unavailable');
    f.bindings.get.mockRejectedValue(error);
    await expect(f.service.startExplicitContinuation(f.request)).rejects.toBe(error);
    expect(f.bindings.get).toHaveBeenCalledTimes(1);
    expect(f.entry.start).not.toHaveBeenCalled();
  });
});
