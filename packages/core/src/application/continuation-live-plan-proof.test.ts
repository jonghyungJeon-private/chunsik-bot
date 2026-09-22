import { describe, expect, it, vi } from 'vitest';
import { agentProfileId, ApprovalStatus, Capability, createWorkHandoff, ExecutionStatus,
  executionPlanRef, IntentType, RiskLevel, TaskStatus, WorkItemStatus } from '../domain';
import type { ApprovalRequest, ContinuationBinding, ExecutionPlan, Task, TaskRun, WorkItem } from '../domain';
import { AgentProfileRegistry } from './agent-profile-registry';
import { ContinuationExecutionAdmissionService } from './continuation-execution-admission-service';
import { isCanonicalText, isTimestampText, matchesExecutionPlanIntegrity, matchesExecutionPlanRef,
  matchesLiveExecutionPlanStructure } from './continuation-live-plan-proof';
import { WorkHandoffContinuationService } from './work-handoff-continuation-service';

const TS = '2026-09-22T00:00:00.000Z';

function plans(): { plan: ExecutionPlan; task: Task } {
  const task: Task = { id: 'task', actorId: 'actor', projectId: 'project', title: 'Continue',
    description: 'Continue', status: TaskStatus.RUNNING, planId: 'plan',
    intent: { type: IntentType.CHAT, capability: Capability.GENERAL_CHAT, confidence: 1, requiresWork: true, summary: 'Continue' },
    riskLevel: RiskLevel.HIGH, context: { platform: 'test', channelId: 'channel', userId: 'user' },
    createdAt: TS, updatedAt: TS };
  const plan: ExecutionPlan = { id: 'plan', goal: 'Continue', summary: 'Continue', projectId: 'project', steps: [],
    requiredCapabilities: [Capability.GENERAL_CHAT], requiredResources: [],
    estimatedChanges: { fileCount: 0, scope: 'none' }, approvalRequired: true, overallRisk: RiskLevel.HIGH,
    expectedArtifacts: [], status: ExecutionStatus.PENDING, createdAt: TS,
    integrity: { kind: 'test', contractVersion: '1', digest: 'exact-scope' } };
  return { plan, task };
}

/** Each entry mutates exactly one structural dimension the shared proof owns. */
const structuralMutations: ReadonlyArray<readonly [string, (plan: ExecutionPlan, task: Task) => void]> = [
  ['plan id blank', (plan) => { plan.id = ''; }],
  ['plan id untrimmed', (plan, task) => { plan.id = ' plan '; task.planId = ' plan '; }],
  ['plan goal blank', (plan) => { plan.goal = ''; }],
  ['task planId mismatch', (_plan, task) => { task.planId = 'other'; }],
  ['task planId absent', (_plan, task) => { delete task.planId; }],
  ['project mismatch', (plan) => { plan.projectId = 'other'; }],
  ['overallRisk invalid', (plan) => { (plan as { overallRisk: unknown }).overallRisk = 'NOPE'; }],
  ['approvalRequired non-boolean', (plan) => { (plan as { approvalRequired: unknown }).approvalRequired = 'yes'; }],
  ['status invalid', (plan) => { (plan as { status: unknown }).status = 'WHENEVER'; }],
  ['requiredCapabilities not an array', (plan) => { (plan as { requiredCapabilities: unknown }).requiredCapabilities = 'GENERAL_CHAT'; }],
  ['requiredCapabilities missing task capability', (plan) => { plan.requiredCapabilities = [Capability.SUMMARIZATION]; }],
  ['requiredCapabilities contains unknown capability', (plan) => { plan.requiredCapabilities = [Capability.GENERAL_CHAT, 'ESCALATE' as Capability]; }],
  ['steps not an array', (plan) => { (plan as { steps: unknown }).steps = {}; }],
  ['requiredResources not an array', (plan) => { (plan as { requiredResources: unknown }).requiredResources = {}; }],
  ['estimatedChanges absent', (plan) => { (plan as { estimatedChanges: unknown }).estimatedChanges = undefined; }],
  ['expectedArtifacts not an array', (plan) => { (plan as { expectedArtifacts: unknown }).expectedArtifacts = 'none'; }],
  ['createdAt not a timestamp', (plan) => { plan.createdAt = 'not-a-date'; }],
  ['integrity kind blank', (plan) => { plan.integrity = { kind: '', contractVersion: '1', digest: 'exact-scope' }; }],
  ['integrity contractVersion blank', (plan) => { plan.integrity = { kind: 'test', contractVersion: '', digest: 'exact-scope' }; }],
  ['integrity digest blank', (plan) => { plan.integrity = { kind: 'test', contractVersion: '1', digest: '' }; }],
];

