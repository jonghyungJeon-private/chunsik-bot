import type { Id, IsoTimestamp } from './common';
import type { WorkspaceChangeStatus } from './enums';
import type { PatchOperationKind, PatchRef, PatchSet } from './patch';
import type { ExecutionPlanRef } from './execution-plan';
import type { ApprovalRef } from './approval';
import type { WorkspaceRef } from './workspace';

/** Per-file outcome of applying one PatchOperation (CAP-006, ADR-0027). */
export type FileChangeStatus = 'applied' | 'failed' | 'skipped';

/**
 * The record of what happened to ONE file. The file is the atomic unit of a
 * Workspace Write — a PatchSet is not a transaction.
 */
export interface FileChangeResult {
  path: string;
  operation: PatchOperationKind;
  status: FileChangeStatus;
  /** Human-readable outcome / sanitized error detail. */
  message: string;
  /** Wall-clock duration of this file's apply, in ms. */
  durationMs: number;
}

/**
 * Workspace Write's aggregate — the **Execution History** of applying a `PatchSet`
 * to a workspace (CAP-006, ADR-0027). Owned & mutated ONLY by Workspace Write; it
 * references the patch/plan/approval/workspace via Refs and never mutates them.
 * Best-effort: every operation is attempted; per-file results are all recorded.
 */
export interface WorkspaceChange {
  id: Id;
  patchRef: PatchRef;
  executionPlanRef: ExecutionPlanRef;
  approvalRef: ApprovalRef;
  workspaceRef: WorkspaceRef;
  status: WorkspaceChangeStatus;
  /** One result per PatchOperation attempted (applied/failed/skipped). */
  results: FileChangeResult[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** Lightweight handle (V2 Ref model). */
export interface WorkspaceChangeRef {
  id: Id;
  status: WorkspaceChangeStatus;
}

/** Pure derivation of a WorkspaceChangeRef from the aggregate. */
export function workspaceChangeRef(change: WorkspaceChange): WorkspaceChangeRef {
  return { id: change.id, status: change.status };
}

/**
 * Input to applying a patch (CAP-006). The caller composes these (load the
 * immutable PatchSet, supply the plan-scoped ApprovalRef and the resolved
 * WorkspaceRef); Workspace Write imports no other capability manager.
 */
export interface ApplyInput {
  patchSet: PatchSet;
  approvalRef: ApprovalRef;
  workspaceRef: WorkspaceRef;
}
