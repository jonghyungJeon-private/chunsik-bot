import { describe, expect, it } from 'vitest';
import { PatchManager } from './patch-manager';
import { ApprovalStatus, PatchStatus } from '../domain';
import type {
  ApprovalRef,
  ExecutionPlanRef,
  PatchGenerationInput,
  PatchSet,
  ProposedChange,
  WorkspaceDiff,
} from '../domain';
import type { PatchRepository, StorageProvider } from '../ports';

function fakeStorage(): StorageProvider {
  const rows = new Map<string, PatchSet>();
  const patches: PatchRepository = {
    async get(id) {
      return rows.get(id) ?? null;
    },
    async save(set) {
      rows.set(set.id, set);
      return set;
    },
    async delete(id) {
      rows.delete(id);
    },
    async list() {
      return [...rows.values()];
    },
    async findByExecutionPlan(executionPlanId) {
      return [...rows.values()].filter((p) => p.executionPlanRef.id === executionPlanId);
    },
  };
  return { patches } as unknown as StorageProvider;
}

const planRef: ExecutionPlanRef = { id: 'plan-1', goal: 'do x' };
const approved: ApprovalRef = { id: 'appr-1', status: ApprovalStatus.APPROVED };

function diffOf(...files: WorkspaceDiff['files']): WorkspaceDiff {
  return { refId: 'w1', files, estimatedChangedLines: 0, truncated: false };
}

function input(over: Partial<PatchGenerationInput> = {}): PatchGenerationInput {
  const changes: ProposedChange[] = [{ path: 'a.ts', newContent: 'x' }, { path: 'old.ts', delete: true }];
  const diff = diffOf(
    { path: 'a.ts', changeKind: 'modify', unified: '@@\n-1\n+x', binary: false },
    { path: 'old.ts', changeKind: 'delete', unified: '@@\n-gone', binary: false },
  );
  return { executionPlanRef: planRef, approvalRef: approved, changes, diff, ...over };
}

describe('PatchManager (CAP-005, ADR-0026) — generation only', () => {
  it('generates a GENERATED PatchSet with one operation per change', async () => {
    const set = await new PatchManager(fakeStorage()).generate(input());
    expect(set.status).toBe(PatchStatus.GENERATED);
    expect(set.executionPlanRef).toEqual(planRef);
    expect(set.approvalRef).toEqual(approved);
    expect(set.operations.map((o) => o.path)).toEqual(['a.ts', 'old.ts']);
  });

  it("maps 'modify' → 'update' and carries the unified diff", async () => {
    const set = await new PatchManager(fakeStorage()).generate(input());
    const a = set.operations.find((o) => o.path === 'a.ts');
    expect(a?.operation).toBe('update');
    expect(a?.diff).toContain('+x');
    expect(set.operations.find((o) => o.path === 'old.ts')?.operation).toBe('delete');
  });

  it('requires an APPROVED ApprovalRef (rejects PENDING / REJECTED)', async () => {
    for (const status of [ApprovalStatus.PENDING, ApprovalStatus.REJECTED]) {
      await expect(
        new PatchManager(fakeStorage()).generate(input({ approvalRef: { id: 'a', status } })),
      ).rejects.toThrow(/APPROVED/);
    }
  });

  it('throws when a proposed change has no matching diff', async () => {
    const bad = input({ changes: [{ path: 'missing.ts', newContent: 'x' }] });
    await expect(new PatchManager(fakeStorage()).generate(bad)).rejects.toThrow(/no diff/);
  });

  it('flags binary operations via metadata', async () => {
    const set = await new PatchManager(fakeStorage()).generate(
      input({
        changes: [{ path: 'img.png', newContent: 'x' }],
        diff: diffOf({ path: 'img.png', changeKind: 'modify', unified: '', binary: true }),
      }),
    );
    expect(set.operations[0]?.metadata).toEqual({ binary: true });
  });

  it('persists the PatchSet (findByExecutionPlan / get)', async () => {
    const mgr = new PatchManager(fakeStorage());
    const set = await mgr.generate(input());
    expect((await mgr.get(set.id))?.id).toBe(set.id);
    expect((await mgr.findByExecutionPlan('plan-1')).map((p) => p.id)).toEqual([set.id]);
  });

  it('never mutates its Ref inputs (aggregate ownership)', async () => {
    const refs = { executionPlanRef: Object.freeze({ ...planRef }), approvalRef: Object.freeze({ ...approved }) };
    const snapshot = JSON.stringify(refs);
    await new PatchManager(fakeStorage()).generate(input(refs));
    expect(JSON.stringify(refs)).toBe(snapshot);
  });
});