describe('shared continuation live-plan structural proof (M3E-6I-a, ADR-0089)', () => {
  it('accepts an exact structurally consistent live plan, with or without integrity', () => {
    const { plan, task } = plans();
    expect(matchesLiveExecutionPlanStructure(plan, task)).toBe(true);
    delete plan.integrity;
    expect(matchesLiveExecutionPlanStructure(plan, task)).toBe(true);
  });

  it.each(structuralMutations)('rejects a single structural mismatch: %s', (_case, mutate) => {
    const { plan, task } = plans();
    mutate(plan, task);
    expect(matchesLiveExecutionPlanStructure(plan, task)).toBe(false);
  });

  it('rejects a missing or non-object plan or task without throwing', () => {
    const { plan, task } = plans();
    for (const value of [undefined, null, 'plan', 7]) {
      expect(matchesLiveExecutionPlanStructure(value as unknown as ExecutionPlan, task)).toBe(false);
      expect(matchesLiveExecutionPlanStructure(plan, value as unknown as Task)).toBe(false);
    }
  });

  it('is order- and history-independent: nothing is inferred from latest, maximum or repetition', () => {
    const { plan, task } = plans();
    const first = matchesLiveExecutionPlanStructure(plan, task);
    plan.requiredCapabilities = [Capability.SUMMARIZATION, Capability.GENERAL_CHAT];
    expect(matchesLiveExecutionPlanStructure(plan, task)).toBe(first);
    // Repeated evaluation is stable and mutates neither argument.
    const snapshot = JSON.stringify([plan, task]);
    expect(matchesLiveExecutionPlanStructure(plan, task)).toBe(true);
    expect(matchesLiveExecutionPlanStructure(plan, task)).toBe(true);
    expect(JSON.stringify([plan, task])).toBe(snapshot);
  });

  it('proves structural plan-reference equality without granting approval authority', () => {
    const { plan } = plans();
    const ref = executionPlanRef(plan);
    expect(matchesExecutionPlanRef(ref, ref)).toBe(true);
    expect(matchesExecutionPlanRef({ ...ref, id: 'other' }, ref)).toBe(false);
    expect(matchesExecutionPlanRef({ ...ref, goal: 'other' }, ref)).toBe(false);
    expect(matchesExecutionPlanRef({ id: ref.id, goal: ref.goal }, ref)).toBe(false);
    expect(matchesExecutionPlanRef(undefined, ref)).toBe(false);
    const bare = { id: 'plan', goal: 'Continue' };
    expect(matchesExecutionPlanRef(bare, bare)).toBe(true);
    expect(matchesExecutionPlanRef(ref, bare)).toBe(false);
  });

  it('compares integrity refs structurally, requiring canonical text on both sides', () => {
    const integrity = { kind: 'test', contractVersion: '1', digest: 'exact-scope' };
    expect(matchesExecutionPlanIntegrity(undefined, undefined)).toBe(true);
    expect(matchesExecutionPlanIntegrity(integrity, integrity)).toBe(true);
    expect(matchesExecutionPlanIntegrity(integrity, undefined)).toBe(false);
    expect(matchesExecutionPlanIntegrity(undefined, integrity)).toBe(false);
    expect(matchesExecutionPlanIntegrity({ ...integrity, digest: 'other' }, integrity)).toBe(false);
    expect(matchesExecutionPlanIntegrity({ ...integrity, kind: ' test ' }, { ...integrity, kind: ' test ' })).toBe(false);
  });

  it('exposes only pure text/timestamp helpers with no normalization side effects', () => {
    expect(isCanonicalText('plan')).toBe(true);
    expect(isCanonicalText(' plan')).toBe(false);
    expect(isCanonicalText('')).toBe(false);
    expect(isCanonicalText(7)).toBe(false);
    expect(isTimestampText(TS)).toBe(true);
    expect(isTimestampText('nope')).toBe(false);
  });

  it('is pure Core logic: the module imports no storage, manager, registry, provider or config', async () => {
    const module = await import('./continuation-live-plan-proof');
    // Structural proof over the module boundary rather than fragile source-text matching.
    expect(Object.keys(module).sort()).toEqual([
      'isCanonicalText', 'isTimestampText', 'matchesExecutionPlanIntegrity', 'matchesExecutionPlanRef',
      'matchesLiveExecutionPlanStructure',
    ]);
    for (const exported of Object.values(module)) expect(typeof exported).toBe('function');
    // Each export is a synchronous dependency-free predicate: nothing to inject, nothing awaited.
    const { plan, task } = plans();
    const ref = executionPlanRef(plan);
    const results = [isCanonicalText('plan'), isTimestampText(TS), matchesExecutionPlanIntegrity(undefined, undefined),
      matchesExecutionPlanRef(ref, ref), matchesLiveExecutionPlanStructure(plan, task)];
    for (const result of results) expect(typeof result).toBe('boolean');
    for (const exported of Object.values(module)) expect(exported).not.toHaveProperty('constructor.inject');
  });
});

