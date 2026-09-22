import type {
  Capability,
  ContinuationBinding,
  ExecutionPlanRef,
  Actor,
  AgentProfileId,
  Artifact,
  ApprovalRequest,
  CodeGeneration,
  CodeProposal,
  CommandExecution,
  ExecutionKind,
  ExecutionReceipt,
  Id,
  MemoryRecord,
  MemoryScope,
  MemoryType,
  PatchSet,
  Project,
  ResourceRef,
  Session,
  Task,
  TaskRun,
  WorkItem,
  WorkHandoff,
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

/** Core policy supplies this expectation; persistence mechanically compares canonical facts atomically. */
export interface GuardedTaskRunStartFacts {
  readonly handoff: WorkHandoff;
  readonly binding: ContinuationBinding;
  readonly workItem: WorkItem;
  readonly task: Task;
  readonly approval:
    | Readonly<{ kind: 'NOT_REQUIRED'; planRef?: ExecutionPlanRef }>
    | Readonly<{ kind: 'APPROVED'; request: ApprovalRequest; planRef: ExecutionPlanRef }>;
}

export interface TaskRunRepository extends Repository<TaskRun> {
  /** For non-continuation Tasks only: revalidate RUNNING, allocate an ordinal and insert STARTED.
   * Must reject a canonical persisted continuation binding, independently of caller flags. */
  start(task: Task, capability: Capability): Promise<TaskRun>;
  /** ADR-0088: commit begins the exact continuation attempt; never a reservation or claim.
   * Core supplies fresh, policy-validated facts. Independently compare them and reject any unresolved
   * STARTED run in the same transaction as insertion. Ordinary start must reject bound Tasks.
   */
  guardedStart(expected: GuardedTaskRunStartFacts, capability: Capability): Promise<TaskRun>;
  /** Bound Tasks: update existing runs only; reject novel insertion and terminal → STARTED revival.
   * Existing complete/fail terminal updates remain supported. */
  save(run: TaskRun): Promise<TaskRun>;
  listByTask(taskId: Id): Promise<TaskRun[]>;
}

/** Bounded, storage-neutral candidate lookup for durable-memory recall. */
export interface DurableMemoryQuery {
  scope: MemoryScope;
  limit: number;
  excludeIds?: string[];
  excludeExpired?: boolean;
  excludeSuperseded?: boolean;
}

export interface MemoryRepository extends Repository<MemoryRecord> {
  findByScope(scope: MemoryScope, type?: MemoryType): Promise<MemoryRecord[]>;
  findDurableCandidates(query: DurableMemoryQuery): Promise<MemoryRecord[]>;
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

export interface WorkItemRepository extends Repository<WorkItem> {
  /** Durable work owned by one canonical Actor.id. */
  listByActor(actorId: Id): Promise<WorkItem[]>;
  /** Work correlated to an external input, without persisting connector DTOs. */
  listByResource(resource: ResourceRef): Promise<WorkItem[]>;
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

/**
 * Immutable, insert-once CAP-013 store. It deliberately does not expose the
 * mutation operations of Repository<T>.
 */
export interface ExecutionReceiptRepository {
  insert(receipt: ExecutionReceipt): Promise<ExecutionReceipt>;
  get(id: Id): Promise<ExecutionReceipt | null>;
  findBySource(executionKind: ExecutionKind, sourceId: Id): Promise<ExecutionReceipt | null>;
  findByExecutionPlan(executionPlanId: Id): Promise<ExecutionReceipt[]>;
}

/** Immutable, insert-once CAP-014 store with only bounded provenance lookups. */
export interface WorkHandoffRepository {
  insert(handoff: WorkHandoff): Promise<WorkHandoff>;
  get(id: Id): Promise<WorkHandoff | null>;
  listByWorkItem(workItemId: Id): Promise<WorkHandoff[]>;
  listByFromAgent(agentProfileId: AgentProfileId): Promise<WorkHandoff[]>;
  listByToAgent(agentProfileId: AgentProfileId): Promise<WorkHandoff[]>;
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
  readonly workItems: WorkItemRepository;
  readonly approvals: ApprovalRepository;
  readonly patches: PatchRepository;
  readonly workspaceChanges: WorkspaceChangeRepository;
  readonly commandExecutions: CommandExecutionRepository;
  readonly executionReceipts: ExecutionReceiptRepository;
  readonly workHandoffs: WorkHandoffRepository;
  readonly codeGenerations: CodeGenerationRepository;
  readonly codeProposals: CodeProposalRepository;
}
