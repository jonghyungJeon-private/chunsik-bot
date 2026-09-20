import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentProfileRegistry, agentProfileId, Capability, IntentType, TaskManager,
  WorkHandoffManager, WorkHandoffConsumptionService, WorkHandoffContinuationService,
  WorkItemStatus, WorkManager, TaskRunStatus } from '@chunsik/core';
import { SqliteStorageProvider } from './index';
import { MIGRATIONS, runMigrations } from './migrations';

const dirs: string[] = [];
const stores: SqliteStorageProvider[] = [];
afterEach(async () => { for (const s of stores.splice(0)) await s.close(); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
async function open(path: string) {
  const s = new SqliteStorageProvider({ dbPath: path }); await s.init(); stores.push(s); return s;
}
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'm3e4-binding-')); dirs.push(dir);
  const path = join(dir, 'test.db'); const storage = await open(path);
  const registry = new AgentProfileRegistry(['source', 'destination'].map(id => ({ id: agentProfileId(id), displayName: id, role: id, purpose: id, instructions: id })));
  const work = await new WorkManager(storage).create({ actorId: 'actor', origin: 'conversation' });
  const handoff = await new WorkHandoffManager(storage, registry).create({ workItemId: work.id,
    fromAgentProfileId: agentProfileId('source'), toAgentProfileId: agentProfileId('destination'), objective: 'Continue' });
  const tasks = new TaskManager(storage);
  const task = await tasks.createTask({ type: IntentType.CHAT, capability: Capability.GENERAL_CHAT,
    confidence: 1, requiresWork: true, summary: 'continue' }, { platform: 'test', channelId: 'channel', userId: 'user' },
    { requestText: 'continue', actorId: 'actor' });
  const service = new WorkHandoffContinuationService(storage, registry, storage.continuationBindings);
  return { path, storage, registry, work, handoff, tasks, task, service };
}

