import { describe, expect, it } from 'vitest';
import { ApprovalManager } from './approval-manager';
import { ApprovalPolicy } from './approval-policy';
import { RiskPolicy } from './risk-policy';
import { ApprovalStatus, ExecutionStatus, RiskLevel } from '../domain';
import type { ApprovalRequest, ExecutionPlan } from '../domain';
import type { ApprovalRepository, StorageProvider } from '../ports';

/** In-memory approvals repo + a StorageProvider exposing only it. */
function fakeStorage(): StorageProvider {
  const rows = new Map<string, ApprovalRequest>();
  const approvals: ApprovalRepository = {
    async get(id) {
      return rows.get(id) ?? null;
    },
    async save(entity) {
      rows.set(entity.id, entity);
      return entity;
    },
    async delete(id) {
      rows.delete(id);
    },
    async list() {
      return [...rows.values()];
    },
    async findByExecutionPlan(executionPlanId) {
      return [...rows.values()].filter((r) => r.executionPlanRef.id === executionPlanId);
    },
  };
  return { approvals } as unknown as StorageProvider;
}

function plan(overallRisk: RiskLevel, id = 'plan-1'): ExecutionPlan {
  return {
    id,
    goal: 'do the thing',
    summary: 's',
    steps: [],
    requiredCapabilities: [],
    requiredResources: [],
    estimatedChanges: { fileCount: 0, scope: 'none' },
    approvalRequired: overallRisk === RiskLevel.HIGH || overallRisk === RiskLevel.CRITICAL,
    overallRisk,
    expectedArtifacts: [],
    status: ExecutionStatus.PENDING,
    createdAt: '2026-06-29T00:00:00.000Z',
  };
}

function manager(): ApprovalManager {
  return new ApprovalManager(fakeStorage(), new ApprovalPolicy(new RiskPolicy()));
}

describe('ApprovalManager (CAP-004, ADR-0025)', () => {
  it('requestFor a HIGH-risk plan creates a PENDING request referencing the plan', async () => {
    const req = await manager().requestFor(plan(RiskLevel.HIGH), 'alice');
    expect(req.status).toBe(ApprovalStatus.PENDING);
    expect(req.executionPlanRef).toEqual({ id: 'plan-1', goal: 'do the thing' });
    expect(req.requestedBy).toBe('alice');
    expect(req.decision).toBeUndefined();
  });

  it('requestFor a LOW-risk plan is auto-approved by the system', async () => {
    const req = await manager().requestFor(plan(RiskLevel.LOW), 'alice');
    expect(req.status).toBe(ApprovalStatus.APPROVED);
    expect(req.decision).toBe(true);
    expect(req.decidedBy).toBe('system');
  });

  it('decide() approves/rejects a PENDING request and records the decision', async () => {
    const mgr = manager();
    const req = await mgr.requestFor(plan(RiskLevel.HIGH), 'alice');
    const decided = await mgr.decide(req.id, {
      approvalId: req.id,
      approved: true,
      decidedBy: 'bob',
      decidedAt: '2026-06-29T01:00:00.000Z',
      comment: 'ok',
    });
    expect(decided.status).toBe(ApprovalStatus.APPROVED);
    expect(decided.decision).toBe(true);
    expect(decided.decidedBy).toBe('bob');
    expect(decided.comment).toBe('ok');
    expect(await mgr.isApproved('plan-1')).toBe(true);
  });

  it('decide() throws when the request is missing or already decided', async () => {
    const mgr = manager();
    await expect(
      mgr.decide('nope', { approvalId: 'nope', approved: true, decidedBy: 'x', decidedAt: 't' }),
    ).rejects.toThrow(/not found/);
    const req = await mgr.requestFor(plan(RiskLevel.HIGH), 'a');
    await mgr.decide(req.id, { approvalId: req.id, approved: false, decidedBy: 'b', decidedAt: 't' });
    await expect(
      mgr.decide(req.id, { approvalId: req.id, approved: true, decidedBy: 'c', decidedAt: 't' }),
    ).rejects.toThrow(/already decided/);
  });

  it('NEVER mutates the ExecutionPlan (aggregate ownership)', async () => {
    const p = Object.freeze(plan(RiskLevel.HIGH)); // throws on any write attempt
    const snapshot = JSON.stringify(p);
    await manager().requestFor(p, 'alice');
    expect(JSON.stringify(p)).toBe(snapshot); // plan unchanged
  });
});
