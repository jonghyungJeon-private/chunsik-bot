import type { Id, IsoTimestamp } from './common';
import type { ApprovalStatus, RiskLevel } from './enums';
import type { ExecutionPlanRef } from './execution-plan';

/**
 * Governance aggregate (CAP-004, ADR-0025) — Approval's OWN aggregate. It records
 * the approval state for an `ExecutionPlan` and is the **only** thing Approval
 * mutates. It REFERENCES the plan via `executionPlanRef` and never modifies the
 * plan itself (Aggregate Ownership Rule: Planning owns ExecutionPlan; Approval
 * owns ApprovalRequest). ExecutionPlan-first, not task-first (`taskId` is optional
 * v1 compatibility only).
 */
export interface ApprovalRequest {
  id: Id;
  /** The plan this approval governs (read-only reference; never mutated). */
  executionPlanRef: ExecutionPlanRef;
  status: ApprovalStatus;
  riskLevel: RiskLevel;
  /** Why approval is (not) required — from ApprovalPolicy. */
  reason: string;
  requestedBy: string;
  /** Raw decision once decided: true = approved, false = rejected. */
  decision?: boolean;
  decidedBy?: string;
  decidedAt?: IsoTimestamp;
  comment?: string;
  /** Optional v1 compatibility; CAP-004 is ExecutionPlan-based, not task-first. */
  taskId?: Id;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** A human decision fed into Approval (input value object). */
export interface ApprovalDecision {
  approvalId: Id;
  approved: boolean;
  decidedBy: string;
  decidedAt: IsoTimestamp;
  comment?: string;
}

/**
 * Lightweight handle other capabilities use to reference an approval (V2 Ref
 * model: WorkspaceRef / RepositoryRef / ExecutionPlanRef / ApprovalRef).
 */
export interface ApprovalRef {
  id: Id;
  status: ApprovalStatus;
  /**
   * The plan this approval is scoped to. An `ApprovalRef` is **plan-scoped**: it
   * carries the `ExecutionPlanRef` so downstream capabilities (e.g. Patch) can
   * verify referential integrity — that an APPROVED approval belongs to the plan
   * being acted on — without loading the `ApprovalRequest` aggregate (CAP-005 review).
   */
  executionPlanRef: ExecutionPlanRef;
}

/** Pure derivation of an ApprovalRef from the aggregate. */
export function approvalRef(request: ApprovalRequest): ApprovalRef {
  return {
    id: request.id,
    status: request.status,
    executionPlanRef: request.executionPlanRef,
  };
}
