import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { agentProfileId, Capability, ExecutionStatus, IntentType, RiskLevel, TaskRunStatus, TaskStatus, WorkItemStatus } from '../domain';
import type { ExecutionPlan, Task, TaskRun, WorkHandoff, WorkItem } from '../domain';
import type { ContinuationReceiverInput, ContinuationReceiverOutcome } from '../ports';
import { AgentProfileRegistry } from './agent-profile-registry';
import type { ContinuationExecutionResult } from './continuation-execution-service';
import type { ContinuationExecutionRequestContext } from './continuation-execution-product-policy';
import { ContinuationExecutionEntryError } from './continuation-execution-entry-service';
import { ContinuationReceiverExecutionService } from './continuation-receiver-execution-service';
import { WorkHandoffConsumptionError } from './work-handoff-consumption-service';

const ts = '2026-09-22T00:00:00.000Z';
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const work: WorkItem = { id: 'work', actorId: 'actor', projectId: 'project', resourceRefs: [],
    status: WorkItemStatus.ACTIVE, origin: 'conversation', createdAt: ts, updatedAt: ts };
  const handoff: WorkHandoff = { id: 'handoff', workItemId: work.id, fromAgentProfileId: agentProfileId('source'),
    toAgentProfileId: agentProfileId('receiver-b'), objective: 'continue', resourceRefs: [], artifactIds: [],
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
  const storage = {
    workHandoffs: { get: vi.fn(async (_id: string): Promise<WorkHandoff | null> => handoff) },
    workItems: { get: vi.fn(async (_id: string): Promise<WorkItem | null> => work) },
    tasks: { get: vi.fn(async (_id: string): Promise<Task | null> => task) },
  };
  const run: TaskRun = { id: 'exact-run-42', taskId: task.id, attempt: 42, status: TaskRunStatus.STARTED,
    capability: Capability.GENERAL_CHAT, artifactIds: [], startedAt: ts };
  const profiles = new AgentProfileRegistry(['source', 'receiver', 'receiver-b'].map(id => ({ id: agentProfileId(id), displayName: id,
    role: id, purpose: id, instructions: id })));
  const continuation = { startExplicitContinuation: vi.fn(async (_input: ContinuationExecutionRequestContext): Promise<ContinuationExecutionResult> =>
    ({ disposition: 'ATTEMPT_STARTED', taskRun: run })) };
  const tasks = {
    completeRun: vi.fn(async (value: TaskRun, facts: { artifactIds: string[] }) => ({ ...value, ...facts, status: TaskRunStatus.SUCCEEDED })),
    failRun: vi.fn(async (value: TaskRun, error: string) => ({ ...value, error, status: TaskRunStatus.FAILED })),
  };
  const receiver = { receive: vi.fn(async (_input: ContinuationReceiverInput): Promise<ContinuationReceiverOutcome> =>
    ({ disposition: 'SUCCEEDED', artifactIds: ['artifact-1'] })) };
  const execution = new ContinuationReceiverExecutionService(storage, profiles, continuation, tasks, receiver);
  return { work, handoff, task, plan, request, storage, run, profiles, continuation, tasks, receiver, execution };

}

