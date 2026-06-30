import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandExecutionStatus, RiskLevel, WorkspaceChangeStatus } from '@chunsik/core';
import type { CommandExecution } from '@chunsik/core';
import { SqliteStorageProvider } from './index';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

async function freshStore(): Promise<SqliteStorageProvider> {
  const dir = mkdtempSync(join(tmpdir(), 'chunsik-cmdexec-'));
  dirs.push(dir);
  const store = new SqliteStorageProvider({ dbPath: join(dir, 'chunsik.db') });
  await store.init(); // runs migrations incl. v5 (command_executions table)
  return store;
}

function exec(
  id: string,
  planId: string,
  status: CommandExecutionStatus,
  workspaceChangeId?: string,
): CommandExecution {
  return {
    id,
    executionPlanRef: { id: planId, goal: 'g' },
    workspaceRef: { id: 'w1', rootPath: '/tmp/ws', kind: 'local-clone' },
    ...(workspaceChangeId
      ? { workspaceChangeRef: { id: workspaceChangeId, status: WorkspaceChangeStatus.APPLIED } }
      : {}),
    command: 'pnpm',
    args: ['test'],
    commandHash: 'abcd1234abcd1234',
    status,
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
    durationMs: 5,
    riskLevel: RiskLevel.MEDIUM,
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
  };
}

describe('SqliteCommandExecutionRepository (CAP-007) — persistence via migration v5', () => {
  it('saves and round-trips a CommandExecution', async () => {
    const store = await freshStore();
    await store.commandExecutions.save(exec('e1', 'plan-1', CommandExecutionStatus.SUCCEEDED));
    const got = await store.commandExecutions.get('e1');
    expect(got?.command).toBe('pnpm');
    expect(got?.args).toEqual(['test']);
    expect(got?.commandHash).toBe('abcd1234abcd1234');
    expect(got?.status).toBe(CommandExecutionStatus.SUCCEEDED);
    await store.close();
  });

  it('findByExecutionPlan returns executions for a given plan only', async () => {
    const store = await freshStore();
    await store.commandExecutions.save(exec('e1', 'plan-1', CommandExecutionStatus.SUCCEEDED));
    await store.commandExecutions.save(exec('e2', 'plan-2', CommandExecutionStatus.FAILED));
    const forP1 = await store.commandExecutions.findByExecutionPlan('plan-1');
    expect(forP1.map((e) => e.id)).toEqual(['e1']);
    await store.close();
  });

  it('findByWorkspaceChange returns executions tied to a given change only', async () => {
    const store = await freshStore();
    await store.commandExecutions.save(exec('e1', 'plan-1', CommandExecutionStatus.SUCCEEDED, 'wc-1'));
    await store.commandExecutions.save(exec('e2', 'plan-1', CommandExecutionStatus.SUCCEEDED));
    const forWc = await store.commandExecutions.findByWorkspaceChange('wc-1');
    expect(forWc.map((e) => e.id)).toEqual(['e1']);
    await store.close();
  });
});
