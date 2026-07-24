import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Capability, TaskRunStatus } from '@chunsik/core';
import type { TaskRun } from '@chunsik/core';
import { SqliteStorageProvider } from './index';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

async function freshStore(): Promise<SqliteStorageProvider> {
  const dir = mkdtempSync(join(tmpdir(), 'chunsik-taskrun-'));
  dirs.push(dir);
  const store = new SqliteStorageProvider({ dbPath: join(dir, 'chunsik.db') });
  await store.init();
  return store;
}

function runOf(id: string, metadata?: TaskRun['metadata']): TaskRun {
  return {
    id,
    taskId: 'task-1',
    attempt: id === 'legacy-run' ? 1 : 2,
    status: TaskRunStatus.SUCCEEDED,
    capability: Capability.GENERAL_CHAT,
    providerId: 'ollama-cli',
    artifactIds: [],
    startedAt: '2026-07-23T00:00:00.000Z',
    finishedAt: '2026-07-23T00:00:01.000Z',
    durationMs: 1_000,
    ...(metadata ? { metadata } : {}),
  };
}

describe('SqliteTaskRunRepository optional metadata compatibility', () => {
  it('round-trips audit metadata without a schema migration', async () => {
    const store = await freshStore();
    const metadata = {
      model: 'llama3.1',
      sanitizedCommand: ['ollama', 'run', 'llama3.1'],
      promptSha256: 'a'.repeat(64),
      captureMode: 'pipe',
      colorDisabled: true,
      outputSanitized: true,
    };

    await store.taskRuns.save(runOf('audited-run', metadata));
    expect((await store.taskRuns.get('audited-run'))?.metadata).toEqual(metadata);
    await store.close();
  });

  it('reads legacy TaskRun JSON with no metadata', async () => {
    const store = await freshStore();
    await store.taskRuns.save(runOf('legacy-run'));

    const legacy = await store.taskRuns.get('legacy-run');
    expect(legacy).not.toHaveProperty('metadata');
    await store.close();
  });
});
