import { newId } from '../util/id';
import { now } from '../util/clock';
import { ApprovalStatus, WorkspaceChangeStatus, patchRef } from '../domain';
import type {
  ApplyInput,
  FileChangeResult,
  Id,
  WorkspaceChange,
} from '../domain';
import type { StorageProvider, WorkspaceWriter } from '../ports';

/** Derive the aggregate status from best-effort per-file results. */
function deriveStatus(results: FileChangeResult[]): WorkspaceChangeStatus {
  const applied = results.filter((r) => r.status === 'applied').length;
  if (applied === results.length) return WorkspaceChangeStatus.APPLIED; // incl. empty → APPLIED
  if (applied === 0) return WorkspaceChangeStatus.FAILED;
  return WorkspaceChangeStatus.PARTIALLY_APPLIED;
}

/**
 * CAP-006 Workspace Write (ADR-0027). Owns the `WorkspaceChange` aggregate — the
 * Execution History of applying a `PatchSet` — and is the ONLY capability that
 * mutates it. It READS the immutable `PatchSet` and references the plan/approval
 * via Refs; it never mutates PatchSet/ExecutionPlan/ApprovalRequest, never calls
 * git, never generates patches. File application is delegated to the
 * `WorkspaceWriter` adapter (atomic unit = file, best-effort across files).
 */
export class WorkspaceWriteManager {
  constructor(
    private readonly storage: StorageProvider,
    private readonly writer: WorkspaceWriter,
  ) {}

  /**
   * Apply an approved PatchSet to its workspace. Best-effort: every operation is
   * attempted and recorded. Idempotency is `WorkspaceChange.status`-based: an
   * already-APPLIED PatchSet is a no-op; FAILED/PARTIALLY_APPLIED/APPLYING are
   * re-attempted on the same aggregate.
   */
  async apply(input: ApplyInput): Promise<WorkspaceChange> {
    const { patchSet, approvalRef, workspaceRef } = input;

    // (1) Approval gate — Ref only (no ApprovalManager query). Plan-scoped (CAP-005).
    if (approvalRef.status !== ApprovalStatus.APPROVED) {
      throw new Error(`workspace write requires an APPROVED approval (got ${approvalRef.status})`);
    }
    if (approvalRef.executionPlanRef.id !== patchSet.executionPlanRef.id) {
      throw new Error(
        `approval ${approvalRef.id} is scoped to a different ExecutionPlan ` +
          `(${approvalRef.executionPlanRef.id}, expected ${patchSet.executionPlanRef.id})`,
      );
    }

    // (2) Idempotency by status: one WorkspaceChange per PatchSet.
    const existing = (await this.storage.workspaceChanges.findByPatchSet(patchSet.id))[0];
    if (existing && existing.status === WorkspaceChangeStatus.APPLIED) {
      return existing; // already applied — no-op
    }

    // (3) Create or reuse the aggregate, mark APPLYING.
    const ts = now();
    const base: WorkspaceChange = existing ?? {
      id: newId(),
      patchRef: patchRef(patchSet),
      executionPlanRef: patchSet.executionPlanRef,
      approvalRef,
      workspaceRef,
      status: WorkspaceChangeStatus.PENDING,
      results: [],
      createdAt: ts,
      updatedAt: ts,
    };
    await this.storage.workspaceChanges.save({
      ...base,
      status: WorkspaceChangeStatus.APPLYING,
      updatedAt: ts,
    });

    // (4) Best-effort: attempt every operation; the writer encodes failures.
    const results: FileChangeResult[] = [];
    for (const op of patchSet.operations) {
      results.push(await this.writer.applyOperation(workspaceRef, op));
    }

    // (5) Derive final status and persist the Execution History.
    const change: WorkspaceChange = {
      ...base,
      approvalRef,
      workspaceRef,
      status: deriveStatus(results),
      results,
      updatedAt: now(),
    };
    return this.storage.workspaceChanges.save(change);
  }

  async get(id: Id): Promise<WorkspaceChange | null> {
    return this.storage.workspaceChanges.get(id);
  }

  /** Execution history for a given PatchSet. */
  async findByPatchSet(patchSetId: Id): Promise<WorkspaceChange[]> {
    return this.storage.workspaceChanges.findByPatchSet(patchSetId);
  }
}
