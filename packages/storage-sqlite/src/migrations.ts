import type Database from 'better-sqlite3';

type Db = Database.Database;

/**
 * A single forward-only schema migration (ADR-0020). Each `up` MUST be
 * idempotent so a legacy database created before version tracking existed
 * (`user_version = 0`) upgrades cleanly: the baseline is expressed with
 * `IF NOT EXISTS` + guarded `ADD COLUMN`, making it a no-op on a populated DB.
 */
export interface Migration {
  /** Sequential version this migration brings the schema TO (1-based, contiguous). */
  readonly version: number;
  /** Short description for audit/logging. */
  readonly name: string;
  /** Idempotent DDL that upgrades the schema to `version`. */
  up(db: Db): void;
}

/** True if `table` already has a column named `column`. */
function hasColumn(db: Db, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

/**
 * Ordered, forward-only migrations. Version 1 is the current baseline schema —
 * identical DDL to the pre-RC inline `init()`, so existing databases are
 * unaffected (backward compatible). New schema changes append a new entry.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'baseline schema',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS actors (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
      db.exec(
        `CREATE TABLE IF NOT EXISTS actor_identities (
           platform TEXT NOT NULL, external_id TEXT NOT NULL, actor_id TEXT NOT NULL,
           PRIMARY KEY (platform, external_id));`,
      );
      db.exec(
        `CREATE TABLE IF NOT EXISTS sessions (
           id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, thread_id TEXT,
           status TEXT NOT NULL, data TEXT NOT NULL);`,
      );
      db.exec(
        `CREATE TABLE IF NOT EXISTS tasks (
           id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, thread_id TEXT, data TEXT NOT NULL);`,
      );
      db.exec(
        `CREATE TABLE IF NOT EXISTS task_runs (
           id TEXT PRIMARY KEY, task_id TEXT NOT NULL, data TEXT NOT NULL);`,
      );
      db.exec(
        `CREATE TABLE IF NOT EXISTS artifacts (
           id TEXT PRIMARY KEY, task_id TEXT, data TEXT NOT NULL);`,
      );
      db.exec(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
      db.exec(
        `CREATE TABLE IF NOT EXISTS memories (
           id TEXT PRIMARY KEY, session_id TEXT, project_id TEXT, channel_id TEXT, thread_id TEXT,
           type TEXT NOT NULL, data TEXT NOT NULL);`,
      );
      // Columns added after the original release (ADR-0017/0018). Guarded so a
      // legacy `memories` table (created before these columns) is upgraded, and a
      // current table is left untouched.
      for (const col of ['session_id', 'project_id']) {
        if (!hasColumn(db, 'memories', col)) {
          db.exec(`ALTER TABLE memories ADD COLUMN ${col} TEXT;`);
        }
      }
    },
  },
  {
    version: 2,
    name: 'approvals table (CAP-004)',
    up(db) {
      db.exec(
        `CREATE TABLE IF NOT EXISTS approvals (
           id TEXT PRIMARY KEY, execution_plan_id TEXT, status TEXT NOT NULL, data TEXT NOT NULL);`,
      );
    },
  },
];

/** The schema version this build targets (the highest migration version). */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

/**
 * Apply every migration whose version exceeds the database's current
 * `user_version`, each inside its own transaction, advancing `user_version` as
 * it goes. Idempotent and backward compatible: an untracked legacy DB
 * (`user_version = 0`) re-runs the idempotent baseline and is stamped forward.
 *
 * Returns the version transition for logging/auditing.
 */
export function runMigrations(db: Db): { from: number; to: number; applied: number[] } {
  const from = Number(db.pragma('user_version', { simple: true })) || 0;
  const applied: number[] = [];
  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (m.version <= from) continue;
    const run = db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    });
    run();
    applied.push(m.version);
  }
  const to = Number(db.pragma('user_version', { simple: true })) || 0;
  return { from, to, applied };
}
