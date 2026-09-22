import { describe, expect, it, vi } from 'vitest';
import { ApprovalStatus, Capability, ExecutionStatus, executionPlanRef, IntentType, RiskLevel,
  TaskStatus, WorkItemStatus } from '../domain';
import type { ApprovalRequest, ExecutionPlan, Task, WorkItem } from '../domain';
import { ApprovalPolicy } from './approval-policy';
import { RiskPolicy } from './risk-policy';
import { ContinuationExecutionProductPolicy, createContinuationExecutionRequestContext } from './continuation-execution-product-policy';
import type { ContinuationExecutionRequestContext } from './continuation-execution-product-policy';

const TS = '2026-09-22T00:00:00.000Z';
const supported = [Capability.GENERAL_CHAT, Capability.SUMMARIZATION, Capability.DOCUMENT_ANALYSIS,
  Capability.CODE_REVIEW, Capability.ARCHITECTURE_PLANNING, Capability.READONLY_LOOKUP, Capability.PROJECT_ANALYSIS];
const denied = [Capability.CODE_IMPLEMENTATION, Capability.TEST_EXECUTION, Capability.EMBEDDING];
function fixture(capability = Capability.GENERAL_CHAT) {
  const work: WorkItem = { id: 'work', actorId: 'actor', projectId: 'project', resourceRefs: [],
    status: WorkItemStatus.ACTIVE, origin: 'conversation', createdAt: TS, updatedAt: TS };
  const task: Task = { id: 'task', actorId: 'actor', projectId: 'project', title: 'Continue',
    description: 'Continue', status: TaskStatus.RUNNING, planId: 'plan',
    intent: { type: IntentType.CHAT, capability, confidence: 1, requiresWork: true, summary: 'Continue' },
    riskLevel: RiskLevel.LOW, context: { platform: 'test', channelId: 'channel', userId: 'user' },
    createdAt: TS, updatedAt: TS };
  const plan: ExecutionPlan = { id: 'plan', goal: 'Continue', summary: 'Continue', projectId: 'project', steps: [],
    requiredCapabilities: [capability], requiredResources: [], estimatedChanges: { fileCount: 0, scope: 'none' },
    approvalRequired: false, overallRisk: RiskLevel.LOW, expectedArtifacts: [], status: ExecutionStatus.PENDING,
    createdAt: TS, integrity: { kind: 'test', contractVersion: '1', digest: 'exact' } };
  const request: ContinuationExecutionRequestContext = { trigger: 'EXPLICIT_CONTINUATION_EXECUTION_REQUEST',
    handoffId: 'handoff', taskId: task.id, actorId: 'actor', projectId: 'project', plan };
  return { work, task, plan, request };
}
const policy = new ContinuationExecutionProductPolicy();
const deny = (reason: string) => ({ disposition: 'DENY', reason });
const eligible = { disposition: 'ELIGIBLE_NO_WAIT' };

