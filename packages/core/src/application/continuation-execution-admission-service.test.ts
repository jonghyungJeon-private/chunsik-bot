import { describe, expect, it, vi } from 'vitest';
import { agentProfileId, ApprovalStatus, Capability, createWorkHandoff, ExecutionStatus,
  executionPlanRef, IntentType, RiskLevel, TaskRunStatus, TaskStatus, WorkItemStatus } from '../domain';
import type { ApprovalRequest, ContinuationBinding, ExecutionPlan, Task, TaskRun, WorkItem } from '../domain';
import { AgentProfileRegistry } from './agent-profile-registry';
import { ContinuationExecutionAdmissionService, isUnresolvedStartedTaskRun } from './continuation-execution-admission-service';

const TS = '2026-09-21T00:00:00.000Z';
function fixture() {
  const handoff = createWorkHandoff({ id: 'handoff', workItemId: 'work', fromAgentProfileId: agentProfileId('source'),
    toAgentProfileId: agentProfileId('destination'), objective: 'Continue', resourceRefs: [], artifactIds: [], executionReceiptIds: [], createdAt: TS });
  const work: WorkItem = { id: 'work', actorId: 'actor', status: WorkItemStatus.ACTIVE,
    origin: 'conversation', resourceRefs: [], createdAt: TS, updatedAt: TS };
  const task: Task = { id: 'task', actorId: 'actor', title: 'Continue', description: 'Continue', status: TaskStatus.RUNNING,
    intent: { type: IntentType.CHAT, capability: Capability.GENERAL_CHAT, confidence: 1, requiresWork: true, summary: 'Continue' },
    riskLevel: RiskLevel.LOW, context: { platform: 'test', channelId: 'channel', userId: 'user' }, createdAt: TS, updatedAt: TS };
  const binding: ContinuationBinding = { handoffId: handoff.id, taskId: task.id, recordedAt: TS };
  const runs: TaskRun[] = [];
  const plan: ExecutionPlan = { id: 'plan', goal: 'Continue', summary: 'Continue', steps: [], requiredCapabilities: [Capability.GENERAL_CHAT],
    requiredResources: [], estimatedChanges: { fileCount: 0, scope: 'none' }, approvalRequired: true, overallRisk: RiskLevel.HIGH,
    expectedArtifacts: [], status: ExecutionStatus.PENDING, createdAt: TS,
    integrity: { kind: 'test', contractVersion: '1', digest: 'exact-scope' } };
  const approval: ApprovalRequest = { id: 'approval', executionPlanRef: executionPlanRef(plan), status: ApprovalStatus.APPROVED,
    riskLevel: RiskLevel.HIGH, reason: 'approved', requestedBy: 'actor', createdAt: TS, updatedAt: TS };
  // Include forbidden methods as tripwires. The service's type only accepts reads.
  const write = vi.fn(() => { throw new Error('unexpected mutation'); });
  const storage = {
    workHandoffs: { get: vi.fn(async () => handoff as typeof handoff | null), insert: write },
    workItems: { get: vi.fn(async () => work as WorkItem | null), save: write },
    tasks: { get: vi.fn(async () => task as Task | null), save: write },
    approvals: { get: vi.fn(async () => approval as ApprovalRequest | null), save: write },
    taskRuns: { listByTask: vi.fn(async () => runs), start: write, save: write, delete: write },
  };
  const bindings = { get: vi.fn(async () => binding as ContinuationBinding | null), admit: write };
  const profiles = new AgentProfileRegistry(['source', 'destination'].map(id => ({ id: agentProfileId(id), displayName: id, role: id, purpose: id, instructions: id })));
  const service = new ContinuationExecutionAdmissionService(storage, profiles, bindings);
  const input = { handoffId: handoff.id, taskId: task.id };
  return { handoff, work, task, binding, runs, plan, approval, storage, bindings, profiles, service, input, write };
}
function run(status: TaskRunStatus, id = 'run', attempt = 1): TaskRun {
  return { id, taskId: 'task', attempt, status, capability: Capability.GENERAL_CHAT, artifactIds: [], startedAt: TS };
}
const denied = (reason: string) => ({ disposition: 'DENY', reason });

