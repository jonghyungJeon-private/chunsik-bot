import { WorkspaceNotSafeError } from '../errors';
import type { ContextFile, GitStatus, Task, WorkspaceRef } from '../domain';
import type { ProjectScan, WorkspaceProvider } from '../ports';

/**
 * Thin orchestration over the WorkspaceProvider that enforces the safety rule:
 * check git status BEFORE modifying code, and never auto-commit/push/delete.
 * Swapping LocalCloneWorkspaceProvider -> GitWorktreeWorkspaceProvider later
 * requires no change here.
 */
export class WorkspaceManager {
  constructor(private readonly provider: WorkspaceProvider) {}

  /** Read-only scan of a local directory for project registration (ADR-0018). */
  async scan(path: string): Promise<ProjectScan> {
    return this.provider.scanProject(path);
  }

  /** Resolve a working directory for a task, if it targets a project. */
  async prepare(task: Task): Promise<WorkspaceRef | undefined> {
    if (!task.projectId) return undefined;
    return this.provider.resolve(task.projectId);
  }

  async status(ref: WorkspaceRef): Promise<GitStatus> {
    return this.provider.gitStatus(ref);
  }

  /** Guard invoked before any code mutation. Throws if the tree is dirty. */
  async ensureSafe(ref: WorkspaceRef): Promise<void> {
    const status = await this.provider.gitStatus(ref);
    if (!status.clean) {
      throw new WorkspaceNotSafeError(
        `branch ${status.branch} has uncommitted changes (${status.unstaged.length} unstaged, ${status.untracked.length} untracked)`,
      );
    }
  }

  /** Materialize memory context files into the workspace before a CLI run. */
  async injectContext(ref: WorkspaceRef, files: ContextFile[]): Promise<void> {
    await this.provider.writeContextFiles(ref, files);
  }
}
