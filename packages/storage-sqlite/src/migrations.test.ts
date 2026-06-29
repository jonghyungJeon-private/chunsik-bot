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
    for (const t of ['actors', 'actor_identities', 'sessions', 'tasks', 'task_runs', 'artifacts', 'projects', 'memories', 'approvals']) {
      expect(tableNames(db)).toContain(t);
    }
    db.close();
  });

  it('migration v2 adds the approvals table (CAP-004)', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(2);
    const db = new Database(':memory:');
    runMigrations(db);
    expect(tableNames(db)).toContain('approvals');
    const cols = (db.pragma('table_info(approvals)') as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['id', 'execution_plan_id', 'status', 'data']));
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
