import { executionPlanRef } from '../domain';
import type { ExecutionPlan, ExecutionPlanRef, PlanningRequest } from '../domain';
import type { ExecutionPlanner } from '../ports';

/**
 * Application service for CAP-003 Planning (ADR-0024). Deliberately **thin** (no
 * God Object): it validates the request and delegates plan construction to the
 * injected `ExecutionPlanner` strategy. It does NOT import `WorkspaceManager`,
 * `GitManager`, or any other capability manager — all context arrives in the
 * `PlanningRequest` (composition happens above the Planning layer).
 */
export class PlanningManager {
  constructor(private readonly planner: ExecutionPlanner) {}

  /** Produce a deterministic ExecutionPlan for a goal + read-only context. */
  async plan(request: PlanningRequest): Promise<ExecutionPlan> {
    if (!request.goal || request.goal.trim() === '') {
      throw new Error('PlanningManager.plan: a non-empty goal is required');
    }
    return this.planner.plan(request);
  }

  /** Produce the plan and return its lightweight reference (Ref model). */
  async planRef(request: PlanningRequest): Promise<ExecutionPlanRef> {
    return executionPlanRef(await this.plan(request));
  }
}
