import { InvalidTaskTransitionError } from '../errors';
import { newId } from '../util/id';
import { now } from '../util/clock';
import { Capability, RiskLevel, TaskRunStatus, TaskStatus } from '../domain';
import type { ConversationContext, Id, Intent, Metadata, Task, TaskRun } from '../domain';
import type { StorageProvider } from '../ports';

/**
 * Owns Task / TaskRun lifecycle and persistence. The status state machine is
 * deterministic policy, so it is implemented in v1; the cognition that decides
 * WHICH transition to make lives in the orchestrator and planner.
 */
export class TaskManager {
  /** Allowed status transitions. Terminal states map to []. */
  private static readonly TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    [TaskStatus.PENDING]: [TaskStatus.PLANNING, TaskStatus.CANCELED],
    [TaskStatus.PLANNING]: [
      TaskStatus.WAITING_APPROVAL,
      TaskStatus.RUNNING,
      TaskStatus.FAILED,
      TaskStatus.CANCELED,
    ],
    [TaskStatus.WAITING_APPROVAL]: [TaskStatus.RUNNING, TaskStatus.CANCELED],
    [TaskStatus.RUNNING]: [
      TaskStatus.TESTING,
      TaskStatus.NEEDS_REVIEW,
      TaskStatus.COMPLETED,
      TaskStatus.FAILED,
      TaskStatus.CANCELED,
    ],
    [TaskStatus.TESTING]: [TaskStatus.COMPLETED, TaskStatus.NEEDS_REVIEW, TaskStatus.FAILED],
    [TaskStatus.NEEDS_REVIEW]: [TaskStatus.RUNNING, TaskStatus.COMPLETED, TaskStatus.CANCELED],
    [TaskStatus.FAILED]: [TaskStatus.PLANNING], // allow retry by re-planning
    [TaskStatus.CANCELED]: [],
    [TaskStatus.COMPLETED]: [],
  };

  constructor(private readonly storage: StorageProvider) {}

  async createTask(
    intent: Intent,
    context: ConversationContext,
    opts: { actorId?: Id; sessionId?: Id; projectId?: Id } = {},
  ): Promise<Task> {
    const ts = now();
    const task: Task = {
      id: newId(),
      title: intent.summary.slice(0, 80),
      description: intent.summary,
      status: TaskStatus.PENDING,
      intent,
      // Provisional; the Planner sets the real risk once the plan is known.
      riskLevel: RiskLevel.LOW,
      context,
      ...(opts.actorId ? { actorId: opts.actorId } : {}),
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      createdAt: ts,
      updatedAt: ts,
    };
    return this.storage.tasks.save(task);
  }

  canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return TaskManager.TRANSITIONS[from].includes(to);
  }

  async transition(task: Task, to: TaskStatus): Promise<Task> {
    if (!this.canTransition(task.status, to)) {
      throw new InvalidTaskTransitionError(task.status, to);
    }
    const updated: Task = { ...task, status: to, updatedAt: now() };
    return this.storage.tasks.save(updated);
  }

  async startRun(task: Task, capability: Capability): Promise<TaskRun> {
    const existing = await this.storage.taskRuns.listByTask(task.id);
    const run: TaskRun = {
      id: newId(),
      taskId: task.id,
      attempt: existing.length + 1,
      status: TaskRunStatus.STARTED,
      capability,
      artifactIds: [],
      startedAt: now(),
    };
    return this.storage.taskRuns.save(run);
  }

  async completeRun(
    run: TaskRun,
    result: { artifactIds: Id[]; providerId?: string; metadata?: Metadata },
  ): Promise<TaskRun> {
    const finishedAt = now();
    const updated: TaskRun = {
      ...run,
      status: TaskRunStatus.SUCCEEDED,
      artifactIds: result.artifactIds,
      finishedAt,
      durationMs: TaskManager.elapsed(run.startedAt, finishedAt),
      ...(result.providerId ? { providerId: result.providerId } : {}),
      ...(result.metadata ? { metadata: result.metadata } : {}),
    };
    return this.storage.taskRuns.save(updated);
  }

  async failRun(
    run: TaskRun,
    error: string,
    info: { providerId?: string } = {},
  ): Promise<TaskRun> {
    const finishedAt = now();
    const updated: TaskRun = {
      ...run,
      status: TaskRunStatus.FAILED,
      error,
      finishedAt,
      durationMs: TaskManager.elapsed(run.startedAt, finishedAt),
      ...(info.providerId ? { providerId: info.providerId } : {}),
    };
    return this.storage.taskRuns.save(updated);
  }

  private static elapsed(startedAt: string, finishedAt: string): number {
    return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  }
}