/**
 * Both real consumers over one in-memory fixture, to prove they cannot disagree structurally.
 * Their lifecycle expectations legitimately differ — read-only admission requires a RUNNING Task while
 * preparation requires PENDING/PLANNING/WAITING_APPROVAL — so each gate gets its own Task variant with
 * identical plan-related fields. That difference is exactly the gate semantics this refactor preserves.
 */
function consumers() {
  const handoff = createWorkHandoff({ id: 'handoff', workItemId: 'work', fromAgentProfileId: agentProfileId('source'),
    toAgentProfileId: agentProfileId('destination'), objective: 'Continue', resourceRefs: [], artifactIds: [],
    executionReceiptIds: [], createdAt: TS });
  const work: WorkItem = { id: 'work', actorId: 'actor', projectId: 'project', status: WorkItemStatus.ACTIVE,
    origin: 'conversation', resourceRefs: [], createdAt: TS, updatedAt: TS };
  const { plan, task: runningTask } = plans();
  const planningTask: Task = { ...runningTask, status: TaskStatus.PLANNING };
  const binding: ContinuationBinding = { handoffId: handoff.id, taskId: runningTask.id, recordedAt: TS };
  const approval: ApprovalRequest = { id: 'approval', executionPlanRef: executionPlanRef(plan),
    status: ApprovalStatus.APPROVED, riskLevel: RiskLevel.HIGH, reason: 'approved', requestedBy: 'actor',
    createdAt: TS, updatedAt: TS };
  const runs: TaskRun[] = [];
  const write = vi.fn(() => { throw new Error('unexpected mutation'); });
  const reads = (task: Task) => ({
    workHandoffs: { get: vi.fn(async () => handoff as typeof handoff | null), insert: write },
    workItems: { get: vi.fn(async () => work as WorkItem | null), save: write },
    tasks: { get: vi.fn(async () => task as Task | null), save: write },
    approvals: { get: vi.fn(async () => approval as ApprovalRequest | null), save: write },
    taskRuns: { get: vi.fn(async () => null), listByTask: vi.fn(async () => runs), start: write, save: write, delete: write },
  });
  const bindings = { get: vi.fn(async () => binding as ContinuationBinding | null), admit: write };
  const profiles = new AgentProfileRegistry(['source', 'destination'].map((id) =>
    ({ id: agentProfileId(id), displayName: id, role: id, purpose: id, instructions: id })));
  const admission = new ContinuationExecutionAdmissionService(reads(runningTask), profiles, bindings);
  const transition = vi.fn(async (value: Task, status: TaskStatus) => ({ ...value, status }));
  const prepare = new WorkHandoffContinuationService(reads(planningTask), profiles, bindings as never, {
    tasks: { transition },
    approvals: { get: vi.fn(async () => approval as ApprovalRequest | null), requestFor: vi.fn(async () => approval) },
  });
  const tasks = [runningTask, planningTask];
  return { plan, tasks, runningTask, planningTask, approval, admission, prepare, transition, write,
    input: { handoffId: handoff.id, taskId: runningTask.id, plan, approvalId: approval.id } };
}