describe('M3E-6K receiver seam and exact-run terminalization', () => {
  it.each(['SUCCEEDED', 'FAILED', 'THROW'] as const)('terminalizes the exact run once for %s', async mode => {
    const f = fixture();
    if (mode === 'FAILED') f.receiver.receive.mockResolvedValue({ disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED' });
    if (mode === 'THROW') f.receiver.receive.mockRejectedValue(new Error('SENSITIVE_SENTINEL secret path stack'));
    const result = await f.execution.executeExplicitContinuation(f.request);
    expect(f.continuation.startExplicitContinuation).toHaveBeenCalledTimes(1);
    expect(f.receiver.receive).toHaveBeenCalledTimes(1);
    const input = f.receiver.receive.mock.calls[0]![0];
    expect(input.taskRun).toBe(f.run);
    expect(input.taskRun.capability).toBe(f.run.capability);
    expect(input.destinationAgentProfile).toBe(f.profiles.get(agentProfileId('receiver-b')));
    expect(input.handoff).toEqual(f.handoff);
    expect(Object.keys(input)).toEqual(['handoff', 'destinationAgentProfile', 'plan', 'taskRun']);
    for (const value of [input, input.handoff, input.handoff.artifactIds, input.destinationAgentProfile,
      input.plan, input.plan.steps[0], input.taskRun, input.taskRun.artifactIds]) expect(Object.isFrozen(value)).toBe(true);
    if (result.disposition === 'DENY') throw new Error('expected terminal result');
    expect(result.taskRun).toMatchObject({ id: 'exact-run-42', taskId: f.run.taskId, attempt: 42, capability: f.run.capability });
    if (mode === 'SUCCEEDED') {
      expect(f.tasks.completeRun).toHaveBeenCalledTimes(1);
      expect(f.tasks.completeRun.mock.calls[0]![0]).toBe(f.run);
      expect(f.tasks.completeRun.mock.calls[0]![1]).toEqual({ artifactIds: ['artifact-1'] });
      expect(f.tasks.failRun).not.toHaveBeenCalled();
      expect(result.disposition).toBe('ATTEMPT_SUCCEEDED');
      expect(result.taskRun).toBe(await f.tasks.completeRun.mock.results[0]!.value);
      expect(result.taskRun.status).toBe(TaskRunStatus.SUCCEEDED);
    } else {
      expect(f.tasks.failRun).toHaveBeenCalledTimes(1);
      expect(f.tasks.failRun.mock.calls[0]![0]).toBe(f.run);
      expect(f.tasks.failRun.mock.calls[0]![1]).toBe('CONTINUATION_RECEIVER_FAILED');
      expect(f.tasks.completeRun).not.toHaveBeenCalled();
      expect(result.disposition).toBe('ATTEMPT_FAILED');
      expect(result.taskRun).toBe(await f.tasks.failRun.mock.results[0]!.value);
      expect(JSON.stringify(result)).not.toContain('SENSITIVE_SENTINEL');
      expect(result.taskRun.status).toBe(TaskRunStatus.FAILED);
    }
  });
  it.each([
    { disposition: 'DENY', stage: 'CONTEXT', reason: 'INVALID_REQUEST' },
    { disposition: 'DENY', stage: 'CANONICAL', reason: 'BINDING_MISMATCH' },
    { disposition: 'DENY', stage: 'PRODUCT_POLICY', reason: 'ACTOR_NOT_AUTHORIZED' },
    { disposition: 'DENY', stage: 'PREPARE', reason: 'HUMAN_WAIT_REQUIRED' },
  ] as const)('preserves 6J denial stage $stage without receiver or terminalization', async denial => {
    const f = fixture(); f.continuation.startExplicitContinuation.mockResolvedValue(denial);
    expect(await f.execution.executeExplicitContinuation(f.request)).toBe(denial);
    expect(f.receiver.receive).not.toHaveBeenCalled();
    expect(f.tasks.completeRun).not.toHaveBeenCalled();
    expect(f.tasks.failRun).not.toHaveBeenCalled();
  });
  it.each(['taskRun', 'destinationAgentProfile', 'handoff', 'workItem', 'task', 'binding', 'receiverOutcome', 'providerId', 'approvalId'])
  ('rejects injected %s before starting', async key => {
    const f = fixture();
    expect(await f.execution.executeExplicitContinuation({ ...f.request, [key]: f.run }))
      .toMatchObject({ disposition: 'DENY', stage: 'CONTEXT' });
    expect(f.storage.workHandoffs.get).not.toHaveBeenCalled();
    expect(f.continuation.startExplicitContinuation).not.toHaveBeenCalled();
    expect(f.receiver.receive).not.toHaveBeenCalled();
  });
  it.each(['missing handoff', 'invalid handoff', 'missing destination'])('preflights %s before start', async mode => {
    const f = fixture();
    if (mode === 'missing handoff') f.storage.workHandoffs.get.mockResolvedValue(null);
    if (mode === 'invalid handoff') f.storage.workHandoffs.get.mockResolvedValue({ ...f.handoff, objective: '' });
    if (mode === 'missing destination') f.storage.workHandoffs.get.mockResolvedValue({ ...f.handoff, toAgentProfileId: agentProfileId('unknown') });
    await expect(f.execution.executeExplicitContinuation(f.request)).rejects.toBeInstanceOf(WorkHandoffConsumptionError);
    expect(f.continuation.startExplicitContinuation).not.toHaveBeenCalled();
    expect(f.receiver.receive).not.toHaveBeenCalled();
    expect(f.tasks.completeRun).not.toHaveBeenCalled();
    expect(f.tasks.failRun).not.toHaveBeenCalled();
  });
  it('unavailable receiver and NO_ACTION never start attempts', async () => {
    const f = fixture();
    const disabled = new ContinuationReceiverExecutionService(f.storage, f.profiles, f.continuation, f.tasks, undefined);
    expect(await disabled.executeExplicitContinuation(f.request)).toMatchObject({ disposition: 'DENY', reason: 'RECEIVER_UNAVAILABLE' });
    f.storage.workItems.get.mockResolvedValue({ ...f.work, status: WorkItemStatus.COMPLETED });
    expect(await f.execution.executeExplicitContinuation(f.request)).toMatchObject({ disposition: 'DENY', reason: 'WORK_ITEM_NOT_CONTINUABLE' });
    expect(f.continuation.startExplicitContinuation).not.toHaveBeenCalled();
    expect(f.receiver.receive).not.toHaveBeenCalled();
    expect(f.tasks.completeRun).not.toHaveBeenCalled();
    expect(f.tasks.failRun).not.toHaveBeenCalled();
  });
  it.each(['SUCCEEDED', 'FAILED', 'THROW'] as const)('propagates terminalization failure without fallback/retry for %s', async mode => {
    const f = fixture(); const error = new Error('storage failure');
    if (mode === 'SUCCEEDED') f.tasks.completeRun.mockRejectedValue(error);
    else {
      f.tasks.failRun.mockRejectedValue(error);
      if (mode === 'FAILED') f.receiver.receive.mockResolvedValue({ disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED' });
      else f.receiver.receive.mockRejectedValue(new Error('receiver failure'));
    }
    await expect(f.execution.executeExplicitContinuation(f.request)).rejects.toBe(error);
    expect(f.receiver.receive).toHaveBeenCalledTimes(1);
    expect(f.tasks.completeRun).toHaveBeenCalledTimes(mode === 'SUCCEEDED' ? 1 : 0);
    expect(f.tasks.failRun).toHaveBeenCalledTimes(mode === 'SUCCEEDED' ? 0 : 1);
    expect(f.run.status).toBe(TaskRunStatus.STARTED);
  });
  it('propagates typed 6J errors without receiver or failure save', async () => {
    const f = fixture(); const error = new ContinuationExecutionEntryError('UNRESOLVED_STARTED_RUN');
    f.continuation.startExplicitContinuation.mockRejectedValue(error);
    await expect(f.execution.executeExplicitContinuation(f.request)).rejects.toBe(error);
    expect(f.continuation.startExplicitContinuation).toHaveBeenCalledTimes(1);
    expect(f.receiver.receive).not.toHaveBeenCalled();
    expect(f.tasks.failRun).not.toHaveBeenCalled();
  });
  it('isolates original request mutations across preflight and uses the same semantic plan in 6J and receiver', async () => {
    const f = fixture(); let release!: (value: WorkHandoff) => void;
    f.storage.workHandoffs.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const before = JSON.parse(JSON.stringify(f.plan));
    const pending = f.execution.executeExplicitContinuation(f.request);
    f.plan.requiredCapabilities.push(Capability.CODE_IMPLEMENTATION);
    f.plan.steps[0]!.title = 'mutated'; f.plan.integrity!.digest = 'mutated'; f.plan.estimatedChanges.scope = 'broad';
    Object.assign(f.request, { taskId: 'other', actorId: 'other' });
    release(f.handoff); await pending;
    const passed = f.continuation.startExplicitContinuation.mock.calls[0]![0];
    expect(passed.plan).toEqual(before);
    expect(f.receiver.receive.mock.calls[0]![0].plan).toBe(passed.plan);
    expect(passed.taskId).toBe('task');
  });
  it('fails malformed outcome closed, without persisting raw error or injected identity', async () => {
    const f = fixture();
    f.receiver.receive.mockResolvedValue({ disposition: 'UNKNOWN', error: 'SENSITIVE_SENTINEL', taskRun: { id: 'other' } } as unknown as ContinuationReceiverOutcome);
    const result = await f.execution.executeExplicitContinuation(f.request);
    expect(result.disposition).toBe('ATTEMPT_FAILED');
    expect(f.tasks.failRun.mock.calls[0]).toEqual([f.run, 'CONTINUATION_RECEIVER_FAILED']);
  });
  it('keeps the port and orchestration provider agnostic with no post-start storage/run lookup', () => {
    const port = readFileSync(new URL('../ports/continuation-receiver.port.ts', import.meta.url), 'utf8');
    const service = readFileSync(new URL('./continuation-receiver-execution-service.ts', import.meta.url), 'utf8');
    for (const source of [port, service]) {
      expect(source).not.toMatch(/from ['"](?:@quoky\/|@nestjs\/|discord)/);
      expect(source).not.toMatch(/ClaudeCliProvider|CodexCliProvider|OllamaCliProvider|CapabilityRouter|AiProviderManager/);
    }
    expect(service).not.toMatch(/\.taskRuns\.|listByTask|\.guardedStart\(|\.startRun\(/);
  });
});
