import { isDeepStrictEqual } from 'node:util';
import type Database from 'better-sqlite3';
import { ContinuationAdmissionError, TaskStatus, WorkItemStatus, now } from '@chunsik/core';
import type { ContinuationBinding, ContinuationBindingRepository, Id, Task, WorkHandoff, WorkItem } from '@chunsik/core';

type BindingRow = { handoff_id: string; task_id: string; recorded_at: string };
function binding(row: BindingRow): ContinuationBinding {
  return Object.freeze({ handoffId: row.handoff_id, taskId: row.task_id, recordedAt: row.recorded_at });
}

/** One local atomic effect; no network, execution, or mutation of referenced aggregates. */
export class SqliteContinuationBindingRepository implements ContinuationBindingRepository {
  constructor(private readonly db: Database.Database) {}

  async get(handoffId: Id): Promise<ContinuationBinding | null> {
    const row = this.db.prepare('SELECT * FROM continuation_bindings WHERE handoff_id = ?')
      .get(handoffId) as BindingRow | undefined;
    return row ? binding(row) : null;
  }

  async admit(expected: Readonly<{ handoff: WorkHandoff; workItem: WorkItem; task: Task }>): Promise<ContinuationBinding> {
    // The IMMEDIATE transaction serializes admission across connections, including the uniqueness check.
    return this.db.transaction(() => {
      for (const [table, value] of [
        ['work_handoffs', expected.handoff], ['work_items', expected.workItem], ['tasks', expected.task],
      ] as const) {
        const row = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(value.id) as { data: string } | undefined;
        if (!row || !isDeepStrictEqual(JSON.parse(row.data), JSON.parse(JSON.stringify(value)))) {
          throw new ContinuationAdmissionError('STALE_STATE');
        }
      }
      const { handoff, workItem, task } = expected;
      if (handoff.workItemId !== workItem.id || workItem.status !== WorkItemStatus.ACTIVE
        || task.status !== TaskStatus.PENDING || !workItem.actorId || task.actorId !== workItem.actorId
        || task.projectId !== workItem.projectId) {
        throw new ContinuationAdmissionError('INCONSISTENT_STATE');
      }
      const existing = this.db.prepare('SELECT * FROM continuation_bindings WHERE handoff_id = ? OR task_id = ?')
        .all(handoff.id, task.id) as BindingRow[];
      if (existing.length) {
        const row = existing[0]!;
        if (existing.length !== 1 || row.handoff_id !== handoff.id || row.task_id !== task.id) {
          throw new ContinuationAdmissionError('CONFLICT');
        }
        return binding(row);
      }
      if (this.db.prepare('SELECT 1 FROM task_runs WHERE task_id = ? LIMIT 1').get(task.id)) {
        throw new ContinuationAdmissionError('STALE_STATE');
      }
      const result = Object.freeze({ handoffId: handoff.id, taskId: task.id, recordedAt: now() });
      this.db.prepare('INSERT INTO continuation_bindings (handoff_id, task_id, recorded_at) VALUES (?, ?, ?)')
        .run(result.handoffId, result.taskId, result.recordedAt);
      return result;
    }).immediate();
  }
}
