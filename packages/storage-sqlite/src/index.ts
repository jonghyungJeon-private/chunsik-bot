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

/** A SQLite-backed JSON document store for one entity type. */
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
class StubTaskRepository extends StubRepository<Task> implements TaskRepository {
  async listByContext(_channelId: string, _threadId?: string): Promise<Task[]> {
    throw new NotImplementedError('tasks.listByContext');
  }
}
class StubTaskRunRepository extends StubRepository<TaskRun> implements TaskRunRepository {
  async listByTask(_taskId: Id): Promise<TaskRun[]> {
    throw new NotImplementedError('taskRuns.listByTask');
  }
}
class StubMemoryRepository extends StubRepository<MemoryRecord> implements MemoryRepository {
  async findByScope(_scope: MemoryScope, _type?: MemoryType): Promise<MemoryRecord[]> {
    throw new NotImplementedError('memories.findByScope');
  }
}
class StubArtifactRepository extends StubRepository<Artifact> implements ArtifactRepository {
  async listByTask(_taskId: Id): Promise<Artifact[]> {
    throw new NotImplementedError('artifacts.listByTask');
  }
}

/**
 * StorageProvider over SQLite (better-sqlite3). All SQL stays in this package;
 * callers see only domain entities. Sprint 1a implements `actors` + `sessions`;
 * the remaining repositories are stubbed until their sprint.
 */
export class SqliteStorageProvider implements StorageProvider {
  private db?: Db;

  // Built in init() once the connection exists.
  actors!: ActorRepository;
  sessions!: SessionRepository;

  readonly tasks: TaskRepository = new StubTaskRepository('tasks');
  readonly taskRuns: TaskRunRepository = new StubTaskRunRepository('taskRuns');
  readonly memories: MemoryRepository = new StubMemoryRepository('memories');
  readonly artifacts: ArtifactRepository = new StubArtifactRepository('artifacts');
  readonly projects: Repository<Project> = new StubRepository<Project>('projects');
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
    this.db = db;
    this.actors = new SqliteActorRepository(db, 'actors');
    this.sessions = new SqliteSessionRepository(db, 'sessions');
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }
}
