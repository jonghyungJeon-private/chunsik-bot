import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { NotImplementedError } from '@chunsik/core';
import type {
  Actor,
  ActorRepository,
  ApprovalRequest,
  Artifact,
  ArtifactRepository,
  Id,
  MemoryRecord,
  MemoryRepository,
  MemoryScope,
  MemoryType,
  Project,
  Repository,
  Session,
  SessionRepository,
  StorageProvider,
  Task,
  TaskRepository,
  TaskRun,
  TaskRunRepository,
} from '@chunsik/core';

export interface SqliteConfig {
  /** Path to the SQLite database file, e.g. ./data/chunsik.db */
  dbPath: string;
}

type Db = Database.Database;
type Row = { data: string };

/** A SQLite-backed JSON document store for one entity type (id + data). */
class JsonRepository<T extends { id: Id }> implements Repository<T> {
  constructor(
    protected readonly db: Db,
    protected readonly table: string,
  ) {}

  async get(id: Id): Promise<T | null> {
    const row = this.db.prepare(`SELECT data FROM ${this.table} WHERE id = ?`).get(id) as
      | Row
      | undefined;
    return row ? (JSON.parse(row.data) as T) : null;
  }

  async save(entity: T): Promise<T> {
    this.db
      .prepare(
        `INSERT INTO ${this.table} (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      .run(entity.id, JSON.stringify(entity));
    return entity;
  }

  async delete(id: Id): Promise<void> {
    this.db.prepare(`DELETE FROM ${this.table} WHERE id = ?`).run(id);
  }

  async list(): Promise<T[]> {
    const rows = this.db.prepare(`SELECT data FROM ${this.table}`).all() as Row[];
    return rows.map((r) => JSON.parse(r.data) as T);
  }
}

class SqliteActorRepository extends JsonRepository<Actor> implements ActorRepository {
  override async save(actor: Actor): Promise<Actor> {
    const tx = this.db.transaction((a: Actor) => {
      this.db
        .prepare(
          `INSERT INTO actors (id, data) VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        )
        .run(a.id, JSON.stringify(a));
      this.db.prepare(`DELETE FROM actor_identities WHERE actor_id = ?`).run(a.id);
      const ins = this.db.prepare(
        `INSERT INTO actor_identities (platform, external_id, actor_id) VALUES (?, ?, ?)
         ON CONFLICT(platform, external_id) DO UPDATE SET actor_id = excluded.actor_id`,
      );
      for (const idn of a.identities) ins.run(idn.platform, idn.externalId, a.id);
    });
    tx(actor);
    return actor;
  }

  override async delete(id: Id): Promise<void> {
    this.db.prepare(`DELETE FROM actor_identities WHERE actor_id = ?`).run(id);
    await super.delete(id);
  }

  async findByExternalIdentity(platform: string, externalId: string): Promise<Actor | null> {
    const row = this.db
      .prepare(`SELECT actor_id FROM actor_identities WHERE platform = ? AND external_id = ?`)
      .get(platform, externalId) as { actor_id: string } | undefined;
    return row ? this.get(row.actor_id) : null;
  }
}

class SqliteSessionRepository extends JsonRepository<Session> implements SessionRepository {
  override async save(session: Session): Promise<Session> {
    this.db
      .prepare(
        `INSERT INTO sessions (id, channel_id, thread_id, status, data) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id,
           thread_id = excluded.thread_id, status = excluded.status, data = excluded.data`,
      )
      .run(
        session.id,
        session.context.channelId,
        session.context.threadId ?? null,
        session.status,
        JSON.stringify(session),
      );
    return session;
  }

  async findActiveByContext(channelId: string, threadId?: string): Promise<Session | null> {
    const order = `ORDER BY json_extract(data, '$.lastActivityAt') DESC LIMIT 1`;
    const row = (
      threadId === undefined
        ? this.db
            .prepare(
              `SELECT data FROM sessions WHERE channel_id = ? AND thread_id IS NULL AND status = 'ACTIVE' ${order}`,
            )
            .get(channelId)
        : this.db
            .prepare(
              `SELECT data FROM sessions WHERE channel_id = ? AND thread_id = ? AND status = 'ACTIVE' ${order}`,
            )
            .get(channelId, threadId)
    ) as Row | undefined;
    return row ? (JSON.parse(row.data) as Session) : null;
  }
}

class SqliteTaskRepository extends JsonRepository<Task> implements TaskRepository {
  override async save(task: Task): Promise<Task> {
    this.db
      .prepare(
        `INSERT INTO tasks (id, channel_id, thread_id, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id,
           thread_id = excluded.thread_id, data = excluded.data`,
      )
      .run(task.id, task.context.channelId, task.context.threadId ?? null, JSON.stringify(task));
    return task;
  }

  async listByContext(channelId: string, threadId?: string): Promise<Task[]> {
    const rows = (
      threadId === undefined
        ? this.db.prepare(`SELECT data FROM tasks WHERE channel_id = ? AND thread_id IS NULL`).all(channelId)
        : this.db.prepare(`SELECT data FROM tasks WHERE channel_id = ? AND thread_id = ?`).all(channelId, threadId)
    ) as Row[];
    return rows.map((r) => JSON.parse(r.data) as Task);
  }
}

