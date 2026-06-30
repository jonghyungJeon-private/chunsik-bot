import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalStatus, PatchStatus, WorkspaceChangeStatus } from '@chunsik/core';
import type { WorkspaceChange } from '@chunsik/core';
import { SqliteStorageProvider } from './index';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

async function freshStore(): Promise<SqliteStorageProvider> {
  const dir = mkdtempSync(join(tmpdir(), 'chunsik-wschange-'));
  dirs.push(dir);
  const store = new SqliteStorageProvider({ dbPath: join(dir, 'chunsik.db') });
  await store.init(); // runs migrations incl. v4 (workspace_changes table)
  return store;
}

function change(id: string, patchId: string, status: WorkspaceChangeStatus): WorkspaceChange {
  const planRef = { id: 'plan-1', goal: 'g' };
  return {
    id,
    patchRef: { id: patchId, status: PatchStatus.GENERATED },
    executionPlanRef: planRef,
    approvalRef: { id: 'appr-1', status: ApprovalStatus.APPROVED, executionPlanRef: planRef },
    workspaceRef: { id: 'w1', rootPath: '/tmp/ws', kind: 'local-clone' },
    status,
    results: [{ path: 'a.ts', operation: 'update', status: 'applied', message: 'updated', durationMs: 2 }],
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
  };
}

describe('SqliteWorkspaceChangeRepository (CAP-006) — persistence via migration v4', () => {
  it('saves and round-trips a WorkspaceChange', async () => {
    const store = await freshStore();
    await store.workspaceChanges.save(change('c1', 'patch-1', WorkspaceChangeStatus.APPLIED));
    const got = await store.workspaceChanges.get('c1');
    expect(got?.patchRef.id).toBe('patch-1');
    expect(got?.status).toBe(WorkspaceChangeStatus.APPLIED);
    expect(got?.results[0]?.status).toBe('applied');
    await store.close();
  });

  it('findByPatchSet returns changes for a given patch only', async () => {
    const store = await freshStore();
    await store.workspaceChanges.save(change('c1', 'patch-1', WorkspaceChangeStatus.APPLIED));
    await store.workspaceChanges.save(change('c2', 'patch-2', WorkspaceChangeStatus.FAILED));
    const forP1 = await store.workspaceChanges.findByPatchSet('patch-1');
    expect(forP1.map((c) => c.id)).toEqual(['c1']);
    await store.close();
  });
});
