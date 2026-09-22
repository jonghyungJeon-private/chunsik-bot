import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentProfileId, ApprovalStatus, Capability, createWorkHandoff, ExecutionStatus,
  IntentType, RiskLevel, TaskStatus, WorkItemStatus } from '../domain';
import type { ApprovalRequest, ExecutionPlan, Task, WorkItem } from '../domain';
import type { StorageProvider } from '../ports';
import { AgentProfileRegistry } from './agent-profile-registry';
import { ApprovalManager } from './approval-manager';
import { ApprovalPolicy } from './approval-policy';
import { ContinuationExecutionAdmissionService } from './continuation-execution-admission-service';
import { RiskPolicy } from './risk-policy';
import { TaskManager } from './task-manager';
import { WorkHandoffContinuationService } from './work-handoff-continuation-service';

const ts = '2026-09-22T00:00:00.000Z';
const fixtures: ReturnType<typeof fixture>[] = [];
function fixture(status = TaskStatus.PENDING) {
  let task: Task = { id: 'task', actorId: 'actor', projectId: 'project', status, title: 'continue', description: 'continue',
    intent: { type: IntentType.CHAT, capability: Capability.GENERAL_CHAT, confidence: 1, requiresWork: true, summary: 'continue' },
    riskLevel: RiskLevel.LOW, context: { platform: 'test', channelId: 'c', userId: 'u' }, createdAt: ts, updatedAt: ts };
  const work: WorkItem = { id: 'work', actorId: 'actor', projectId: 'project', status: WorkItemStatus.ACTIVE,
    origin: 'conversation', resourceRefs: [], createdAt: ts, updatedAt: ts };
  const handoff = createWorkHandoff({ id: 'handoff', workItemId: work.id, fromAgentProfileId: agentProfileId('source'),
    toAgentProfileId: agentProfileId('receiver'), objective: 'continue', resourceRefs: [], artifactIds: [], executionReceiptIds: [], createdAt: ts });
  const binding = { handoffId: handoff.id, taskId: task.id, recordedAt: ts };
  const bindings = { get: vi.fn(async () => binding), admit: vi.fn(async () => binding) };
  const requests = new Map<string, ApprovalRequest>();
  const storage = {
    tasks: { get: vi.fn(async () => ({ ...task })), save: vi.fn(async (updated: Task) => { task = updated; return updated; }) },
    workItems: { get: vi.fn(async () => work) }, workHandoffs: { get: vi.fn(async () => handoff) },
    taskRuns: { get: vi.fn(), start: vi.fn(), save: vi.fn(), listByTask: vi.fn(async () => []) },
    approvals: { get: vi.fn(async (id: string) => requests.get(id) ?? null),
      save: vi.fn(async (request: ApprovalRequest) => { requests.set(request.id, request); return request; }) },
  };
  const profiles = new AgentProfileRegistry(['source', 'receiver'].map(id => ({ id: agentProfileId(id), displayName: id, role: id, purpose: id, instructions: id })));
  const tasks = new TaskManager(storage as unknown as StorageProvider);
  const startRun = vi.spyOn(tasks, 'startRun');
  const transition = vi.spyOn(tasks, 'transition');
  const approvals = new ApprovalManager(storage as unknown as StorageProvider, new ApprovalPolicy(new RiskPolicy()));
  const service = new WorkHandoffContinuationService(storage, profiles, bindings, { tasks, approvals });
  const input = { handoffId: handoff.id, taskId: task.id };
  const f = { get task() { return task; }, work, handoff, binding, bindings, storage, profiles, tasks, approvals, service,
    input, startRun, transition, requests,
    plan(): ExecutionPlan {
      task.planId = 'plan'; task.riskLevel = RiskLevel.HIGH;
      return { id: 'plan', projectId: 'project', goal: 'continue', summary: 'continue', steps: [],
        requiredCapabilities: [Capability.GENERAL_CHAT], requiredResources: [], estimatedChanges: { fileCount: 1, scope: 'local' },
        approvalRequired: true, overallRisk: RiskLevel.HIGH, expectedArtifacts: [], status: ExecutionStatus.PENDING, createdAt: ts,
        integrity: { kind: 'test', contractVersion: '1', digest: 'exact' } };
    },
  };
  fixtures.push(f);
  return f;
}

afterEach(() => {
  for (const f of fixtures.splice(0)) {
    expect(f.startRun).not.toHaveBeenCalled();
    expect(f.storage.taskRuns.start).not.toHaveBeenCalled();
    expect(f.storage.taskRuns.save).not.toHaveBeenCalled();
    expect(f.storage.tasks.save.mock.calls.every(([task]) => task.id === 'task')).toBe(true);
  }
});

