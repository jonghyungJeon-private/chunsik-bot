import { describe, expect, it } from 'vitest';
import { PlanningManager } from './planning-manager';
import { Capability, ExecutionStatus, RiskLevel } from '../domain';
import type { ExecutionPlan, PlanningRequest } from '../domain';
import type { ExecutionPlanner } from '../ports';

function fakePlanner(): { planner: ExecutionPlanner; calls: PlanningRequest[] } {
  const calls: PlanningRequest[] = [];
  const planner: ExecutionPlanner = {
    kind: 'fake',
    async plan(request) {
      calls.push(request);
      return {
        id: 'plan-1',
        goal: request.goal,
        summary: 's',
        steps: [],
        requiredCapabilities: request.requiredCapabilities ?? [],
        requiredResources: [],
        estimatedChanges: { fileCount: 0, scope: 'none' },
        approvalRequired: false,
        overallRisk: RiskLevel.LOW,
        expectedArtifacts: [],
        status: ExecutionStatus.PENDING,
        createdAt: '2026-06-29T00:00:00.000Z',
      } satisfies ExecutionPlan;
    },
  };
  return { planner, calls };
}

describe('PlanningManager (CAP-003)', () => {
  it('delegates to the injected ExecutionPlanner strategy', async () => {
    const { planner, calls } = fakePlanner();
    const mgr = new PlanningManager(planner);
    const plan = await mgr.plan({ goal: 'do x', requiredCapabilities: [Capability.CODE_REVIEW] });
    expect(plan.goal).toBe('do x');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.requiredCapabilities).toEqual([Capability.CODE_REVIEW]);
  });

  it('rejects an empty or whitespace goal', async () => {
    const { planner } = fakePlanner();
    const mgr = new PlanningManager(planner);
    await expect(mgr.plan({ goal: '' })).rejects.toThrow(/goal/);
    await expect(mgr.plan({ goal: '   ' })).rejects.toThrow(/goal/);
  });

  it('planRef returns the lightweight {id, goal} reference', async () => {
    const { planner } = fakePlanner();
    const ref = await new PlanningManager(planner).planRef({ goal: 'do x' });
    expect(ref).toEqual({ id: 'plan-1', goal: 'do x' });
  });
});
