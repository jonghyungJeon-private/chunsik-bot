import { describe, expect, it } from 'vitest';
import { Capability, TaskRunStatus } from '../domain';
import type { Metadata, TaskRun } from '../domain';
import type { StorageProvider } from '../ports';
import { TaskManager } from './task-manager';

function runOf(): TaskRun {
  return {
    id: 'run-1',
    taskId: 'task-1',
    attempt: 1,
    status: TaskRunStatus.STARTED,
    capability: Capability.GENERAL_CHAT,
    artifactIds: [],
    startedAt: '2026-07-23T00:00:00.000Z',
  };
}

function managerWithSavedRuns(): { manager: TaskManager; saved: TaskRun[] } {
  const saved: TaskRun[] = [];
  const storage = {
    taskRuns: {
      async save(run: TaskRun) {
        saved.push(run);
        return run;
      },
    },
  } as unknown as StorageProvider;
  return { manager: new TaskManager(storage), saved };
}

describe('TaskManager TaskRun audit metadata', () => {
  it('persists optional provider-owned metadata without interpreting it', async () => {
    const { manager, saved } = managerWithSavedRuns();
    const metadata: Metadata = {
      model: 'llama3.1',
      promptSha256: 'a'.repeat(64),
      outputSanitized: true,
    };

    const completed = await manager.completeRun(runOf(), {
      artifactIds: ['artifact-1'],
      providerId: 'ollama-cli',
      metadata,
    });

    expect(completed.metadata).toEqual(metadata);
    expect(saved.at(-1)?.metadata).toEqual(metadata);
  });

  it('preserves existing behavior when a provider returns no audit metadata', async () => {
    const { manager } = managerWithSavedRuns();
    const completed = await manager.completeRun(runOf(), {
      artifactIds: [],
      providerId: 'provider-without-audit',
    });

    expect(completed).not.toHaveProperty('metadata');
  });
});
