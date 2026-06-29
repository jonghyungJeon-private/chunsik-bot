import { describe, expect, it } from 'vitest';
import { DeterministicPlanner } from './deterministic-planner';
import { RiskPolicy } from './risk-policy';
import { ArtifactKind, Capability, ExecutionStatus, RiskLevel } from '../domain';
import type { ExecutionPlan, PlanningRequest } from '../domain';

const planner = new DeterministicPlanner(new RiskPolicy());

/** Strip the non-deterministic bits (ids, timestamp) for equality checks. */
function stable(plan: ExecutionPlan) {
  return {
    goal: plan.goal,
    summary: plan.summary,
    requiredCapabilities: plan.requiredCapabilities,
    requiredResources: plan.requiredResources,
    estimatedChanges: plan.estimatedChanges,
    approvalRequired: plan.approvalRequired,
    overallRisk: plan.overallRisk,
    expectedArtifacts: plan.expectedArtifacts,
    status: plan.status,
    steps: plan.steps.map((s) => ({
      title: s.title,
      description: s.description,
      capability: s.capability,
      status: s.status,
    })),
  };
}

describe('DeterministicPlanner (CAP-003, ADR-0024)', () => {
  it('is deterministic — same request yields the same plan (modulo id/timestamp)', async () => {
    const req: PlanningRequest = {
      goal: 'add a feature',
      requiredCapabilities: [Capability.CODE_IMPLEMENTATION, Capability.TEST_EXECUTION],
      requiredResources: ['a.ts', 'b.ts'],
    };
    expect(stable(await planner.plan(req))).toEqual(stable(await planner.plan(req)));
  });

  it('derives overallRisk + approvalRequired from RiskPolicy', async () => {
    const plan = await planner.plan({
      goal: 'edit code',
      requiredCapabilities: [Capability.GENERAL_CHAT, Capability.CODE_IMPLEMENTATION],
    });
    expect(plan.overallRisk).toBe(RiskLevel.MEDIUM); // max(LOW, MEDIUM)
    expect(plan.approvalRequired).toBe(false); // MEDIUM is auto (not HIGH/CRITICAL)
  });

  it('creates one PENDING step per required capability', async () => {
    const plan = await planner.plan({
      goal: 'g',
      requiredCapabilities: [Capability.CODE_REVIEW, Capability.TEST_EXECUTION],
    });
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps.map((s) => s.capability)).toEqual([
      Capability.CODE_REVIEW,
      Capability.TEST_EXECUTION,
    ]);
    expect(plan.steps.every((s) => s.status === ExecutionStatus.PENDING)).toBe(true);
    expect(plan.steps.every((s) => s.id.length > 0)).toBe(true);
  });

  it('maps capabilities to expected artifacts', async () => {
    const plan = await planner.plan({
      goal: 'g',
      requiredCapabilities: [Capability.CODE_IMPLEMENTATION, Capability.TEST_EXECUTION],
    });
    expect(plan.expectedArtifacts).toContain(ArtifactKind.CODE_DIFF);
    expect(plan.expectedArtifacts).toContain(ArtifactKind.PATCH);
    expect(plan.expectedArtifacts).toContain(ArtifactKind.TEST_LOG);
  });

  it('estimatedChanges scope follows resource count; passes through changed lines', async () => {
    expect((await planner.plan({ goal: 'g' })).estimatedChanges.scope).toBe('none');
    expect(
      (await planner.plan({ goal: 'g', requiredResources: ['a', 'b', 'c'] })).estimatedChanges.scope,
    ).toBe('local');
    const broad = await planner.plan({
      goal: 'g',
      requiredResources: Array.from({ length: 9 }, (_, i) => `f${i}`),
      estimatedChangedLines: 1234,
    });
    expect(broad.estimatedChanges.scope).toBe('broad');
    expect(broad.estimatedChanges.fileCount).toBe(9);
    expect(broad.estimatedChanges.estimatedChangedLines).toBe(1234);
  });

  it('an empty request yields a minimal LOW-risk, no-approval plan', async () => {
    const plan = await planner.plan({ goal: 'just chat' });
    expect(plan.requiredCapabilities).toEqual([]);
    expect(plan.steps).toEqual([]);
    expect(plan.overallRisk).toBe(RiskLevel.LOW);
    expect(plan.approvalRequired).toBe(false);
    expect(plan.status).toBe(ExecutionStatus.PENDING);
    expect(plan.id.length).toBeGreaterThan(0);
  });
});
