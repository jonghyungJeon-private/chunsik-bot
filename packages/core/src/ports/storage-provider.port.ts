import type {
  Actor,
  Artifact,
  ApprovalRequest,
  CodeGeneration,
  CodeProposal,
  CommandExecution,
  Id,
  MemoryRecord,
  MemoryScope,
  MemoryType,
  PatchSet,
  Project,
  Session,
  Task,
  TaskRun,
  WorkspaceChange,
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

export interface PatchRepository extends Repository<PatchSet> {
  /** All patch sets generated for a given ExecutionPlan (CAP-005). */
  findByExecutionPlan(executionPlanId: Id): Promise<PatchSet[]>;
}

export interface WorkspaceChangeRepository extends Repository<WorkspaceChange> {
  /** The workspace change(s) recorded for applying a given PatchSet (CAP-006). */
  findByPatchSet(patchSetId: Id): Promise<WorkspaceChange[]>;
}

export interface CommandExecutionRepository extends Repository<CommandExecution> {
  /** All command executions recorded for a given ExecutionPlan (CAP-007). */
  findByExecutionPlan(executionPlanId: Id): Promise<CommandExecution[]>;
  /** All command executions recorded for a given WorkspaceChange (CAP-007). */
  findByWorkspaceChange(workspaceChangeId: Id): Promise<CommandExecution[]>;
}

export interface CodeGenerationRepository extends Repository<CodeGeneration> {
  /** All code-generation runs recorded for a given ExecutionPlan (CAP-008). */
  findByExecutionPlan(executionPlanId: Id): Promise<CodeGeneration[]>;
}

export interface CodeProposalRepository extends Repository<CodeProposal> {
  /** The proposal(s) produced by a given code-generation run (CAP-008). */
  findByCodeGeneration(codeGenerationId: Id): Promise<CodeProposal[]>;
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
  readonly patches: PatchRepository;
  readonly workspaceChanges: WorkspaceChangeRepository;
  readonly commandExecutions: CommandExecutionRepository;
  readonly codeGenerations: CodeGenerationRepository;
  readonly codeProposals: CodeProposalRepository;
}
