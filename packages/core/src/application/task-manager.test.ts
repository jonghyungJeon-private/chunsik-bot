import { describe, expect, it } from 'vitest';
import { Capability, IntentType, TaskRunStatus } from '../domain';
import type { Metadata, Task, TaskRun } from '../domain';
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

describe('TaskManager current request fidelity', () => {
  it('stores the complete request as Task.description while keeping Intent.summary and title bounded', async () => {
    const saved: Task[] = [];
    const storage = {
      tasks: {
        async save(task: Task) {
          saved.push(task);
          return task;
        },
      },
    } as unknown as StorageProvider;
    const manager = new TaskManager(storage);
    const requestText = `현재 상태를 설명해줘\n${'A'.repeat(220)}\nPHASE_B_TAIL`;
    const summary = requestText.trim().slice(0, 200);

    const task = await manager.createTask(
      {
        type: IntentType.CHAT,
        capability: Capability.GENERAL_CHAT,
        confidence: 1,
        requiresWork: true,
        summary,
      },
      { platform: 'discord', channelId: 'channel-1', userId: 'user-1' },
      { requestText, actorId: 'actor-1', sessionId: 'session-1' },
    );

    expect(task.title).toBe(summary.slice(0, 80));
    expect(task.intent.summary).toBe(summary);
    expect(task.intent.summary).toHaveLength(200);
    expect(task.description).toBe(requestText);
    expect(task.description.length).toBeGreaterThan(200);
    expect(task.description).toContain('PHASE_B_TAIL');
    expect(saved).toEqual([task]);
  });
});

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
