import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalStatus, RiskLevel } from '@chunsik/core';
import type { ApprovalRequest } from '@chunsik/core';
import { SqliteStorageProvider } from './index';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

async function freshStore(): Promise<SqliteStorageProvider> {
  const dir = mkdtempSync(join(tmpdir(), 'chunsik-approvals-'));
  dirs.push(dir);
  const store = new SqliteStorageProvider({ dbPath: join(dir, 'chunsik.db') });
  await store.init(); // runs migrations incl. v2 (approvals table)
  return store;
}

function approval(id: string, planId: string, status: ApprovalStatus): ApprovalRequest {
  return {
    id,
    executionPlanRef: { id: planId, goal: 'g' },
    status,
    riskLevel: RiskLevel.HIGH,
    reason: 'HIGH risk requires human approval',
    requestedBy: 'alice',
    createdAt: '2026-06-29T00:00:00.000Z',
    updatedAt: '2026-06-29T00:00:00.000Z',
  };
}

describe('SqliteApprovalRepository (CAP-004) — persistence via migration v2', () => {
  it('saves and round-trips an ApprovalRequest', async () => {
    const store = await freshStore();
    await store.approvals.save(approval('a1', 'plan-1', ApprovalStatus.PENDING));
    const got = await store.approvals.get('a1');
    expect(got?.executionPlanRef.id).toBe('plan-1');
    expect(got?.status).toBe(ApprovalStatus.PENDING);
    await store.close();
  });

  it('findByExecutionPlan returns approvals for a given plan only', async () => {
    const store = await freshStore();
    await store.approvals.save(approval('a1', 'plan-1', ApprovalStatus.APPROVED));
    await store.approvals.save(approval('a2', 'plan-1', ApprovalStatus.PENDING));
    await store.approvals.save(approval('a3', 'plan-2', ApprovalStatus.PENDING));
    const forPlan1 = await store.approvals.findByExecutionPlan('plan-1');
    expect(forPlan1.map((r) => r.id).sort()).toEqual(['a1', 'a2']);
    await store.close();
  });

  it('updates status on re-save (upsert)', async () => {
    const store = await freshStore();
    await store.approvals.save(approval('a1', 'plan-1', ApprovalStatus.PENDING));
    await store.approvals.save({ ...approval('a1', 'plan-1', ApprovalStatus.APPROVED), decision: true });
    const got = await store.approvals.get('a1');
    expect(got?.status).toBe(ApprovalStatus.APPROVED);
    expect(got?.decision).toBe(true);
    await store.close();
  });
});
