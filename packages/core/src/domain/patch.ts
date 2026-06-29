import type { Id, IsoTimestamp, Metadata } from './common';
import type { PatchStatus } from './enums';
import type { ExecutionPlanRef } from './execution-plan';
import type { ApprovalRef } from './approval';
import type { ProposedChange, WorkspaceDiff } from './workspace';

/** How a PatchOperation modifies a file (CAP-005, ADR-0026). */
export type PatchOperationKind = 'add' | 'update' | 'delete';

/**
 * A single file modification within a PatchSet — a value object describing the
 * change, NOT how to perform it. Carries the unified `diff` (from CAP-001's
 * WorkspaceDiff); it does not embed filesystem mechanics. Workspace Write
 * (CAP-006) is what eventually applies it.
 */
export interface PatchOperation {
  path: string;
  operation: PatchOperationKind;
  /** Unified diff describing the modification. */
  diff: string;
  metadata?: Metadata;
}

/**
 * The Patch aggregate (CAP-005, ADR-0026). Patch GENERATES this and never applies
 * it — Workspace Write consumes it as an IMMUTABLE input. References the plan and
 * the authorizing approval; never mutates them (Aggregate Ownership Rule).
 */
export interface PatchSet {
  id: Id;
  executionPlanRef: ExecutionPlanRef;
  approvalRef: ApprovalRef;
  operations: PatchOperation[];
  status: PatchStatus;
  createdAt: IsoTimestamp;
}

/**
 * Lightweight handle other capabilities use to reference a patch (V2 Ref model:
 * WorkspaceRef / RepositoryRef / ExecutionPlanRef / ApprovalRef / PatchRef).
 */
export interface PatchRef {
  id: Id;
  status: PatchStatus;
}

/** Pure derivation of a PatchRef from the aggregate. */
export function patchRef(set: PatchSet): PatchRef {
  return { id: set.id, status: set.status };
}

/**
 * Input to patch generation (CAP-005). `changes` and `diff` are supplied
 * INDEPENDENTLY (not pre-merged) so future generators can use them differently.
 */
export interface PatchGenerationInput {
  executionPlanRef: ExecutionPlanRef;
  approvalRef: ApprovalRef;
  changes: ProposedChange[];
  diff: WorkspaceDiff;
}
