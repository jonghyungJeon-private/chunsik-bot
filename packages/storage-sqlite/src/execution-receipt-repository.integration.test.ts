import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ExecutionKind,
  ExecutionReceiptFailureClass,
  ExecutionReceiptOutcome,
} from '@chunsik/core';
import type { ExecutionReceipt } from '@chunsik/core';
import { SqliteExecutionReceiptRepository } from './index';
import { LATEST_SCHEMA_VERSION, runMigrations } from './migrations';

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function setup() {
  const db = new Database(':memory:');
  databases.push(db);
  runMigrations(db);
  return { db, repository: new SqliteExecutionReceiptRepository(db) };
}

function receipt(overrides: Partial<ExecutionReceipt> = {}): ExecutionReceipt {
  return {
    id: 'receipt-1',
    executionKind: ExecutionKind.COMMAND,
    sourceId: 'command-1',
    executionPlanId: 'plan-1',
    authorization: { kind: 'NOT_REQUIRED' },
    outcome: ExecutionReceiptOutcome.SUCCEEDED,
    recordedAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('SqliteExecutionReceiptRepository integration (migration v8)', () => {
  it('creates exactly the bounded columns, unique source identity, and plan index', async () => {
    const { db, repository } = setup();
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(LATEST_SCHEMA_VERSION);
    const columns = (db.pragma('table_info(execution_receipts)') as Array<{ name: string }>)
      .map((column) => column.name);
    expect(columns).toEqual([
      'id',
      'execution_kind',
      'source_id',
      'execution_plan_id',
      'authorization_kind',
      'approval_id',
      'outcome',
      'failure_class',
      'recorded_at',
    ]);
    const indexes = db.pragma('index_list(execution_receipts)') as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toContain('execution_receipts_execution_plan_id');

    await repository.insert(receipt());
    await expect(repository.insert(receipt({ id: 'receipt-2' }))).rejects.toThrow();
  });

  it('round-trips insert-once rows through id, source, and plan queries', async () => {
    const { repository } = setup();
    const row = receipt({
      authorization: { kind: 'APPROVAL', approvalId: 'approval-1' },
      outcome: ExecutionReceiptOutcome.FAILED,
      failureClass: ExecutionReceiptFailureClass.TIMED_OUT,
    });
    await repository.insert(row);
    expect(await repository.get(row.id)).toEqual(row);
    expect(await repository.findBySource(ExecutionKind.COMMAND, row.sourceId)).toEqual(row);
    expect(await repository.findByExecutionPlan(row.executionPlanId)).toEqual([row]);
  });
});
