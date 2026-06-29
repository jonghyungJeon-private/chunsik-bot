import type {
  Actor,
  Artifact,
  ApprovalRequest,
  Id,
  MemoryRecord,
  MemoryScope,
  MemoryType,
  Project,
  Session,
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

export interface ActorRepository extends Repository<Actor> {
  /** Resolve the actor a platform identity maps to, if any. */
  findByExternalIdentity(platform: string, externalId: string): Promise<Actor | null>;
}

export interface SessionRepository extends Repository<Session> {
  /** The most-recently-active ACTIVE session for a channel/thread, if any. */
  findActiveByContext(channelId: string, threadId?: string): Promise<Session | null>;
}

export interface ApprovalRepository extends Repository<ApprovalRequest> {
  /** All approval requests governing a given ExecutionPlan (CAP-004). */
  findByExecutionPlan(executionPlanId: Id): Promise<ApprovalRequest[]>;
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

  readonly actors: ActorRepository;
  readonly sessions: SessionRepository;
  readonly tasks: TaskRepository;
  readonly taskRuns: TaskRunRepository;
  readonly memories: MemoryRepository;
  readonly artifacts: ArtifactRepository;
  readonly projects: Repository<Project>;
  readonly approvals: ApprovalRepository;
}
