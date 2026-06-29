import { newId } from '../util/id';
import { now } from '../util/clock';
import type { Intent, Plan, PlanStep, Task } from '../domain';
import type { CapabilityRouter } from './capability-router';
import type { RiskPolicy } from './risk-policy';

/**
 * Decomposes an intent into a Plan. v1 (Sprint 1b-1) is MINIMAL and
 * deterministic: a single step whose risk comes from RiskPolicy. AI-driven
 * multi-step decomposition arrives later behind the same shape (ADR-0003).
 */
export class Planner {
  constructor(
    private readonly router: CapabilityRouter,
    private readonly risk: RiskPolicy,
  ) {}

  async plan(task: Task, intent: Intent): Promise<Plan> {
    void this.router;
    const riskLevel = this.risk.assessIntent(intent);
    const step: PlanStep = {
      id: newId(),
      description: intent.summary,
      capability: intent.capability,
      riskLevel,
      requiresApproval: this.risk.requiresApproval(riskLevel),
    };
    return {
      id: newId(),
      taskId: task.id,
      steps: [step],
      overallRisk: riskLevel,
      summary: intent.summary,
      createdAt: now(),
    };
  }
}
