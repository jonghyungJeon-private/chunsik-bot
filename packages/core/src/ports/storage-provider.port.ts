import type {
  Artifact,
  ApprovalRequest,
  Id,
  MemoryRecord,
  MemoryScope,
  MemoryType,
  Project,
  Task,
  TaskRun,
} from '../domain';

/**
 * A minimal repository abstraction. Deliberately NOT a query language — the
 * core must never express SQL. Richer queries are added as named methods on
 * specialized repositories (see MemoryRepository / TaskRepository).
 */
export interface Repository<T> {
  get(id: Id): Promise<T | null>;
  save(entity: T): Promise<T>;
  delete(id: Id): Promise<void>;
  list(): Promise<T[]>;
}

export interface TaskRepository extends Repository<Task> {
  listByContext(channelId: string, threadId?: string): Promise<Task[]>;
}

export interface TaskRunRepository extends Repository<TaskRun> {
  listByTask(taskId: Id): Promise<TaskRun[]>;
}

export interface MemoryRepository extends Repository<MemoryRecord> {
  findByScope(scope: MemoryScope, type?: MemoryType): Promise<MemoryRecord[]>;
}

export interface ArtifactRepository extends Repository<Artifact> {
  listByTask(taskId: Id): Promise<Artifact[]>;
}

/**
 * PORT: persistence. v1 implementation: SQLiteStorageProvider.
 *
 * Boundary rule: NO SQLite/driver type leaks across this interface. Callers
 * see only domain entities and the Repository contract.
 */
export interface StorageProvider {
  /** Run migrations / open the database. */
  init(): Promise<void>;
  /** Close handles on shutdown. */
  close(): Promise<void>;

  readonly tasks: TaskRepository;
  readonly taskRuns: TaskRunRepository;
  readonly memories: MemoryRepository;
  readonly artifacts: ArtifactRepository;
  readonly projects: Repository<Project>;
  readonly approvals: Repository<ApprovalRequest>;
}
