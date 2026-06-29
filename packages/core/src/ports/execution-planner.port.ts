import type { ExecutionPlan, PlanningRequest } from '../domain';

/**
 * PORT: a replaceable planning **strategy** (CAP-003, ADR-0024). Turns a
 * `PlanningRequest` into a deterministic `ExecutionPlan`. The seam exists so the
 * strategy can be swapped without touching `PlanningManager` (no God Object):
 *
 *   ExecutionPlanner
 *   ├── DeterministicPlanner   (v2 — the only implementation now)
 *   ├── AIPlanner              (future — AI may ASSIST, never the source of truth)
 *   └── HybridPlanner          (future)
 *
 * Planning is deterministic and AI-free in CAP-003. The result is async so a
 * future AI/Hybrid planner fits the same contract.
 */
export interface ExecutionPlanner {
  readonly kind: string;
  plan(request: PlanningRequest): Promise<ExecutionPlan>;
}
