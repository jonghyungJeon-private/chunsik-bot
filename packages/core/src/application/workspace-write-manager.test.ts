import { describe, expect, it, vi } from 'vitest';
import { WorkspaceWriteManager } from './workspace-write-manager';
import { ApprovalStatus, PatchStatus, WorkspaceChangeStatus } from '../domain';
import type {
  ApplyInput,
  ApprovalRef,
  FileChangeResult,
  PatchOperation,
  PatchSet,
  WorkspaceChange,
  WorkspaceRef,
} from '../domain';
import type { StorageProvider, WorkspaceWriter } from '../ports';

const planRef = { id: 'plan-1', goal: 'do x' };
const approved: ApprovalRef = { id: 'appr-1', status: ApprovalStatus.APPROVED, executionPlanRef: planRef };
const workspaceRef: WorkspaceRef = { id: 'w1', rootPath: '/tmp/ws', kind: 'local-clone' };

function patchSet(...operations: PatchOperation[]): PatchSet {
  return {
    id: 'patch-1',
    executionPlanRef: planRef,
    approvalRef: approved,
    operations: operations.length
      ? operations
      : [
          { path: 'a.ts', operation: 'update', diff: '@@\n-1\n+2' },
          { path: 'b.ts', operation: 'add', diff: '@@\n+new' },
        ],
    status: PatchStatus.GENERATED,
    createdAt: '2026-06-30T00:00:00.000Z',
  };
}

/** In-memory storage + a writer whose per-path result is configurable. */
function harness(writerFor: (op: PatchOperation) => FileChangeResult['status'] = () => 'applied') {
  const rows = new Map<string, WorkspaceChange>();
  const storage = {
    workspaceChanges: {
      async get(id: string) {
        return rows.get(id) ?? null;
      },
      async save(c: WorkspaceChange) {
        rows.set(c.id, c);
        return c;
      },
      async delete(id: string) {
        rows.delete(id);
      },
      async list() {
        return [...rows.values()];
      },
      async findByPatchSet(patchSetId: string) {
        return [...rows.values()].filter((c) => c.patchRef.id === patchSetId);
      },
    },
  } as unknown as StorageProvider;
  const applyOperation = vi.fn(async (_ref: WorkspaceRef, op: PatchOperation): Promise<FileChangeResult> => ({
    path: op.path,
    operation: op.operation,
    status: writerFor(op),
    message: writerFor(op),
    durationMs: 1,
  }));
  const writer: WorkspaceWriter = { kind: 'fake', applyOperation };
  return { storage, writer, applyOperation, rows };
}

function input(over: Partial<ApplyInput> = {}): ApplyInput {
  return { patchSet: patchSet(), approvalRef: approved, workspaceRef, ...over };
}

describe('WorkspaceWriteManager (CAP-006, ADR-0027)', () => {
  it('applies an approved PatchSet → APPLIED, records a result per operation', async () => {
    const { storage, writer, applyOperation } = harness();
    const change = await new WorkspaceWriteManager(storage, writer).apply(input());
    expect(change.status).toBe(WorkspaceChangeStatus.APPLIED);
    expect(change.results).toHaveLength(2);
    expect(change.patchRef.id).toBe('patch-1');
    expect(applyOperation).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-APPROVED approval', async () => {
    const { storage, writer } = harness();
    await expect(
      new WorkspaceWriteManager(storage, writer).apply(
        input({ approvalRef: { id: 'a', status: ApprovalStatus.PENDING, executionPlanRef: planRef } }),
      ),
    ).rejects.toThrow(/APPROVED/);
  });

  it('rejects an approval scoped to a different ExecutionPlan (referential integrity)', async () => {
    const { storage, writer } = harness();
    await expect(
      new WorkspaceWriteManager(storage, writer).apply(
        input({ approvalRef: { id: 'a', status: ApprovalStatus.APPROVED, executionPlanRef: { id: 'OTHER', goal: 'z' } } }),
      ),
    ).rejects.toThrow(/different ExecutionPlan/);
  });

  it('is best-effort: attempts EVERY operation and derives PARTIALLY_APPLIED', async () => {
    const { storage, writer, applyOperation } = harness((op) => (op.path === 'b.ts' ? 'failed' : 'applied'));
    const change = await new WorkspaceWriteManager(storage, writer).apply(input());
    expect(applyOperation).toHaveBeenCalledTimes(2); // did NOT stop at the failure
    expect(change.status).toBe(WorkspaceChangeStatus.PARTIALLY_APPLIED);
  });

  it('derives FAILED when no operation applies', async () => {
    const { storage, writer } = harness(() => 'failed');
    const change = await new WorkspaceWriteManager(storage, writer).apply(input());
    expect(change.status).toBe(WorkspaceChangeStatus.FAILED);
  });

  it('is idempotent: an already-APPLIED PatchSet is a no-op (writer not called)', async () => {
    const { storage, writer, applyOperation } = harness();
    const mgr = new WorkspaceWriteManager(storage, writer);
    const first = await mgr.apply(input());
    expect(first.status).toBe(WorkspaceChangeStatus.APPLIED);
    applyOperation.mockClear();
    const second = await mgr.apply(input());
    expect(second.id).toBe(first.id);
    expect(applyOperation).not.toHaveBeenCalled();
  });

  it('same patch revision re-run stays idempotent (no-op, same WorkspaceChange)', async () => {
    const { storage, writer, applyOperation } = harness();
    const mgr = new WorkspaceWriteManager(storage, writer);
    const ps = patchSet({ path: 'a.ts', operation: 'update', diff: '@@\n-1\n+2' });
    const first = await mgr.apply(input({ patchSet: ps }));
    applyOperation.mockClear();
    const second = await mgr.apply(input({ patchSet: ps })); // identical revision
    expect(second.id).toBe(first.id);
    expect(second.patchHash).toBe(first.patchHash);
    expect(applyOperation).not.toHaveBeenCalled();
  });

  it('refuses to reuse a WorkspaceChange for a DIFFERENT patch revision (same PatchSet id)', async () => {
    const { storage, writer } = harness();
    const mgr = new WorkspaceWriteManager(storage, writer);
    // Both PatchSets share id 'patch-1' (from the helper) but carry different operations.
    await mgr.apply(input({ patchSet: patchSet({ path: 'one.ts', operation: 'add', diff: '@@\n+1' }) }));
    await expect(
      mgr.apply(input({ patchSet: patchSet({ path: 'two.ts', operation: 'add', diff: '@@\n+2' }) })),
    ).rejects.toThrow(/different revision|refusing to reuse/);
  });

  it('never mutates the PatchSet (aggregate ownership)', async () => {
    const { storage, writer } = harness();
    const ps = Object.freeze(patchSet());
    const snapshot = JSON.stringify(ps);
    await new WorkspaceWriteManager(storage, writer).apply(input({ patchSet: ps }));
    expect(JSON.stringify(ps)).toBe(snapshot);
  });
});