describe('M3E-6I-b Product Decision / Family A', () => {
  it.each(supported)('accepts explicit exact actor/project scope for %s', capability => {
    const { request, work, task } = fixture(capability);
    expect(policy.evaluate(request, work, task)).toEqual(eligible);
  });
  it.each([undefined, '', 'WORK_HANDOFF_CREATED', 'CONTINUATION_BINDING_EXISTS', 'WORK_ITEM_ACTIVE',
    'TASK_RUNNING', 'APPROVAL_APPROVED', 'AGENT_PROFILE_PRESENT', 'DI_REGISTRATION'])('denies implicit/wrong trigger %s', trigger => {
    const { request, work, task } = fixture();
    expect(policy.evaluate({ ...request, trigger } as ContinuationExecutionRequestContext, work, task))
      .toEqual(deny('UNSUPPORTED_TRIGGER'));
  });
  it.each([undefined, '', ' actor ', 'other'])('denies missing/cross actor %s without context-user fallback', actorId => {
    const { request, work, task } = fixture();
    task.context.userId = 'actor';
    expect(policy.evaluate({ ...request, actorId } as ContinuationExecutionRequestContext, work, task))
      .toEqual(deny('ACTOR_NOT_AUTHORIZED'));
  });
  it('requires both canonical actor facts, not just their relational equality', () => {
    const { request, work, task } = fixture();
    expect(policy.evaluate(request, { ...work, actorId: 'other' }, { ...task, actorId: 'other' }))
      .toEqual(deny('ACTOR_NOT_AUTHORIZED'));
    expect(policy.evaluate(request, work, { ...task, actorId: undefined })).toEqual(deny('ACTOR_NOT_AUTHORIZED'));
    expect(policy.evaluate(request, { ...work, actorId: 'other' }, task)).toEqual(deny('ACTOR_NOT_AUTHORIZED'));
  });
  it.each([
    ['project', 'project', 'other'], ['project', 'other', 'project'], ['other', 'project', 'project'],
    [undefined, 'project', 'project'], ['project', undefined, 'project'], ['project', 'project', undefined],
    ['project', undefined, undefined], [undefined, 'project', undefined], [undefined, undefined, 'project'],
    ['', '', ''], [' project ', ' project ', ' project '],
  ])('denies project mismatch request=%s work=%s task=%s', (r, w, t) => {
    const { request, work, task } = fixture();
    expect(policy.evaluate({ ...request, projectId: r }, { ...work, projectId: w }, { ...task, projectId: t }))
      .toEqual(deny('PROJECT_NOT_AUTHORIZED'));
  });
  it('accepts exact projectless scope', () => {
    const { request, work, task, plan } = fixture();
    delete plan.projectId;
    expect(policy.evaluate({ ...request, projectId: undefined }, { ...work, projectId: undefined },
      { ...task, projectId: undefined })).toEqual(eligible);
  });
  it.each(denied)('denies Task capability %s', capability => {
    const { request, work, task } = fixture(capability);
    expect(policy.evaluate(request, work, task)).toEqual(deny('UNSUPPORTED_RECEIVER_CAPABILITY'));
  });
  it.each(denied)('denies safe Task smuggling plan capability %s', capability => {
    const { request, work, task, plan } = fixture(Capability.READONLY_LOOKUP);
    plan.requiredCapabilities.push(capability);
    expect(policy.evaluate(request, work, task)).toEqual(deny('UNSUPPORTED_RECEIVER_CAPABILITY'));
  });
  it.each([...denied, Capability.SUMMARIZATION])('denies hidden/undeclared execution step %s', capability => {
    const { request, work, task, plan } = fixture();
    plan.steps.push({ id: 'step', title: 'hidden', description: 'hidden', capability, status: ExecutionStatus.PENDING });
    expect(policy.evaluate(request, work, task)).toEqual(deny('UNSUPPORTED_RECEIVER_CAPABILITY'));
  });
  it.each([RiskLevel.HIGH, RiskLevel.CRITICAL])('denies actual Task and plan risk %s', risk => {
    const { request, work, task, plan } = fixture(Capability.CODE_REVIEW);
    task.riskLevel = risk;
    expect(policy.evaluate(request, work, task)).toEqual(deny('HUMAN_WAIT_REQUIRED'));
    task.riskLevel = RiskLevel.LOW;
    plan.overallRisk = risk;
    expect(policy.evaluate(request, work, task)).toEqual(deny('HUMAN_WAIT_REQUIRED'));
  });
  it('denies explicit plan approval even when baseline policy is LOW', () => {
    const { request, work, task, plan } = fixture();
    plan.approvalRequired = true;
    expect(policy.evaluate(request, work, task)).toEqual(deny('HUMAN_WAIT_REQUIRED'));
  });
  it('honors ApprovalPolicy even if the other gates do not require approval', () => {
    const { request, work, task } = fixture();
    const spy = vi.spyOn(ApprovalPolicy.prototype, 'evaluate').mockReturnValue({ requiresApproval: true,
      riskLevel: RiskLevel.LOW, reason: 'policy gate', requestedBy: 'actor' });
    try { expect(policy.evaluate(request, work, task)).toEqual(deny('HUMAN_WAIT_REQUIRED')); }
    finally { spy.mockRestore(); }
  });
  it('honors canonical capability-risk policy for task and additional plan requirements', () => {
    const { request, work, task, plan } = fixture();
    const original = RiskPolicy.prototype.assessCapability;
    const spy = vi.spyOn(RiskPolicy.prototype, 'assessCapability').mockImplementation(function (this: RiskPolicy, capability) {
      return capability === Capability.SUMMARIZATION ? RiskLevel.HIGH : original.call(this, capability);
    });
    try {
      plan.requiredCapabilities.push(Capability.SUMMARIZATION);
      expect(policy.evaluate(request, work, task)).toEqual(deny('HUMAN_WAIT_REQUIRED'));
      task.intent.capability = Capability.SUMMARIZATION;
      expect(policy.evaluate(request, work, task)).toEqual(deny('HUMAN_WAIT_REQUIRED'));
    } finally { spy.mockRestore(); }
  });
  it('an exact APPROVED request / supplied approvalId cannot bypass no-wait policy', () => {
    const { request, work, task, plan } = fixture();
    plan.approvalRequired = true;
    const approval: ApprovalRequest = { id: 'approval', executionPlanRef: executionPlanRef(plan),
      status: ApprovalStatus.APPROVED, riskLevel: RiskLevel.HIGH, reason: 'approved', requestedBy: 'actor',
      createdAt: TS, updatedAt: TS, decision: true, decidedBy: 'actor', decidedAt: TS };
    const external = { ...request, approvalId: approval.id, approval };
    expect(policy.evaluate(external, work, task)).toEqual(deny('HUMAN_WAIT_REQUIRED'));
  });
  it.each([undefined, null])('requires supplied live plan despite Task.planId (%s)', plan => {
    const { request, work, task } = fixture();
    expect(policy.evaluate({ ...request, plan } as unknown as ContinuationExecutionRequestContext, work, task))
      .toEqual(deny('PLAN_UNPROVABLE'));
  });
  it('fails closed on malformed plan, unknown risk/capability and wrong Task', () => {
    const { request, work, task, plan } = fixture();
    expect(policy.evaluate({ ...request, taskId: 'other' }, work, task)).toEqual(deny('INVALID_REQUEST'));
    expect(policy.evaluate(request, work, { ...task, riskLevel: 'UNKNOWN' as RiskLevel })).toEqual(deny('INVALID_REQUEST'));
    plan.requiredCapabilities.push('UNKNOWN' as Capability);
    expect(policy.evaluate(request, work, task)).toEqual(deny('PLAN_UNPROVABLE'));
    plan.requiredCapabilities = [Capability.GENERAL_CHAT];
    plan.id = 'other';
    expect(policy.evaluate(request, work, task)).toEqual(deny('PLAN_UNPROVABLE'));
  });
  it('creates an isolated recursively frozen context; pure decisions have no start/approval/receiver effects', () => {
    const { request, work, task, plan } = fixture();
    const context = createContinuationExecutionRequestContext(request);
    plan.requiredCapabilities.push(Capability.CODE_IMPLEMENTATION);
    expect(context.plan.requiredCapabilities).toEqual([Capability.GENERAL_CHAT]);
    for (const value of [context, context.plan, context.plan.steps, context.plan.requiredCapabilities,
      context.plan.requiredResources, context.plan.expectedArtifacts, context.plan.estimatedChanges, context.plan.integrity]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    const before = JSON.stringify([context, work, task]);
    const result = policy.evaluate(context, Object.freeze(work), Object.freeze(task));
    expect(result).toEqual(eligible);
    expect(Object.keys(result)).toEqual(['disposition']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(policy.evaluate(context, work, task)).toEqual(result);
    expect(JSON.stringify([context, work, task])).toBe(before);
    // No storage, manager, provider, receiver, clock or callbacks can be supplied to this evaluator.
    expect(Object.keys(policy)).toEqual([]);
  });
});
