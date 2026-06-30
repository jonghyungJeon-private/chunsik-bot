import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, runMigrations } from './migrations';

function tableNames(db: Database.Database): string[] {
  return (
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>
  ).map((r) => r.name);
}
function userVersion(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

describe('runMigrations (ADR-0020 — versioned schema)', () => {
  it('migrates a fresh database to the latest version and creates all tables', () => {
    const db = new Database(':memory:');
    const res = runMigrations(db);
    expect(res.from).toBe(0);
    expect(res.to).toBe(LATEST_SCHEMA_VERSION);
    expect(userVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    for (const t of ['actors', 'actor_identities', 'sessions', 'tasks', 'task_runs', 'artifacts', 'projects', 'memories', 'approvals', 'patches', 'workspace_changes', 'command_executions', 'code_generations', 'code_proposals']) {
      expect(tableNames(db)).toContain(t);
    }
    db.close();
  });

  it('migrations v2-v6 add approvals, patches, workspace_changes, command_executions, code_generations/proposals (CAP-004…008)', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(6);
    const db = new Database(':memory:');
    runMigrations(db);
    for (const t of ['approvals', 'patches']) {
      expect(tableNames(db)).toContain(t);
      const cols = (db.pragma(`table_info(${t})`) as Array<{ name: string }>).map((c) => c.name);
      expect(cols).toEqual(expect.arrayContaining(['id', 'execution_plan_id', 'status', 'data']));
    }
    expect(tableNames(db)).toContain('workspace_changes');
    const wcCols = (db.pragma('table_info(workspace_changes)') as Array<{ name: string }>).map((c) => c.name);
    expect(wcCols).toEqual(expect.arrayContaining(['id', 'patch_id', 'status', 'data']));

    expect(tableNames(db)).toContain('command_executions');
    const ceCols = (db.pragma('table_info(command_executions)') as Array<{ name: string }>).map((c) => c.name);
    expect(ceCols).toEqual(
      expect.arrayContaining(['id', 'execution_plan_id', 'workspace_change_id', 'status', 'data']),
    );

    expect(tableNames(db)).toContain('code_generations');
    const cgCols = (db.pragma('table_info(code_generations)') as Array<{ name: string }>).map((c) => c.name);
    expect(cgCols).toEqual(expect.arrayContaining(['id', 'execution_plan_id', 'status', 'data']));
    expect(tableNames(db)).toContain('code_proposals');
    const cpCols = (db.pragma('table_info(code_proposals)') as Array<{ name: string }>).map((c) => c.name);
    expect(cpCols).toEqual(expect.arrayContaining(['id', 'code_generation_id', 'data']));
    db.close();
  });

  it('is idempotent — a second run applies nothing', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const second = runMigrations(db);
    expect(second.applied).toEqual([]);
    expect(second.from).toBe(LATEST_SCHEMA_VERSION);
    expect(userVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });

  it('upgrades a legacy DB (no version, old memories schema) without data loss', () => {
    const db = new Database(':memory:');
    // Simulate a pre-versioning DB: memories created BEFORE session_id/project_id.
    db.exec(`CREATE TABLE memories (id TEXT PRIMARY KEY, channel_id TEXT, thread_id TEXT, type TEXT NOT NULL, data TEXT NOT NULL);`);
    db.prepare(`INSERT INTO memories (id, type, data) VALUES (?, ?, ?)`).run('m1', 'SHORT_TERM', '{"x":1}');
    expect(userVersion(db)).toBe(0);

    const res = runMigrations(db);
    expect(res.from).toBe(0);
    expect(res.to).toBe(LATEST_SCHEMA_VERSION);
    // New columns added, existing row preserved.
    const cols = (db.pragma('table_info(memories)') as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('session_id');
    expect(cols).toContain('project_id');
    const row = db.prepare(`SELECT data FROM memories WHERE id = ?`).get('m1') as { data: string };
    expect(row.data).toBe('{"x":1}');
    db.close();
  });

  it('migration versions are contiguous starting at 1', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual(versions.map((_, i) => i + 1));
  });
});
