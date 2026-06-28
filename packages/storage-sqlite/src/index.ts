import { NotImplementedError } from '@chunsik/core';
import type {
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

/**
 * SKELETON. A repository whose methods are not implemented yet. Concrete
 * SQLite-backed repositories (via better-sqlite3) replace these later. Each
 * maps rows <-> domain entities INSIDE this package so no driver type escapes.
 */
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
 * SKELETON. Implements the StorageProvider port over SQLite.
 *
 * TODO(impl): add `better-sqlite3`, open the db in init(), run migrations
 * (tables for tasks, task_runs, memories, artifacts, projects, approvals), and
 * back each repository with prepared statements. Keep ALL SQL in this package.
 */
export class SqliteStorageProvider implements StorageProvider {
  readonly tasks: TaskRepository = new StubTaskRepository('tasks');
  readonly taskRuns: TaskRunRepository = new StubTaskRunRepository('taskRuns');
  readonly memories: MemoryRepository = new StubMemoryRepository('memories');
  readonly artifacts: ArtifactRepository = new StubArtifactRepository('artifacts');
  readonly projects: Repository<Project> = new StubRepository<Project>('projects');
  readonly approvals: Repository<ApprovalRequest> = new StubRepository<ApprovalRequest>('approvals');

  constructor(private readonly config: SqliteConfig) {}

  async init(): Promise<void> {
    void this.config;
    throw new NotImplementedError('SqliteStorageProvider.init');
  }

  async close(): Promise<void> {
    throw new NotImplementedError('SqliteStorageProvider.close');
  }
}