describe('continuation Task lifecycle (real lifecycle and Approval owners)', () => {
  it('admits exact provenance and walks PENDING → PLANNING → RUNNING without approval or run effects', async () => {
    const f = fixture();
    expect((await f.service.admit('handoff', 'task')).disposition).toBe('BOUND');
    expect(await f.service.prepare(f.input)).toEqual({ disposition: 'RUNNING_READY', ...f.input });
    expect(f.transition.mock.calls.map(([, status]) => status)).toEqual([TaskStatus.PLANNING, TaskStatus.RUNNING]);
    expect(f.storage.approvals.save).not.toHaveBeenCalled();
    expect(f.task.status).toBe(TaskStatus.RUNNING);
  });
  it('requests via ApprovalManager and stops at WAITING_APPROVAL; exact reentry remains waiting', async () => {
    const f = fixture(); const plan = f.plan();
    const result = await f.service.prepare({ ...f.input, plan });
    expect(result.disposition).toBe('WAITING_FOR_APPROVAL');
    if (result.disposition !== 'WAITING_FOR_APPROVAL') throw new Error('expected wait');
    expect(f.transition.mock.calls.map(([, status]) => status)).toEqual([TaskStatus.PLANNING, TaskStatus.WAITING_APPROVAL]);
    expect(await f.service.prepare({ ...f.input, plan, approvalId: result.approvalId })).toEqual(result);
    expect(f.storage.approvals.save).toHaveBeenCalledTimes(1);
    expect(f.transition).toHaveBeenCalledTimes(2);
    expect(f.task.status).toBe(TaskStatus.WAITING_APPROVAL);
  });
  it('resumes only after ApprovalManager decides the exact request; admission remains independent', async () => {
    const f = fixture(); const plan = f.plan();
    const result = await f.service.prepare({ ...f.input, plan });
    if (result.disposition !== 'WAITING_FOR_APPROVAL' || !result.approvalId) throw new Error('expected approval');
    await f.approvals.decide(result.approvalId, { approvalId: result.approvalId, approved: true, decidedBy: 'human', decidedAt: ts });
    expect((await f.service.prepare({ ...f.input, plan, approvalId: result.approvalId })).disposition).toBe('RUNNING_READY');
    expect(f.transition.mock.calls.map(([, status]) => status)).toEqual([TaskStatus.PLANNING, TaskStatus.WAITING_APPROVAL, TaskStatus.RUNNING]);
    const admission = new ContinuationExecutionAdmissionService(f.storage, f.profiles, f.bindings);
    expect(await admission.evaluate(f.input)).toEqual({ disposition: 'DENY', reason: 'APPROVAL_UNPROVABLE' });
    expect((await admission.evaluate({ ...f.input, plan, approvalId: result.approvalId })).disposition).toBe('ELIGIBLE_TO_START_ATTEMPT');
    const approved = f.requests.get(result.approvalId)!;
    f.requests.set(approved.id, { ...approved, status: ApprovalStatus.REJECTED });
    expect(await admission.evaluate({ ...f.input, plan, approvalId: approved.id })).toEqual({ disposition: 'DENY', reason: 'APPROVAL_NOT_APPROVED' });
  });
  it('an already-approved request still traverses WAITING_APPROVAL on the initial path', async () => {
    const f = fixture(); const plan = f.plan(); const approval = await f.approvals.requestFor(plan, 'actor');
    await f.approvals.decide(approval.id, { approvalId: approval.id, approved: true, decidedBy: 'human', decidedAt: ts });
    expect((await f.service.prepare({ ...f.input, plan, approvalId: approval.id })).disposition).toBe('RUNNING_READY');
    expect(f.transition.mock.calls.map(([, status]) => status)).toEqual([TaskStatus.PLANNING, TaskStatus.WAITING_APPROVAL, TaskStatus.RUNNING]);
    expect(f.requests.size).toBe(1);
  });
  it('PLANNING reentry only requests the remaining transition', async () => {
    const f = fixture(TaskStatus.PLANNING);
    expect((await f.service.prepare(f.input)).disposition).toBe('RUNNING_READY');
    expect(f.transition.mock.calls.map(([, status]) => status)).toEqual([TaskStatus.RUNNING]);
  });
  it('RUNNING reentry is a no-op, not new approval or execution authority', async () => {
    const f = fixture(TaskStatus.RUNNING);
    expect((await f.service.prepare(f.input)).disposition).toBe('ALREADY_RUNNING');
    expect(f.transition).not.toHaveBeenCalled();
    expect(f.storage.approvals.save).not.toHaveBeenCalled();
  });
  it.each([TaskStatus.COMPLETED, TaskStatus.CANCELED, TaskStatus.FAILED, TaskStatus.TESTING, TaskStatus.NEEDS_REVIEW])('denies %s without mutation', async status => {
    const f = fixture(status);
    expect(await f.service.prepare(f.input)).toEqual({ disposition: 'DENY', reason: 'TASK_NOT_PREPARABLE' });
    expect(f.transition).not.toHaveBeenCalled();
  });
  it.each(['task', 'handoff', 'timestamp'])('rejects binding %s mismatch', async field => {
    const f = fixture();
    if (field === 'task') f.binding.taskId = 'unrelated';
    if (field === 'handoff') f.binding.handoffId = 'unrelated';
    if (field === 'timestamp') f.binding.recordedAt = 'bad';
    expect(await f.service.prepare(f.input)).toEqual({ disposition: 'DENY', reason: 'BINDING_MISMATCH' });
    expect(f.transition).not.toHaveBeenCalled();
  });
  it.each([WorkItemStatus.COMPLETED, WorkItemStatus.CANCELED])('rejects inactive %s work even for RUNNING', async status => {
    const f = fixture(TaskStatus.RUNNING); f.work.status = status;
    expect(await f.service.prepare(f.input)).toEqual({ disposition: 'DENY', reason: 'WORK_ITEM_NOT_CONTINUABLE' });
    expect(f.transition).not.toHaveBeenCalled();
  });
  it.each(['actor', 'project', 'id', 'handoff', 'profile'])('rejects canonical %s mismatch', async field => {
    const f = fixture();
    if (field === 'actor') f.task.actorId = 'other';
    if (field === 'project') f.task.projectId = 'other';
    if (field === 'id') f.task.id = 'other';
    if (field === 'handoff') f.storage.workHandoffs.get.mockResolvedValue({ ...f.handoff, objective: '' });
    if (field === 'profile') f.storage.workHandoffs.get.mockResolvedValue({ ...f.handoff, toAgentProfileId: agentProfileId('missing') });
    expect(await f.service.prepare(f.input)).toEqual({ disposition: 'DENY', reason: 'INCONSISTENT_STATE' });
    expect(f.transition).not.toHaveBeenCalled();
  });
  it('fails closed without the live plan and never reconstructs it', async () => {
    const f = fixture(); f.plan();
    expect(await f.service.prepare(f.input)).toEqual({ disposition: 'DENY', reason: 'APPROVAL_UNPROVABLE' });
    expect(f.transition).not.toHaveBeenCalled();
  });
  it('WAITING reentry without exact approval id remains waiting without another request', async () => {
    const f = fixture(TaskStatus.WAITING_APPROVAL); const plan = f.plan();
    expect(await f.service.prepare({ ...f.input, plan })).toEqual({ disposition: 'WAITING_FOR_APPROVAL', ...f.input });
    expect(f.transition).not.toHaveBeenCalled();
    expect(f.storage.approvals.save).not.toHaveBeenCalled();
  });
  it.each(['id', 'goal', 'integrity', 'actor', 'rejected', 'missing'])('rejects %s approval, never selecting another', async field => {
    const f = fixture(TaskStatus.WAITING_APPROVAL); const plan = f.plan(); const approval = await f.approvals.requestFor(plan, 'actor');
    if (field === 'id') approval.executionPlanRef.id = 'other';
    if (field === 'goal') approval.executionPlanRef.goal = 'other';
    if (field === 'integrity') approval.executionPlanRef.integrity = { ...plan.integrity!, digest: 'other' };
    if (field === 'actor') approval.requestedBy = 'other';
    if (field === 'rejected') await f.approvals.decide(approval.id, { approvalId: approval.id, approved: false, decidedBy: 'human', decidedAt: ts });
    expect((await f.service.prepare({ ...f.input, plan, approvalId: field === 'missing' ? 'absent' : approval.id })).disposition).toBe('DENY');
    expect(f.transition).not.toHaveBeenCalled();
  });
  it('does not weaken ApprovalPolicy when task/plan risk facts conflict', async () => {
    const f = fixture(); const plan = f.plan(); plan.overallRisk = RiskLevel.LOW;
    expect(await f.service.prepare({ ...f.input, plan })).toEqual({ disposition: 'DENY', reason: 'APPROVAL_UNPROVABLE' });
    expect(f.transition).not.toHaveBeenCalled();
    expect(f.storage.approvals.save).not.toHaveBeenCalled();
  });
  it('propagates infrastructure failures without mutating', async () => {
    const f = fixture(); f.storage.tasks.get.mockRejectedValue(new Error('storage unavailable'));
    await expect(f.service.prepare(f.input)).rejects.toThrow('storage unavailable');
    expect(f.transition).not.toHaveBeenCalled();
  });
});
