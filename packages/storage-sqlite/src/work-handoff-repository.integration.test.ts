import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ResourceRef, agentProfileId, createWorkHandoff } from '@quoky/core';
import type { WorkHandoff } from '@quoky/core';
import { SqliteWorkHandoffRepository } from './index';
import { runMigrations } from './migrations';

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function setup() {
  const db = new Database(':memory:');
  databases.push(db);
  runMigrations(db);
  return { db, repository: new SqliteWorkHandoffRepository(db) };
}

function handoff(overrides: Partial<WorkHandoff> = {}): WorkHandoff {
  return createWorkHandoff({
    id: 'handoff-1',
    workItemId: 'work-1',
    fromAgentProfileId: agentProfileId('builder'),
    toAgentProfileId: agentProfileId('reviewer'),
    objective: 'Review CAP-014.',
    resourceRefs: [new ResourceRef({ source: 'jira', externalId: 'CAP-014' })],
    artifactIds: ['artifact-1'],
    executionReceiptIds: ['receipt-1'],
    createdAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  });
}

describe('SqliteWorkHandoffRepository integration (migration v9)', () => {
  it('round-trips immutable rows through each bounded deterministic query', async () => {
    const { repository } = setup();
    const first = handoff();
    const second = handoff({
      id: 'handoff-2',
      workItemId: 'work-2',
      fromAgentProfileId: agentProfileId('reviewer'),
      toAgentProfileId: agentProfileId('builder'),
      createdAt: '2026-09-02T00:00:01.000Z',
    });
    await repository.insert(second);
    await repository.insert(first);

    await expect(repository.get(first.id)).resolves.toEqual(first);
    await expect(repository.listByWorkItem(first.workItemId)).resolves.toEqual([first]);
    await expect(repository.listByFromAgent(agentProfileId('builder'))).resolves.toEqual([first]);
    await expect(repository.listByToAgent(agentProfileId('builder'))).resolves.toEqual([second]);
    expect(Object.isFrozen((await repository.get(first.id))?.artifactIds)).toBe(true);
  });

  it('fails duplicate-id insertion closed without replacing the canonical row', async () => {
    const { repository } = setup();
    const canonical = handoff();
    await repository.insert(canonical);
    await expect(repository.insert(handoff({ objective: 'Replacement is forbidden.' })))
      .rejects.toThrow();
    await expect(repository.get(canonical.id)).resolves.toEqual(canonical);
  });
});
