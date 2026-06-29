import type { Id, IsoTimestamp } from './common';
import type { ArtifactKind, Capability, ExecutionStatus, RiskLevel } from './enums';

/**
 * Execution-plan domain — the **cross-capability execution contract** (CAP-003,
 * ADR-0024). Produced by the Planning capability and consumed by Approval
 * (CAP-004) and Patch (CAP-005). DISTINCT from the v1 intra-task `Plan`
 * (`planning.ts`). In-memory only in CAP-003 — persistence begins with Approval.
 */

/** Estimated magnitude of a plan's changes (ADR-0024). */
export interface EstimatedChanges {
  /** Number of resources/files the plan expects to touch. */
  fileCount: number;
  /** Estimated added+removed lines, when a caller has computed a diff (CAP-001). */
  estimatedChangedLines?: number;
  /** Coarse blast-radius bucket. */
  scope: 'none' | 'local' | 'broad';
}

/**
 * One high-level, independently-trackable step of an ExecutionPlan (ADR-0024).
 * Steps carry their own `status` so future approval/execution can act per-step.
 */
export interface ExecutionStep {
  id: Id;
  title: string;
  description: string;
  capability: Capability;
  status: ExecutionStatus;
}

/**
 * The deterministic execution plan. The contract every future execution flow
 * consumes. No behavior lives here — it is pure data.
 */
export interface ExecutionPlan {
  id: Id;
  goal: string;
  summary: string;
  steps: ExecutionStep[];
  requiredCapabilities: Capability[];
  /** Resource identifiers (e.g. target file paths) the plan needs. */
  requiredResources: string[];
  estimatedChanges: EstimatedChanges;
  approvalRequired: boolean;
  overallRisk: RiskLevel;
  expectedArtifacts: ArtifactKind[];
  status: ExecutionStatus;
  projectId?: Id;
  createdAt: IsoTimestamp;
}

/**
 * Lightweight handle other capabilities use to reference a plan WITHOUT importing
 * the producing capability (V2 Ref model: WorkspaceRef / RepositoryRef /
 * ExecutionPlanRef). Capabilities communicate through refs, not direct imports.
 */
export interface ExecutionPlanRef {
  id: Id;
  goal: string;
}

/** Pure derivation of an ExecutionPlanRef from a plan. */
export function executionPlanRef(plan: ExecutionPlan): ExecutionPlanRef {
  return { id: plan.id, goal: plan.goal };
}

/**
 * Input to the Planning capability (ADR-0024). The caller supplies ALL read-only
 * context here (capabilities, resources, pre-computed diff size) — the planner
 * never reaches into Workspace/Git itself (composition happens above Planning).
 */
export interface PlanningRequest {
  goal: string;
  projectId?: Id;
  requiredCapabilities?: Capability[];
  requiredResources?: string[];
  /** Estimated changed lines from a prior CAP-001 diff, if known. */
  estimatedChangedLines?: number;
}
