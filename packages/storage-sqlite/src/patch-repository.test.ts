import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalStatus, PatchStatus } from '@chunsik/core';
import type { PatchSet } from '@chunsik/core';
import { SqliteStorageProvider } from './index';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

async function freshStore(): Promise<SqliteStorageProvider> {
  const dir = mkdtempSync(join(tmpdir(), 'chunsik-patches-'));
  dirs.push(dir);
  const store = new SqliteStorageProvider({ dbPath: join(dir, 'chunsik.db') });
  await store.init(); // runs migrations incl. v3 (patches table)
  return store;
}

function patchSet(id: string, planId: string): PatchSet {
  return {
    id,
    executionPlanRef: { id: planId, goal: 'g' },
    approvalRef: { id: 'appr-1', status: ApprovalStatus.APPROVED, executionPlanRef: { id: planId, goal: 'g' } },
    operations: [{ path: 'a.ts', operation: 'update', diff: '@@\n-1\n+2' }],
    status: PatchStatus.GENERATED,
    createdAt: '2026-06-29T00:00:00.000Z',
  };
}

describe('SqlitePatchRepository (CAP-005) — persistence via migration v3', () => {
  it('saves and round-trips a PatchSet', async () => {
    const store = await freshStore();
    await store.patches.save(patchSet('p1', 'plan-1'));
    const got = await store.patches.get('p1');
    expect(got?.executionPlanRef.id).toBe('plan-1');
    expect(got?.status).toBe(PatchStatus.GENERATED);
    expect(got?.operations[0]?.operation).toBe('update');
    await store.close();
  });

  it('findByExecutionPlan returns patches for a given plan only', async () => {
    const store = await freshStore();
    await store.patches.save(patchSet('p1', 'plan-1'));
    await store.patches.save(patchSet('p2', 'plan-1'));
    await store.patches.save(patchSet('p3', 'plan-2'));
    const forPlan1 = await store.patches.findByExecutionPlan('plan-1');
    expect(forPlan1.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    await store.close();
  });
});
