import { describe, expect, it } from 'vitest';
import { ApprovalPolicy } from './approval-policy';
import { RiskPolicy } from './risk-policy';
import { ExecutionStatus, RiskLevel } from '../domain';
import type { ExecutionPlan } from '../domain';

const policy = new ApprovalPolicy(new RiskPolicy());

function planWithRisk(overallRisk: RiskLevel): ExecutionPlan {
  return {
    id: 'p1',
    goal: 'g',
    summary: 's',
    steps: [],
    requiredCapabilities: [],
    requiredResources: [],
    estimatedChanges: { fileCount: 0, scope: 'none' },
    approvalRequired: false,
    overallRisk,
    expectedArtifacts: [],
    status: ExecutionStatus.PENDING,
    createdAt: '2026-06-29T00:00:00.000Z',
  };
}

describe('ApprovalPolicy (CAP-004, ADR-0025)', () => {
  it('requires approval for HIGH / CRITICAL risk', () => {
    for (const r of [RiskLevel.HIGH, RiskLevel.CRITICAL]) {
      const e = policy.evaluate(planWithRisk(r), 'alice');
      expect(e.requiresApproval).toBe(true);
      expect(e.riskLevel).toBe(r);
      expect(e.requestedBy).toBe('alice');
      expect(e.reason).toMatch(/requires/);
    }
  });

  it('does not require approval for LOW / MEDIUM risk', () => {
    for (const r of [RiskLevel.LOW, RiskLevel.MEDIUM]) {
      const e = policy.evaluate(planWithRisk(r), 'bob');
      expect(e.requiresApproval).toBe(false);
      expect(e.reason).toMatch(/auto-approved/);
    }
  });
});
