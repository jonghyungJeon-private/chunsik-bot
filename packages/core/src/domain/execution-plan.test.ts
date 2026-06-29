import { describe, expect, it } from 'vitest';
import { executionPlanRef } from './execution-plan';
import { ExecutionStatus, RiskLevel } from './enums';
import type { ExecutionPlan } from './execution-plan';

const plan: ExecutionPlan = {
  id: 'p1',
  goal: 'ship it',
  summary: 's',
  steps: [],
  requiredCapabilities: [],
  requiredResources: [],
  estimatedChanges: { fileCount: 0, scope: 'none' },
  approvalRequired: false,
  overallRisk: RiskLevel.LOW,
  expectedArtifacts: [],
  status: ExecutionStatus.PENDING,
  createdAt: '2026-06-29T00:00:00.000Z',
};

describe('execution-plan domain (CAP-003, ADR-0024)', () => {
  it('executionPlanRef derives a lightweight {id, goal} handle', () => {
    expect(executionPlanRef(plan)).toEqual({ id: 'p1', goal: 'ship it' });
  });

  it('ExecutionStatus reserves the full lifecycle', () => {
    expect(Object.values(ExecutionStatus)).toEqual([
      'PENDING',
      'APPROVED',
      'REJECTED',
      'EXECUTING',
      'COMPLETED',
      'FAILED',
    ]);
  });
});