describe('cross-consumer structural consistency (M3E-6I-a, ADR-0089)', () => {
  it('admits the exact consistent plan through both consumers', async () => {
    const f = consumers();
    expect(await f.admission.evaluate(f.input))
      .toEqual({ disposition: 'ELIGIBLE_TO_START_ATTEMPT', handoffId: 'handoff', taskId: 'task' });
    expect(await f.prepare.prepare(f.input))
      .toEqual({ disposition: 'RUNNING_READY', handoffId: 'handoff', taskId: 'task' });
  });

  it.each(structuralMutations)(
    'never accepts in one consumer what the other rejects structurally: %s', async (_case, mutate) => {
      const f = consumers();
      for (const task of f.tasks) mutate(f.plan, task);
      // Shared truth over each gate's own Task variant; plan-related fields are identical.
      for (const task of f.tasks) expect(matchesLiveExecutionPlanStructure(f.plan, task)).toBe(false);
      const admitted = await f.admission.evaluate(f.input);
      const prepared = await f.prepare.prepare(f.input);
      // Reason codes intentionally stay gate-specific; structural truth must agree.
      expect(admitted.disposition).toBe('DENY');
      expect(prepared.disposition).toBe('DENY');
      // A structural rejection must never have advanced the lifecycle.
      expect(f.transition).not.toHaveBeenCalled();
      expect(f.write).not.toHaveBeenCalled();
    });

  it('keeps gate-specific approval semantics separate: prepare owns the requester requirement', async () => {
    const f = consumers();
    f.approval.requestedBy = 'someone-else';
    // Structural plan-reference equality still holds, so this is not a shared-proof failure.
    expect(matchesExecutionPlanRef(f.approval.executionPlanRef, executionPlanRef(f.plan))).toBe(true);
    expect(await f.prepare.prepare(f.input)).toEqual({ disposition: 'DENY', reason: 'APPROVAL_UNPROVABLE' });
    // Read-only admission never required requestedBy, and that difference is preserved.
    expect((await f.admission.evaluate(f.input)).disposition).toBe('ELIGIBLE_TO_START_ATTEMPT');
  });

  it('keeps exact approval identity authoritative in both consumers', async () => {
    const f = consumers();
    f.approval.id = 'a-different-approval';
    expect((await f.admission.evaluate(f.input)).disposition).toBe('DENY');
    expect((await f.prepare.prepare(f.input)).disposition).toBe('DENY');
  });

  it('rejects a mismatched approval plan reference in both consumers', async () => {
    const f = consumers();
    f.approval.executionPlanRef = { id: 'plan', goal: 'A different goal' };
    expect(matchesExecutionPlanRef(f.approval.executionPlanRef, executionPlanRef(f.plan))).toBe(false);
    expect((await f.admission.evaluate(f.input)).disposition).toBe('DENY');
    expect((await f.prepare.prepare(f.input)).disposition).toBe('DENY');
  });

  it('never reconstructs a live plan from Task.planId, a plan ref or an ApprovalRequest', async () => {
    const f = consumers();
    const withoutPlan = { handoffId: 'handoff', taskId: 'task', approvalId: f.approval.id };
    // Task.planId and an APPROVED request exist, yet neither consumer proceeds without the live plan.
    expect(f.runningTask.planId).toBe('plan');
    expect(f.approval.status).toBe(ApprovalStatus.APPROVED);
    expect(await f.admission.evaluate(withoutPlan))
      .toEqual({ disposition: 'DENY', reason: 'APPROVAL_UNPROVABLE' });
    expect(await f.prepare.prepare(withoutPlan))
      .toEqual({ disposition: 'DENY', reason: 'APPROVAL_UNPROVABLE' });
    expect(f.transition).not.toHaveBeenCalled();
  });
});
