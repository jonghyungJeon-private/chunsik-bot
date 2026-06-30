import type { FileChangeResult, PatchOperation, WorkspaceRef } from '../domain';

/**
 * PORT: applies ONE patch operation to the workspace filesystem (CAP-006,
 * ADR-0027). **Atomic unit = file** (a PatchSet is not a transaction). The
 * implementation lives adapter-side (`node:fs` only — no git, no child_process)
 * and **encodes apply failures in the returned `FileChangeResult`** rather than
 * throwing, so the manager can record best-effort results for every operation.
 */
export interface WorkspaceWriter {
  readonly kind: string;
  applyOperation(ref: WorkspaceRef, op: PatchOperation): Promise<FileChangeResult>;
}