class SqliteTaskRunRepository extends JsonRepository<TaskRun> implements TaskRunRepository {
  override async save(run: TaskRun): Promise<TaskRun> {
    this.db
      .prepare(
        `INSERT INTO task_runs (id, task_id, data) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET task_id = excluded.task_id, data = excluded.data`,
      )
      .run(run.id, run.taskId, JSON.stringify(run));
    return run;
  }

  async listByTask(taskId: Id): Promise<TaskRun[]> {
    const rows = this.db
      .prepare(`SELECT data FROM task_runs WHERE task_id = ? ORDER BY json_extract(data, '$.attempt')`)
      .all(taskId) as Row[];
    return rows.map((r) => JSON.parse(r.data) as TaskRun);
  }
}

class SqliteArtifactRepository extends JsonRepository<Artifact> implements ArtifactRepository {
  override async save(artifact: Artifact): Promise<Artifact> {
    this.db
      .prepare(
        `INSERT INTO artifacts (id, task_id, data) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET task_id = excluded.task_id, data = excluded.data`,
      )
      .run(artifact.id, artifact.taskId ?? null, JSON.stringify(artifact));
    return artifact;
  }

  async listByTask(taskId: Id): Promise<Artifact[]> {
    const rows = this.db.prepare(`SELECT data FROM artifacts WHERE task_id = ?`).all(taskId) as Row[];
    return rows.map((r) => JSON.parse(r.data) as Artifact);
  }
}

class SqliteMemoryRepository extends JsonRepository<MemoryRecord> implements MemoryRepository {
  override async save(record: MemoryRecord): Promise<MemoryRecord> {
    this.db
      .prepare(
        `INSERT INTO memories (id, session_id, project_id, channel_id, thread_id, type, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id,
           project_id = excluded.project_id, channel_id = excluded.channel_id,
           thread_id = excluded.thread_id, type = excluded.type, data = excluded.data`,
      )
      .run(
        record.id,
        record.scope.sessionId ?? null,
        record.scope.projectId ?? null,
        record.scope.channelId ?? null,
        record.scope.threadId ?? null,
        record.type,
        JSON.stringify(record),
      );
    return record;
  }

  async findByScope(scope: MemoryScope, type?: MemoryType): Promise<MemoryRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (scope.sessionId !== undefined) {
      clauses.push('session_id = ?');
      params.push(scope.sessionId);
    }
    if (scope.projectId !== undefined) {
      clauses.push('project_id = ?');
      params.push(scope.projectId);
    }
    if (scope.channelId !== undefined) {
      clauses.push('channel_id = ?');
      params.push(scope.channelId);
    }
    if (scope.threadId !== undefined) {
      clauses.push('thread_id = ?');
      params.push(scope.threadId);
    }
    if (type !== undefined) {
      clauses.push('type = ?');
      params.push(type);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT data FROM memories ${where}`).all(...params) as Row[];
    return rows.map((r) => JSON.parse(r.data) as MemoryRecord);
  }
}

/** Repositories not yet needed (built in their own sprint). */
class StubRepository<T> implements Repository<T> {
  constructor(protected readonly entity: string) {}
  async get(_id: Id): Promise<T | null> {
    throw new NotImplementedError(`${this.entity}.get`);
  }
  async save(_entity: T): Promise<T> {
    throw new NotImplementedError(`${this.entity}.save`);
  }
  async delete(_id: Id): Promise<void> {
    throw new NotImplementedError(`${this.entity}.delete`);
  }
  async list(): Promise<T[]> {
    throw new NotImplementedError(`${this.entity}.list`);
  }
}

/**
 * StorageProvider over SQLite (better-sqlite3). All SQL stays in this package;
 * callers see only domain entities. Implemented: actors, sessions, tasks,
 * taskRuns, artifacts, memories. Stubbed until their sprint: projects, approvals.
 */
export class SqliteStorageProvider implements StorageProvider {
  private db?: Db;

  // Built in init() once the connection exists.
  actors!: ActorRepository;
  sessions!: SessionRepository;
  tasks!: TaskRepository;
  taskRuns!: TaskRunRepository;
  artifacts!: ArtifactRepository;
  memories!: MemoryRepository;
  projects!: Repository<Project>;

  readonly approvals: Repository<ApprovalRequest> = new StubRepository<ApprovalRequest>('approvals');

  constructor(private readonly config: SqliteConfig) {}

  async init(): Promise<void> {
    mkdirSync(dirname(this.config.dbPath), { recursive: true });
    const db = new Database(this.config.dbPath);
    db.pragma('journal_mode = WAL');
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
    // Defensive migrations for DBs created before these columns existed (ADR-0017/0018).
    for (const col of ['session_id', 'project_id']) {
      try {
        db.exec(`ALTER TABLE memories ADD COLUMN ${col} TEXT;`);
      } catch {
        /* column already exists */
      }
    }

    this.db = db;
    this.actors = new SqliteActorRepository(db, 'actors');
    this.sessions = new SqliteSessionRepository(db, 'sessions');
    this.tasks = new SqliteTaskRepository(db, 'tasks');
    this.taskRuns = new SqliteTaskRunRepository(db, 'task_runs');
    this.artifacts = new SqliteArtifactRepository(db, 'artifacts');
    this.memories = new SqliteMemoryRepository(db, 'memories');
    this.projects = new JsonRepository<Project>(db, 'projects');
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }
}