describe('ContinuationExecutionAdmissionService — read-only prerequisites', () => {
  it('returns an immutable non-authoritative decision with zero writes, including concurrent/repeated evaluation', async () => {
    const f = fixture();
    const before = JSON.stringify([f.handoff, f.work, f.task, f.binding, f.runs, f.approval]);
    const outcomes = await Promise.all([f.service.evaluate(f.input), f.service.evaluate(f.input)]);
    expect(outcomes[0]).toEqual({ disposition: 'ELIGIBLE_TO_START_ATTEMPT', handoffId: 'handoff', taskId: 'task' });
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(Object.isFrozen(outcomes[0])).toBe(true);
    expect(outcomes[0]).not.toHaveProperty('taskRunId');
    expect(JSON.stringify([f.handoff, f.work, f.task, f.binding, f.runs, f.approval])).toBe(before);
    expect(f.write).not.toHaveBeenCalled();
    expect(f.runs).toEqual([]);
  });
  it('rejects invalid ids before reading', async () => {
    const f = fixture();
    expect(await f.service.evaluate({ ...f.input, taskId: ' ' })).toEqual(denied('INVALID_REQUEST'));
    expect(f.storage.workHandoffs.get).not.toHaveBeenCalled();
  });
  it.each(['missing', 'wrong-id', 'invalid'])('denies %s handoff', async kind => {
    const f = fixture();
    f.storage.workHandoffs.get.mockResolvedValue(kind === 'missing' ? null : { ...f.handoff, ...(kind === 'wrong-id' ? { id: 'other' } : { objective: '' }) });
    expect(await f.service.evaluate(f.input)).toEqual(denied('HANDOFF_NOT_ACTIONABLE'));
  });
  it.each(['missing', 'wrong-task', 'wrong-handoff'])('denies %s binding', async kind => {
    const f = fixture();
    f.bindings.get.mockResolvedValue(kind === 'missing' ? null : { ...f.binding, ...(kind === 'wrong-task' ? { taskId: 'other' } : { handoffId: 'other' }) });
    expect(await f.service.evaluate(f.input)).toEqual(denied('BINDING_MISMATCH'));
  });
  it.each([WorkItemStatus.COMPLETED, WorkItemStatus.CANCELED])('denies %s work even after prior eligibility', async status => {
    const f = fixture();
    expect((await f.service.evaluate(f.input)).disposition).toBe('ELIGIBLE_TO_START_ATTEMPT');
    f.work.status = status;
    expect(await f.service.evaluate(f.input)).toEqual(denied('WORK_ITEM_NOT_CONTINUABLE'));
    expect(f.write).not.toHaveBeenCalled();
  });
  it.each(Object.values(TaskStatus).filter(s => s !== TaskStatus.RUNNING))('requires canonical RUNNING, denies %s', async status => {
    const f = fixture(); f.task.status = status;
    expect(await f.service.evaluate(f.input)).toEqual(denied('TASK_NOT_EXECUTABLE'));
  });
  it.each(['actor', 'project', 'context', 'id'])('denies Task %s mismatch', async field => {
    const f = fixture();
    if (field === 'actor') f.task.actorId = 'other';
    if (field === 'project') f.task.projectId = 'other';
    if (field === 'context') f.task.context.channelId = '';
    if (field === 'id') f.task.id = 'other';
    expect(await f.service.evaluate(f.input)).toEqual(denied('TASK_NOT_EXECUTABLE'));
  });
  it.each(['source', 'destination'])('denies unavailable %s profile', async missing => {
    const f = fixture();
    const profiles = new AgentProfileRegistry(f.profiles.list().filter(p => p.id !== missing));
    expect(await new ContinuationExecutionAdmissionService(f.storage, profiles, f.bindings).evaluate(f.input))
      .toEqual(denied('AGENT_PROFILE_UNAVAILABLE'));
  });
  it('does not reconstruct a missing live plan from Task.planId or a supplied approval id', async () => {
    const f = fixture(); f.task.riskLevel = RiskLevel.HIGH; f.task.planId = f.plan.id;
    expect(await f.service.evaluate({ ...f.input, approvalId: 'approval' })).toEqual(denied('APPROVAL_UNPROVABLE'));
    expect(f.storage.approvals.get).not.toHaveBeenCalled();
  });
  it('requires approval from capability baseline even if Task risk says LOW', async () => {
    const f = fixture(); f.task.intent.capability = Capability.CODE_IMPLEMENTATION;
    expect(await f.service.evaluate(f.input)).toEqual(denied('APPROVAL_UNPROVABLE'));
  });
  it('reads exact approval and matches full plan ref including integrity', async () => {
    const f = fixture(); f.task.planId = f.plan.id;
    expect((await f.service.evaluate({ ...f.input, plan: f.plan, approvalId: 'approval' })).disposition).toBe('ELIGIBLE_TO_START_ATTEMPT');
    expect(f.storage.approvals.get).toHaveBeenCalledWith('approval');
    expect(f.write).not.toHaveBeenCalled();
  });
  it.each(['missing-id', 'missing-record', 'wrong-record-id', 'plan', 'goal', 'digest', 'version', 'kind', 'missing-integrity', 'wrong-task-plan'])('denies unprovable approval: %s', async scenario => {
    const f = fixture(); f.task.planId = f.plan.id;
    if (scenario === 'missing-record') f.storage.approvals.get.mockResolvedValue(null);
    if (scenario === 'wrong-record-id') f.approval.id = 'other';
    if (scenario === 'plan') f.approval.executionPlanRef.id = 'other';
    if (scenario === 'goal') f.approval.executionPlanRef.goal = 'other';
    // executionPlanRef shares the integrity object; replace it to model canonical mismatch.
    if (['digest', 'version', 'kind'].includes(scenario)) f.approval.executionPlanRef.integrity = {
      ...f.plan.integrity!, [scenario === 'version' ? 'contractVersion' : scenario]: 'other' };
    if (scenario === 'missing-integrity') delete f.approval.executionPlanRef.integrity;
    if (scenario === 'wrong-task-plan') f.task.planId = 'other';
    expect(await f.service.evaluate({ ...f.input, plan: f.plan, ...(scenario === 'missing-id' ? {} : { approvalId: 'approval' }) }))
      .toEqual(denied('APPROVAL_UNPROVABLE'));
  });
  it.each([ApprovalStatus.PENDING, ApprovalStatus.REJECTED])('denies %s exact approval', async status => {
    const f = fixture(); f.task.planId = f.plan.id; f.approval.status = status;
    expect(await f.service.evaluate({ ...f.input, plan: f.plan, approvalId: 'approval' })).toEqual(denied('APPROVAL_NOT_APPROVED'));
  });
  it.each([null, {}, { id: 'plan' }])('denies malformed supplied plan %s', async plan => {
    const f = fixture();
    expect(await f.service.evaluate({ ...f.input, plan: plan as ExecutionPlan })).toEqual(denied('APPROVAL_UNPROVABLE'));
    expect(f.write).not.toHaveBeenCalled();
  });
  it('permits an original low-risk plan without a required approval', async () => {
    const f = fixture(); f.task.planId = f.plan.id; f.plan.overallRisk = RiskLevel.LOW; f.plan.approvalRequired = false;
    expect((await f.service.evaluate({ ...f.input, plan: f.plan })).disposition).toBe('ELIGIBLE_TO_START_ATTEMPT');
    expect(f.storage.approvals.get).not.toHaveBeenCalled();
  });
  it('uses lifecycle only: old STARTED with finishedAt still conflicts; highest terminal run cannot hide it', async () => {
    const f = fixture();
    f.runs.push({ ...run(TaskRunStatus.STARTED), startedAt: '2000-01-01T00:00:00Z', finishedAt: TS }, run(TaskRunStatus.SUCCEEDED, 'newer', 99));
    expect(await f.service.evaluate(f.input)).toEqual(denied('UNRESOLVED_STARTED_RUN'));
    f.runs.reverse();
    const restarted = new ContinuationExecutionAdmissionService(f.storage, f.profiles, f.bindings);
    expect(await restarted.evaluate(f.input)).toEqual(denied('UNRESOLVED_STARTED_RUN'));
    expect(f.write).not.toHaveBeenCalled(); expect(f.runs).toHaveLength(2);
  });
  it('terminal historical runs neither conflict nor supply an authority id', async () => {
    const f = fixture();
    f.runs.push(run(TaskRunStatus.FAILED), run(TaskRunStatus.SUCCEEDED, 'success', 8), run(TaskRunStatus.CANCELED, 'canceled', 3));
    const result = await f.service.evaluate(f.input);
    expect(result).toEqual({ disposition: 'ELIGIBLE_TO_START_ATTEMPT', handoffId: 'handoff', taskId: 'task' });
    expect(f.write).not.toHaveBeenCalled();
  });
  it.each(['wrong-task', 'unknown-status', 'bad-attempt', 'duplicate-id'])('fails closed on %s run history', async scenario => {
    const f = fixture(); const r = run(TaskRunStatus.SUCCEEDED); f.runs.push(r);
    if (scenario === 'wrong-task') r.taskId = 'other';
    if (scenario === 'unknown-status') r.status = 'UNKNOWN' as TaskRunStatus;
    if (scenario === 'bad-attempt') r.attempt = 0;
    if (scenario === 'duplicate-id') f.runs.push({ ...r, attempt: 2 });
    expect(await f.service.evaluate(f.input)).toEqual(denied('INVALID_RUN_HISTORY'));
  });
  it('propagates storage failure without guessing eligibility', async () => {
    const f = fixture(); const error = new Error('offline'); f.storage.taskRuns.listByTask.mockRejectedValue(error);
    await expect(f.service.evaluate(f.input)).rejects.toBe(error);
    expect(f.write).not.toHaveBeenCalled();
  });
  it.each(Object.values(TaskRunStatus))('pins unresolved predicate for %s', status => {
    expect(isUnresolvedStartedTaskRun(run(status), 'task')).toBe(status === TaskRunStatus.STARTED);
    expect(isUnresolvedStartedTaskRun(run(status), 'other')).toBe(false);
  });
});