describe('M3E-4 disposable SQLite admission', () => {
  it('evaluates, admits, reopens and replays without creating a TaskRun', async () => {
    const f = await fixture();
    expect((await new WorkHandoffConsumptionService(f.storage, f.registry).evaluate(f.handoff.id)).disposition).toBe('CONTINUE');
    const first = await f.service.admit(f.handoff.id, f.task.id);
    expect(first.disposition).toBe('BOUND');
    expect(await f.storage.taskRuns.list()).toEqual([]);
    await f.storage.close();
    const reopened = await open(f.path);
    const service = new WorkHandoffContinuationService(reopened, f.registry, reopened.continuationBindings);
    expect(await service.admit(f.handoff.id, f.task.id)).toEqual(first);
    expect(await reopened.workHandoffs.get(f.handoff.id)).toEqual(f.handoff);
    expect(await reopened.workItems.get(f.work.id)).toEqual(f.work);
    // Simulated pre-existing canonical execution evidence, not a Provider or runtime invocation.
    await reopened.taskRuns.save({ id: 'run', taskId: f.task.id, attempt: 1, status: TaskRunStatus.SUCCEEDED,
      capability: Capability.GENERAL_CHAT, artifactIds: [], startedAt: '2026-09-21T00:00:00.000Z' });
    expect(await service.resolveRun(f.handoff.id, 'run')).toEqual({ handoffId: f.handoff.id,
      workItemId: f.work.id, destinationAgentProfileId: 'destination', taskId: f.task.id, taskRunId: 'run' });
    await expect(service.resolveRun(f.handoff.id, 'missing')).rejects.toThrow();
  });
  it.each([WorkItemStatus.COMPLETED, WorkItemStatus.CANCELED])('rejects stale CONTINUE for %s without binding', async status => {
    const f = await fixture();
    await new WorkHandoffConsumptionService(f.storage, f.registry).evaluate(f.handoff.id);
    await new WorkManager(f.storage).transition(f.work.id, status);
    expect(await f.service.admit(f.handoff.id, f.task.id)).toEqual({ disposition: 'NO_ACTION' });
    expect(await f.storage.continuationBindings.get(f.handoff.id)).toBeNull();
    expect(await f.storage.taskRuns.list()).toEqual([]);
  });
  it('fails closed on unknown handoff, task and destination', async () => {
    const f = await fixture();
    await expect(f.service.admit('unknown', f.task.id)).rejects.toThrow();
    await expect(f.service.admit(f.handoff.id, 'unknown')).rejects.toThrow();
    const registry = new AgentProfileRegistry([f.registry.get(agentProfileId('source'))]);
    await expect(new WorkHandoffContinuationService(f.storage, registry, f.storage.continuationBindings)
      .admit(f.handoff.id, f.task.id)).rejects.toThrow();
    expect(await f.storage.continuationBindings.get(f.handoff.id)).toBeNull();
  });
  it('serializes replay across independent connections and rejects both directions of conflict', async () => {
    const f = await fixture(); const other = await open(f.path);
    const otherService = new WorkHandoffContinuationService(other, f.registry, other.continuationBindings);
    const [a, b] = await Promise.all([f.service.admit(f.handoff.id, f.task.id), otherService.admit(f.handoff.id, f.task.id)]);
    expect(a).toEqual(b);
    const task2 = { ...f.task, id: 'other-task' }; await f.storage.tasks.save(task2);
    await expect(f.service.admit(f.handoff.id, task2.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    const handoff2 = { ...f.handoff, id: 'other-handoff' }; await f.storage.workHandoffs.insert(handoff2);
    await expect(f.service.admit(handoff2.id, f.task.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await f.storage.continuationBindings.get(handoff2.id)).toBeNull();
  });
  it('rejects a concurrent snapshot change even if updatedAt was retained', async () => {
    const f = await fixture(); const other = await open(f.path);
    const original = f.storage.continuationBindings.admit.bind(f.storage.continuationBindings);
    const service = new WorkHandoffContinuationService(f.storage, f.registry, {
      get: id => f.storage.continuationBindings.get(id),
      admit: async expected => {
        await other.tasks.save({ ...f.task, description: 'changed without timestamp' });
        return original(expected);
      },
    });
    await expect(service.admit(f.handoff.id, f.task.id)).rejects.toMatchObject({ code: 'STALE_STATE' });
    expect(await f.storage.continuationBindings.get(f.handoff.id)).toBeNull();
  });
  it('rejects a run inserted between validation and atomic admission', async () => {
    const f = await fixture();
    const original = f.storage.continuationBindings.admit.bind(f.storage.continuationBindings);
    const service = new WorkHandoffContinuationService(f.storage, f.registry, {
      get: id => f.storage.continuationBindings.get(id), admit: async expected => {
        await f.storage.taskRuns.save({ id: 'concurrent', taskId: f.task.id, attempt: 1, status: TaskRunStatus.STARTED,
          capability: Capability.GENERAL_CHAT, artifactIds: [], startedAt: '2026-09-21T00:00:00.000Z' });
        return original(expected);
      },
    });
    await expect(service.admit(f.handoff.id, f.task.id)).rejects.toMatchObject({ code: 'STALE_STATE' });
    expect(await f.storage.continuationBindings.get(f.handoff.id)).toBeNull();
  });
  it('migrates v9 additively and idempotently without changing historical data', () => {
    const db = new Database(':memory:');
    try {
      for (const m of MIGRATIONS.filter(m => m.version <= 9)) m.up(db);
      db.pragma('user_version = 9');
      db.prepare('INSERT INTO tasks (id, channel_id, data) VALUES (?, ?, ?)').run('historical', 'channel', '{"id":"historical"}');
      expect(runMigrations(db)).toEqual({ from: 9, to: 10, applied: [10] });
      expect(runMigrations(db).applied).toEqual([]);
      expect(db.prepare('SELECT data FROM tasks WHERE id = ?').get('historical')).toEqual({ data: '{"id":"historical"}' });
      expect((db.pragma('table_info(continuation_bindings)') as {name: string}[]).map(x => x.name))
        .toEqual(['handoff_id', 'task_id', 'recorded_at']);
    } finally { db.close(); }
  });
});
