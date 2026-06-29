import { newId } from '../util/id';
import { now } from '../util/clock';
import { ApprovalStatus, PatchStatus } from '../domain';
import type {
  DiffChangeKind,
  Id,
  PatchGenerationInput,
  PatchOperation,
  PatchOperationKind,
  PatchSet,
} from '../domain';
import type { StorageProvider } from '../ports';

/** Map a CAP-001 diff change-kind to a Patch operation kind ('modify' → 'update'). */
function toOperationKind(changeKind: DiffChangeKind): PatchOperationKind {
  return changeKind === 'modify' ? 'update' : changeKind;
}

/**
 * CAP-005 Patch (ADR-0026). Owns the `PatchSet` aggregate. **Generates** patches;
 * it NEVER applies them (Workspace Write, CAP-006, applies). It references the
 * ExecutionPlan and the authorizing Approval (read-only) and never mutates them.
 * `changes` and `diff` are received independently (not pre-merged); approval is
 * validated on the passed `ApprovalRef` — PatchManager imports no other capability
 * manager.
 */
export class PatchManager {
  constructor(private readonly storage: StorageProvider) {}

  /** Generate (and persist) a PatchSet from an approved plan's changes + diff. */
  async generate(input: PatchGenerationInput): Promise<PatchSet> {
    if (input.approvalRef.status !== ApprovalStatus.APPROVED) {
      throw new Error(
        `patch generation requires an APPROVED approval (got ${input.approvalRef.status})`,
      );
    }
    const diffByPath = new Map(input.diff.files.map((f) => [f.path, f]));
    const operations: PatchOperation[] = input.changes.map((change) => {
      const fileDiff = diffByPath.get(change.path);
      if (!fileDiff) {
        throw new Error(`no diff found for proposed change: ${change.path}`);
      }
      return {
        path: fileDiff.path,
        operation: toOperationKind(fileDiff.changeKind),
        diff: fileDiff.unified,
        ...(fileDiff.binary ? { metadata: { binary: true } } : {}),
      };
    });
    const set: PatchSet = {
      id: newId(),
      executionPlanRef: input.executionPlanRef,
      approvalRef: input.approvalRef,
      operations,
      status: PatchStatus.GENERATED,
      createdAt: now(),
    };
    return this.storage.patches.save(set);
  }

  async get(id: Id): Promise<PatchSet | null> {
    return this.storage.patches.get(id);
  }

  /** All patch sets generated for an ExecutionPlan. */
  async findByExecutionPlan(executionPlanId: Id): Promise<PatchSet[]> {
    return this.storage.patches.findByExecutionPlan(executionPlanId);
  }
}
